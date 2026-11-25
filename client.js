/**
 * Browser half of `@todrink/dsh-session-delete`.
 *
 * Contributes one structured action to the Session context menu. It sits in
 * the menu's footer group (the group 「归档会话」 uses) with a higher order, so
 * it renders directly below that item. Selecting it opens a confirmation
 * dialog in `shell.overlay`; confirming posts to the plugin's own Host route,
 * which performs the permanent removal.
 *
 * No Harness Client package is required as a module: React comes from the
 * browser module table, and every control below is this plugin's own, styled
 * with the shared `--dsw-*` theme tokens.
 */
window.__ModuleLoader__.load({
  id: '@todrink/dsh-session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useId, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'session-delete'

    /** Menu icon key contributed into `contextMenu.icon`. */
    const ICON_KEY = 'session-delete.trash'

    /** Route the Host half registers. */
    const ROUTE = 'session-delete/api'

    const zh = {
      'menu.deleteSession': '删除会话',
      'dialog.title': '删除会话',
      'dialog.desc': '将永久删除「{name}」的本地记录：对话内容、标题、归档与置顶标记。此操作无法撤销，也无法再从「已归档」里找回。',
      'dialog.untitled': '（未命名会话）',
      'dialog.hint': '只是不想让它出现在列表里？用「归档会话」可以保留记录。',
      'dialog.cancel': '取消',
      'dialog.confirm': '永久删除',
      'dialog.pending': '正在删除…',
      'dialog.running': '这个会话正在使用中（开着对话或者有进行中的回合），暂时不能删除。先关掉它或直接归档，再来删除。',
      'dialog.gone': '找不到这个会话的本地记录，它可能已经被删除。',
      'dialog.failed': '删除失败：{message}',
      'notice.deleted': '已删除会话「{name}」',
    }

    const en = {
      'menu.deleteSession': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.desc': 'Deletes the local record of "{name}" for good: its conversation, title, archived and pinned marks. This cannot be undone, and the session cannot be recovered from "Show archived".',
      'dialog.untitled': '(untitled session)',
      'dialog.hint': 'Only need it out of the list? "Archive session" keeps the record.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete permanently',
      'dialog.pending': 'Deleting…',
      'dialog.running': 'This session is in use (open in a conversation, or a turn is running), so it cannot be deleted yet. Close it first, or archive it instead.',
      'dialog.gone': 'No stored record was found for this session; it may already be deleted.',
      'dialog.failed': 'Delete failed: {message}',
      'notice.deleted': 'Deleted session "{name}"',
    }

    /** Styles for the dialog; rendered with the component so unmounting removes them. */
    const STYLES = `
.dsh-session-delete__backdrop {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  /* A scrim token, not the "overlay" surface colour (that one is a popover
     background and would paint the whole page opaque). */
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));
  font-family: var(--dsw-font-base-16-font-family, inherit);
}
.dsh-session-delete__card {
  width: min(440px, 100%);
  display: flex; flex-direction: column; gap: 12px;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: var(--dsw-elevation-panel, 0 12px 32px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-session-delete__title {
  margin: 0;
  font-family: var(--dsw-font-m-18-font-family, inherit);
  font-size: var(--dsw-font-m-18-font-size, 16px);
  font-weight: var(--dsw-font-m-18-font-weight, 600);
  line-height: var(--dsw-font-m-18-line-height, 1.4);
}
.dsh-session-delete__desc {
  margin: 0;
  font-size: var(--dsw-font-base-16-font-size, 14px);
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-session-delete__hint {
  margin: 0;
  font-size: var(--dsw-font-base-16-font-size, 14px);
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.dsh-session-delete__status {
  font-size: var(--dsw-font-base-16-font-size, 14px);
  color: var(--dsw-alias-label-tertiary, inherit);
}
.dsh-session-delete__error {
  font-size: var(--dsw-font-base-16-font-size, 14px);
  line-height: 1.6;
  color: var(--dsw-alias-state-error-primary, #d33);
}
.dsh-session-delete__footer {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 4px;
}
.dsh-session-delete__button {
  appearance: none;
  min-width: 72px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.32));
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.dsh-session-delete__button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}
.dsh-session-delete__button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4a7dff);
  outline-offset: 2px;
}
.dsh-session-delete__button:disabled { opacity: 0.5; cursor: default; }
.dsh-session-delete__button--danger {
  border-color: var(--dsw-alias-state-error-primary, #d33);
  color: var(--dsw-alias-state-error-primary, #d33);
}
.dsh-session-delete__button--danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(221, 51, 51, 0.1));
}
`

    /**
     * Minimal observable snapshot store: the slot hook the plugin injects reads
     * it through `useSyncExternalStore`.
     * @param initial - starting value.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /** Directory base for this plugin's Host routes, prefix-safe like the page itself. */
    function routeUrl(method) {
      const raw = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : typeof location !== 'undefined' ? location.href : 'http://dsh.internal/'
      const base = new URL(raw, 'http://dsh.internal/')
      base.search = ''
      base.hash = ''
      if (!base.pathname.endsWith('/')) base.pathname += '/'
      return new URL(`${ROUTE}/${method}`, base.href).href
    }

    /**
     * Ask the Host to remove one Session permanently.
     * @param sessionId - Session to remove.
     * @returns the Host's report.
     * @throws {Error} carrying the Host's reason.
     */
    async function requestDelete(sessionId) {
      const response = await fetch(routeUrl('delete'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sessionId }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (response.ok && payload?.ok === true) return payload.value
      const error = payload?.error
      const failure = new Error(
        typeof error?.message === 'string' && error.message !== ''
          ? error.message
          : `the Host answered HTTP ${String(response.status)}`,
      )
      failure.code = typeof error?.code === 'string' ? error.code : 'delete-failed'
      throw failure
    }

    /** Outline trash glyph, drawn for this plugin (14px, currentColor). */
    function TrashIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M2.75 4.25h10.5' }),
        h('path', { d: 'M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25' }),
        h('path', { d: 'M4 4.25l.6 8.1a1.25 1.25 0 0 0 1.25 1.15h4.3a1.25 1.25 0 0 0 1.25-1.15l.6-8.1' }),
        h('path', { d: 'M6.6 6.75v4.5M9.4 6.75v4.5' }),
      )
    }

    /**
     * The `shell.overlay` entry: nothing without a pending request, otherwise
     * the confirmation for the Session the menu captured.
     * @param props - the request hook, its settlement, the Host call, and the locale seat.
     * @returns the open dialog, or null.
     */
    function DeleteSessionDialog({ useDeleteRequest, settle, removeSession, t }) {
      const request = useDeleteRequest(value => value)
      if (request === null) return null
      return h(DeleteSessionForm, { key: request.sessionId, request, settle, removeSession, t })
    }

    /**
     * One request's dialog: busy and error state die with it.
     * @param props - captured request plus the shared callbacks.
     * @returns the dialog.
     */
    function DeleteSessionForm({ request, settle, removeSession, t }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const cancelRef = useRef(null)
      const titleId = useId()
      const descId = useId()
      // An untitled Session carries an empty display title; naming nothing would
      // read as a broken sentence, so the dialog names the placeholder instead.
      const name = typeof request.displayTitle === 'string' && request.displayTitle.trim() !== ''
        ? request.displayTitle
        : t('dialog.untitled')

      useEffect(() => {
        cancelRef.current?.focus()
      }, [])

      const close = useCallback(() => {
        if (busy) return
        settle()
      }, [busy, settle])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => { document.removeEventListener('keydown', onKeyDown, true) }
      }, [close])

      const confirm = useCallback(() => {
        if (busy) return
        setBusy(true)
        setError(null)
        removeSession(request.sessionId, name).then(() => {
          setBusy(false)
          settle()
        }).catch((reason) => {
          setBusy(false)
          const code = reason && reason.code
          if (code === 'session-active') setError(t('dialog.running'))
          else if (code === 'not-found') setError(t('dialog.gone'))
          else setError(t('dialog.failed', { message: reason instanceof Error ? reason.message : String(reason) }))
        })
      }, [busy, name, removeSession, request.sessionId, settle, t])

      return h(React.Fragment, null,
        h('style', { key: 'style' }, STYLES),
        h('div', {
          key: 'backdrop',
          className: 'dsh-session-delete__backdrop',
          onMouseDown: (event) => { if (event.target === event.currentTarget) close() },
        },
        h('div', {
          className: 'dsh-session-delete__card',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
          'aria-describedby': descId,
        },
        h('h2', { className: 'dsh-session-delete__title', id: titleId }, t('dialog.title')),
        h('p', { className: 'dsh-session-delete__desc', id: descId },
          t('dialog.desc', { name })),
        h('p', { className: 'dsh-session-delete__hint' }, t('dialog.hint')),
        busy && h('div', { className: 'dsh-session-delete__status', role: 'status' }, t('dialog.pending')),
        error !== null && h('div', { className: 'dsh-session-delete__error', role: 'alert' }, error),
        h('div', { className: 'dsh-session-delete__footer' },
          h('button', {
            type: 'button',
            ref: cancelRef,
            className: 'dsh-session-delete__button',
            disabled: busy,
            onClick: close,
          }, t('dialog.cancel')),
          h('button', {
            type: 'button',
            className: 'dsh-session-delete__button dsh-session-delete__button--danger',
            disabled: busy,
            onClick: confirm,
          }, t('dialog.confirm')),
        ),
        ),
        ),
      )
    }

    return {
      name: 'session-delete',
      inject: ['contextMenus', 'slots', 'locale', 'sessions'],

      /**
       * Register the dictionaries, the Session menu action, its icon, and the dialog.
       * @param ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'session-delete: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'session-delete: en dictionary')
        const t = ctx.locale.bind(NS)

        const requestStore = createStore(null)
        // The sidebar's session rows are a pulled list: removing a cold Session
        // on disk edits no workspace membership it can push, so the page has to
        // re-read the list for the row to go away.
        const sessionsService = ctx.get('sessions')
        const requestDeleteSession = async (sessionId, displayName) => {
          const value = await requestDelete(sessionId)
          try {
            await sessionsService?.refresh?.()
          } catch (error) {
            console.warn('session-delete: the session list did not refresh', error)
          }
          // Feedback outlives the dialog; a toast failure must not turn a
          // completed delete into a reported failure.
          try {
            ctx.contextMenus.notify(t('notice.deleted', {
              name: typeof displayName === 'string' && displayName !== '' ? displayName : sessionId,
            }), true)
          } catch (error) {
            console.warn('session-delete: the confirmation notice was not shown', error)
          }
          return value
        }

        ctx.slots.inject('contextMenu.icon', () => ctx.slots.register(
          { name: 'contextMenu.icon', key: ICON_KEY },
          TrashIcon,
        ))

        ctx.effect(() => ctx.contextMenus.register({
          id: 'session.delete',
          target: 'session',
          // 600 is the shipped archive item; the footer keeps provider order, so
          // this renders directly under 「归档会话」.
          order: 700,
          resolve: (target) => [{
            id: 'delete',
            label: t('menu.deleteSession'),
            icon: { key: ICON_KEY },
            danger: true,
            // Both live in the footer, after the component rows: the group
            // 「归档会话」 already opens.
            afterContent: true,
            run: () => {
              requestStore.set({ sessionId: target.sessionId, displayTitle: target.displayTitle })
            },
          }],
        }), 'session-delete: session menu action')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete.delete-dialog',
          locale: NS,
          inject: () => ({
            hooks: { deleteRequest: requestStore },
            settle: () => { requestStore.set(null) },
            removeSession: requestDeleteSession,
          }),
        }, DeleteSessionDialog))
      },
    }
  },
})
