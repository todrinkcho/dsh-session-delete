/**
 * Host half of `@todrink/dsh-session-delete`.
 *
 * DSH has no delete operation for a stored Session: 「归档会话」 only hides a
 * Session and keeps its log, and `SessionPersistence` exposes create/open/
 * stat/list but no removal. This plugin adds one HTTP route that performs the
 * permanent removal the sidebar menu asks for:
 *
 * 1. refuse a Session that is live in this process (an open turn owns its log);
 * 2. delete the stored per-Session artifact directory the persistence backend
 *    reports through `stat().location` (directory named after the Session id —
 *    otherwise just the artifact file);
 * 3. detach the id from every Workspace that accounts it, and drop it from the
 *    archived/pinned sets, so the sidebar row disappears immediately through
 *    the Workspace feed;
 * 4. remove the Session's projection checkpoint (a cache; best effort).
 *
 * The SQLite search index needs no call here: `dsh-session-query-sqlite`
 * reconciles against `SessionPersistence.list()` and prunes a Session whose
 * stored artifact disappeared.
 *
 * @module @todrink/dsh-session-delete
 */

import { readdir, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** Route prefix owned by this plugin; the client resolves it against its page. */
const ROUTE_PREFIX = '/session-delete/api'

/** Largest accepted request body; the only payload is one Session id. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * Session ids are generated identifiers; refusing anything else keeps the
 * artifact path below derived from a value that cannot traverse directories.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/** Services this plugin needs; without them it stays inactive instead of throwing. */
export const inject = ['webServer', 'connection', 'sessionPersistence', 'workspaceRegistry', 'sessions']

/** A stable failure the route renders as `{ ok: false, error }`. */
class SessionDeleteError extends Error {
  /**
   * @param code - stable wire code the client branches on.
   * @param message - user-facing reason.
   * @param status - HTTP status for this failure.
   */
  constructor(code, message, status) {
    super(message)
    this.name = 'SessionDeleteError'
    this.code = code
    this.status = status
  }
}

/**
 * Register the route that deletes one Session permanently.
 * @param ctx - Host context owning the Web server, Session store, persistence, and Workspace registry.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      // Same-origin fence every shipped plugin route uses: it rejects requests
      // that did not come from this Host's own page or worker. The service
      // answers the HTTP status to use, or undefined to admit the request.
      const rejection = typeof ctx.connection?.requestRejection === 'function'
        ? ctx.connection.requestRejection(req)
        : undefined
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      if (pathname !== `${ROUTE_PREFIX}/delete`) {
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        writeJson(res, 415, { ok: false, error: { code: 'unsupported-media-type', message: 'content-type must be application/json' } })
        return
      }
      try {
        const body = await readJsonBody(req)
        const sessionId = body?.sessionId
        if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
          throw new SessionDeleteError('bad-request', 'sessionId is missing or malformed', 400)
        }
        const value = await deleteSession(ctx, sessionId)
        ctx.logger?.info?.('session-delete: removed session %s', sessionId)
        writeJson(res, 200, { ok: true, value })
      } catch (error) {
        const code = error instanceof SessionDeleteError ? error.code : 'delete-failed'
        const status = error instanceof SessionDeleteError ? error.status : 500
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.(`session-delete: ${code}: ${message}`)
        writeJson(res, status, { ok: false, error: { code, message } })
      }
    },
  }), 'session-delete: /session-delete/api route')
}

/**
 * Permanently remove one Session: stored artifact, Workspace accounting, and caches.
 * @param ctx - Host context.
 * @param sessionId - Session to remove.
 * @returns what was removed, for the client's notice.
 * @throws {SessionDeleteError} when the Session is live or nothing could be removed.
 */
async function deleteSession(ctx, sessionId) {
  requireIdle(ctx, sessionId)
  const snapshot = await ctx.sessionPersistence.stat(sessionId, {})
  const location = snapshot?.location
  // Captured before the artifact goes away: `Workspace.sessionIds` filters by
  // the host's candidate check, which a removed artifact can already fail.
  const holders = ctx.workspaceRegistry.list()
    .filter(workspace => workspace.sessionIds.includes(sessionId))
  const removedPaths = await removeArtifact(sessionId, location)
  // A Session that never materialized has no artifact to name, yet the backend
  // may still hold its empty directory. Remove that residue too, so a later
  // `list()` cannot resurrect the identity and the disk stays clean.
  if (removedPaths.length === 0) removedPaths.push(...await removeLeftoverDirectory(ctx, sessionId))
  const detachedWorkspaceIds = []
  for (const workspace of holders) {
    await workspace.detachSession(sessionId)
    detachedWorkspaceIds.push(String(workspace.id))
  }
  // Both are idempotent no-ops for an id that is not in the set; leaving a
  // deleted id in either set would leak into workspace.json forever.
  await ctx.workspaceRegistry.unarchiveSession(sessionId)
  await ctx.workspaceRegistry.unpinSession(sessionId)
  removeProjectionCache(ctx, sessionId)
  if (removedPaths.length === 0 && detachedWorkspaceIds.length === 0) {
    throw new SessionDeleteError('not-found', `no stored session "${sessionId}" to delete`, 404)
  }
  return { sessionId, removedPaths, detachedWorkspaceIds, alreadyGone: location === undefined }
}

/**
 * Refuse a Session that this process still owns: an open turn appends to its
 * log, so removing the log underneath it would corrupt the running exchange.
 * @param ctx - Host context.
 * @param sessionId - Session about to be deleted.
 */
function requireIdle(ctx, sessionId) {
  if (ctx.sessions.get(sessionId) !== undefined) {
    throw new SessionDeleteError(
      'session-active',
      'this session is open or running in this process; archive it first and delete it once it is idle',
      409,
    )
  }
  const agents = ctx.get('agents')
  if (typeof agents?.get === 'function' && agents.get(sessionId) !== undefined) {
    throw new SessionDeleteError(
      'session-active',
      'this session still has an agent in this process; stop it before deleting',
      409,
    )
  }
}

/**
 * Remove the stored artifact for one Session.
 *
 * The JSONL backend keeps one directory per Session named after its id and one
 * artifact inside it; older formats may leave a sibling generation next to the
 * current one, so the whole dedicated directory goes. Any other layout removes
 * exactly the artifact `stat()` named.
 * @param sessionId - Session to remove.
 * @param location - Backend-resolved artifact path, when the Session materialized.
 * @returns the paths that were removed.
 */
async function removeArtifact(sessionId, location) {
  if (location === undefined) return []
  const file = location.path
  const directory = dirname(file)
  if (basename(directory) !== sessionId) {
    await unlink(file).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
    return [file]
  }
  // Defence in depth: never recurse into a path that is not the Session's own
  // directory, even though the id pattern already refuses separators.
  if (basename(directory) !== sessionId) return []
  const info = await stat(directory).catch(() => undefined)
  if (info === undefined) return []
  if (!info.isDirectory()) {
    await unlink(directory).catch(() => {})
    return [directory]
  }
  await rm(directory, { recursive: true, force: true })
  return [directory]
}

/**
 * Remove a per-Session directory the persistence backend did not report an
 * artifact for (a Session created but never materialized).
 *
 * Only a directory whose name is exactly the Session id, directly below one
 * project directory of the Sessions root, is touched, so this can never remove
 * another Session's data.
 * @param ctx - Host context, for logging only.
 * @param sessionId - Session whose directory is sought.
 * @returns the removed directory, when one was found.
 */
async function removeLeftoverDirectory(ctx, sessionId) {
  const root = join(dshHome(), 'sessions')
  const projects = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of projects) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, sessionId)
    if (basename(candidate) !== sessionId) continue
    const info = await stat(candidate).catch(() => undefined)
    if (info?.isDirectory() !== true) continue
    await rm(candidate, { recursive: true, force: true })
    return [candidate]
  }
  return []
}

/**
 * Drop the Session's projection checkpoint. It is a derived cache: a failure
 * here costs one cold replay, never correctness, so it stays silent.
 * @param ctx - Host context.
 * @param sessionId - removed Session.
 */
function removeProjectionCache(ctx, sessionId) {
  const cache = join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  void rm(cache, { force: true }).catch((error) => {
    ctx.logger?.warn?.(`session-delete: projection cache not removed (${String(error)})`)
  })
}

/**
 * The DSH home this Host stores sessions and caches under.
 * @returns absolute home directory.
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return typeof configured === 'string' && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Read one bounded JSON object body.
 * @param req - incoming request.
 * @returns parsed object, or undefined for an empty body.
 * @throws {SessionDeleteError} for an oversized or unparsable body.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new SessionDeleteError('too-large', 'request body is too large', 413)
    }
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    throw new SessionDeleteError('bad-request', 'request body is not valid JSON', 400)
  }
}

/**
 * Answer one JSON response.
 * @param res - response to complete.
 * @param status - HTTP status.
 * @param body - JSON body.
 */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}
