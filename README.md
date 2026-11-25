# Delete session

Adds **删除会话 / Delete session** to the Session context menu, directly below
**归档会话 / Archive session**. Confirming the dialog permanently removes that
Session's local record instead of hiding it.

## Why

DSH archives but never deletes: `归档会话` only records the Session in the
Workspace's archive set, and `SessionPersistence` exposes `create` / `open` /
`flush` / `stat` / `list` — no removal. A long-lived profile therefore keeps
every Session it ever wrote, including the ones nobody will open again, and
「已归档」 accumulates entries that can only be hidden.

## Compared with the plugin market

Community catalogs list dozens of Session-deletion plugins — the closest in
shape to this one are `dsh-delete-sessions` (red 「删除会话」 under
「归档会话」 with its own confirmation dialog) and `dsh-delete-session-menu`.
None of them is installed in this profile. This bundle exists as a
self-contained, dependency-free alternative that was written against this
exact installation and verified here; installing a market plugin instead is a
straight swap — remove this bundle first so two menu items never compete.

## Behaviour

- Menu: one structured action, `target: 'session'`, `order: 700`,
  `afterContent: true`, `danger: true`. The shipped archive action is
  `order: 600` of the same footer group, so this item renders immediately under
  it.
- Selecting it opens this plugin's own confirmation dialog in `shell.overlay`
  (title, the Session's title, what is about to be lost, a reminder that
  archiving preserves the record, 取消 / 永久删除).
- Confirming posts `{ sessionId }` to the Host route
  `POST /session-delete/api/delete`, then re-reads the client's Session list.
- Failure reasons stay in the dialog: a Session that is open or running is
  refused with an explanation and can be archived instead.

## What is deleted

| What | Where | Required? |
|---|---|---|
| Stored log (whole per-Session directory) | `<home>/sessions/<project>/<sessionId>/` | yes — the authoritative record |
| Workspace membership | `storages/workspace.json` → `sessionIds` (`detachSession`) | yes — otherwise the row stays |
| Archive / pin marks | `storages/workspace.json` → `global.archivedSessionIds` / `pinnedSessionIds` | yes — otherwise the id leaks |
| Projection checkpoint | `storages/session_projcache/sessions/<sessionId>.json` | best effort (plain-text conversation state) |

Left alone on purpose: content-addressed attachments (`attachments/`, shared by
hash), age-swept spill files in the OS temp directory, `schedule.json` rows, and
subagent-Session lineage. The SQLite search index needs no call — it reconciles
against `SessionPersistence.list()` and prunes a Session whose artifact
disappeared.

## Refusals

- The Session is live in this process (`ctx.sessions.get(id)`), or an agent
  still holds it: an open turn appends to the same log, so deleting underneath
  it would corrupt the exchange. Answer `409 session-active`.
- The id is malformed or the body is not `application/json`: `400` / `415`.
- The request did not come from this Host's own page: the status
  `ctx.connection.requestRejection` reports, normally `403`.
- Nothing to remove: `404 not-found`.

## Install

```powershell
plugin_manager({ action: "install_bundle", target: "<本包目录的绝对路径>" })
```

The bundle patch inserts the Host row `session-delete`. The client half arrives
through the normal `/plugins` graph; a linked local package needs a page refresh
after an edit, and a changed `package.json` needs the row to restart.

## Rollback

1. `plugin_manager` → `remove_bundle` → `@todrink/dsh-session-delete`; the Host row and
   the client contribution go with it. No profile patch of this bundle edits
   another plugin, so nothing else needs restoring.
2. Nothing this plugin wrote outside the profile has to be undone: it only
   removes files.

## Verification

- `node --check` on `index.js` and `client.js`.
- Host route harness (35 assertions) against a throwaway `DSH_HOME`: happy path,
  directory and flat artifact layouts, never-materialized directory cleanup,
  projection-cache removal, id validation, method/path/content-type fences,
  foreign-origin rejection, live-session and live-agent refusal, unknown id,
  stale registry row.
- Client harness (48 assertions) in a VM sandbox with a stub React: module id,
  service injection, both dictionaries, menu contribution shape (target,
  order 700, footer group, danger, icon key, label), the request the slot face
  captures, the rendered dialog tree (title, named session, irreversible
  warning, archive hint, two buttons, `role="dialog"` + `aria-labelledby`),
  route resolution under `http://`, `dsh-app://app/` and a reverse-proxy prefix,
  the POST body, the list refresh, and a Host refusal surfacing its code.
- Live, in a real browser: installed into the `desktop` profile, then a second
  throwaway `dsh web` host (its own `DSH_HOME` profile, a copied Session) was
  driven with Playwright — the menu item renders directly below 「归档会话」 in
  red, the dialog opens in light and dark themes, 取消 changes nothing, and
  永久删除 answered `200 {ok:true}` → row gone from the sidebar, Session
  directory gone, notice 「已删除会话「…」」 shown, the other row untouched.
  The real `~/.dsh` data was never the target of a delete.

## Limits

- Deletion is not reversible: the JSONL generation files are append-only, and
  nothing in DSH snapshots a Session.
- A Session open in a *different* peer (another window or a remote client) is
  not visible to this Host's live check; it is refused only once its owner is
  this process. Closing other tabs before deleting is the safe habit.
- DSH does not offer the Session menu on the **selected** row, so the Session a
  user is looking at cannot reach this action from the sidebar at all; the
  host-side refusal instead covers a Session that is live but not selected.
- Archived ids already stale in this profile (138 at the time of writing, 3 of
  them without a Session directory) are left untouched; this plugin only cleans
  the id it deletes.
- A Workspace registry that has already been initialized does not rediscover
  Session directories that reappear on disk, so restoring a deleted Session's
  files by hand will not bring its row back by itself.

