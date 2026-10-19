/**
 * Client half of the `delete-session` bundle.
 *
 * One row in the Session "..." menu (order 500, after Copy Session ID) and one
 * `shell.overlay` confirmation dialog. The row talks to the Host half through
 * the same-origin POST route it registers; the menu closes before the request
 * starts so the row's keyboard walk is not left inside a dismissed popup.
 *
 * The bundle imports no Harness Client package. Menu row, dialog, buttons and
 * icon are plain React over theme tokens (`--dsw-alias-*`), and the only page
 * resource it owns is the `<style>` tag installed and removed by `apply`.
 */
window.__ModuleLoader__.load({
  id: 'delete-session',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'delete-session'
    const ENDPOINT = 'delete-session/delete'

    const en = {
      'menu.delete': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.desc': '"{title}" will be permanently deleted. This cannot be undone.',
      'dialog.note': 'The conversation, its title and the list cache are removed. Files in the workspace are not touched. Attachments may remain on disk.',
      'dialog.current': 'This is the session you have open; deleting it closes the current conversation.',
      'dialog.live': 'This session is still running, so the Host holds its files. Stop it and restart DSH, or delete it after a restart.',
      'dialog.defer': 'Stop and delete later',
      'dialog.deferred': 'Stopped and archived. Its files are removed the next time DSH starts.',
      'dialog.deleting': 'Deleting…',
      'dialog.failed': 'Delete failed: {message}',
      'action.cancel': 'Cancel',
      'action.delete': 'Delete',
      'action.done': 'Done',
      'action.close': 'Close',
      'error.login': 'DSH login required: reopen the URL printed when dsh web started.',
      'error.origin': 'This request came from an untrusted origin and was refused.',
      'error.busy': 'This session is already being deleted. Try again in a moment.',
      'error.generic': 'Delete failed. Try again; if it keeps failing, quit DSH and remove the session manually.',
      'untitled': 'Untitled session',
    }

    const zh = {
      'menu.delete': '删除会话',
      'dialog.title': '删除会话',
      'dialog.desc': '「{title}」会被永久删除，无法恢复。',
      'dialog.note': '会话记录、标题和列表缓存会被删除；工作区里的文件不受影响。附件可能仍留在磁盘上。',
      'dialog.current': '这是当前打开的会话，删除后会关闭当前对话。',
      'dialog.live': '这个会话还在运行，文件被 Host 占用，暂时不能直接删除。可以先停止它，重启 DSH 后再删除文件。',
      'dialog.defer': '停止并稍后删除',
      'dialog.deferred': '已停止并归档。重启 DSH 后会自动删除它的记录。',
      'dialog.deleting': '正在删除…',
      'dialog.failed': '删除失败：{message}',
      'action.cancel': '取消',
      'action.delete': '删除',
      'action.done': '完成',
      'action.close': '关闭',
      'error.login': '需要先登录 DSH：请重新打开 dsh web 启动时打印的网址。',
      'error.origin': '这个请求来自不受信任的地址，已拒绝。',
      'error.busy': '这个会话正在被删除，请稍后再试。',
      'error.generic': '删除失败，请重试。如果仍然失败，请退出 DSH 后手动删除。',
      'untitled': '未命名会话',
    }

    /** Host-owned styles. Installed once by `apply` and removed with the plugin. */
    const CSS = `
.dsds-menu-item{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:30px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsds-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dsds-menu-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsds-menu-item--separator{margin-top:5px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:5px}
.dsds-menu-icon{display:inline-flex;flex:none;color:var(--dsw-alias-state-error-primary)}
.dsds-menu-label{color:var(--dsw-alias-state-error-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsds-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45)}
.dsds-dialog{position:relative;box-sizing:border-box;width:440px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px rgba(0,0,0,.3);font-family:inherit}
.dsds-dialog:focus{outline:none}
.dsds-title{margin:0 0 10px;padding-right:28px;font-size:16px;line-height:22px;font-weight:600}
.dsds-desc{margin:0 0 10px;font-size:14px;line-height:21px}
.dsds-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsds-warn{margin:10px 0 0;color:var(--dsw-alias-state-warn-primary);font-size:13px;line-height:20px}
.dsds-ok{margin:10px 0 0;color:var(--dsw-alias-state-success-primary);font-size:13px;line-height:20px}
.dsds-error{margin:10px 0 0;color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.dsds-status{margin:10px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsds-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:18px}
.dsds-close{position:absolute;top:10px;right:10px;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.dsds-close:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dsds-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsds-btn{min-height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsds-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dsds-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsds-btn:disabled{opacity:.5;cursor:default}
.dsds-btn--danger{color:var(--dsw-alias-state-error-primary)}
.dsds-btn--primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
`

    /* ------------------------------------------------------------- store -- */

    function createRequestStore() {
      let current = null
      const listeners = new Set()
      const get = () => current
      const subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[delete-session] store listener failed', error)
          }
        }
      }
      return {
        get,
        subscribe,
        open(next) {
          current = next
          notify()
        },
        close() {
          current = null
          notify()
        },
      }
    }

    /* ---------------------------------------------------------------- api -- */

    function endpoint() {
      try {
        return new URL(ENDPOINT, document.baseURI).pathname
      } catch {
        return `/${ENDPOINT}`
      }
    }

    async function postDelete(sessionId, mode) {
      let response
      try {
        response = await fetch(endpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, mode }),
          credentials: 'same-origin',
        })
      } catch (error) {
        throw failure('network', 'network', error instanceof Error ? error.message : String(error))
      }
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (response.ok) return body ?? {}
      throw failure(
        body?.error ?? 'http-error',
        body?.message ?? `HTTP ${response.status}`,
        response.status,
      )
    }

    function failure(code, message, status) {
      const error = new Error(message)
      error.code = code
      error.status = typeof status === 'number' ? status : undefined
      return error
    }

    function errorText(error, t) {
      if (error?.status === 401 || error?.code === 'login-required') return t('error.login')
      if (error?.status === 403 || error?.code === 'untrusted-origin') return t('error.origin')
      if (error?.code === 'session/busy') return t('error.busy')
      if (error?.code === 'bad-request' || error?.code === 'invalid-session-id') return t('error.generic')
      if (error?.code === 'network' || error?.code === 'delete-failed') {
        return t('dialog.failed', { message: error?.message ?? '' })
      }
      return t('error.generic')
    }

    /* --------------------------------------------------------------- icon -- */

    function TrashIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
        h('path', { d: 'M2.8 4.4h10.4' }),
        h('path', { d: 'M6.2 4.4V3.1h3.6v1.3' }),
        h('path', { d: 'M4.3 4.4l.6 8.1h6.2l.6-8.1' }),
        h('path', { d: 'M6.7 6.9v3.3M9.3 6.9v3.3' }),
      )
    }

    /* ----------------------------------------------------------- menu row -- */

    function DeleteSessionMenuItem({
      sessionId,
      displayTitle,
      useMenuOpenState,
      useSessions,
      store,
      t,
    }) {
      const [, setMenuOpen] = useMenuOpenState()
      const list = useSessions((state) => state)
      let current = false
      if (list && list.byId) {
        for (const id of Object.keys(list.byId)) {
          const row = list.byId[id]
          if ((row?.retainedBy?.mainView ?? 0) > 0) {
            current = id === sessionId
            break
          }
        }
      }

      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsds-menu-item dsds-menu-item--separator',
        onClick: () => {
          setMenuOpen(false)
          store.open({
            sessionId,
            title: typeof displayTitle === 'string' && displayTitle.trim() !== ''
              ? displayTitle
              : t('untitled'),
            current,
          })
        },
      },
      h('span', { className: 'dsds-menu-icon' }, h(TrashIcon)),
      h('span', { className: 'dsds-menu-label' }, t('menu.delete')),
      )
    }

    /* -------------------------------------------------------------- dialog -- */

    function DialogButton({ variant, danger, disabled, autoFocus, onClick, children }) {
      const classes = ['dsds-btn']
      if (danger === true) classes.push('dsds-btn--danger')
      if (variant === 'primary') classes.push('dsds-btn--primary')
      return h('button', {
        type: 'button',
        className: classes.join(' '),
        disabled,
        'data-dsds-autofocus': autoFocus === true ? '' : undefined,
        onClick,
      }, children)
    }

    function DeleteSessionDialog({ store, closePanel, t }) {
      const request = React.useSyncExternalStore(store.subscribe, store.get, store.get)
      if (request === null) return null
      return h(DeleteSessionForm, {
        key: request.sessionId,
        request,
        store,
        closePanel,
        t,
      })
    }

    function DeleteSessionForm({ request, store, closePanel, t }) {
      const [phase, setPhase] = React.useState('confirm')
      const [error, setError] = React.useState(null)
      const panelRef = React.useRef(null)
      const busy = phase === 'busy'

      React.useEffect(() => {
        const previous = document.activeElement
        const panel = panelRef.current
        const target = panel?.querySelector('[data-dsds-autofocus]') ?? panel?.querySelector('button')
        const timer = setTimeout(() => target?.focus(), 0)
        return () => {
          clearTimeout(timer)
          if (previous && typeof previous.focus === 'function') previous.focus()
        }
      }, [])

      React.useEffect(() => {
        if (phase === 'confirm') return
        const panel = panelRef.current
        const target = panel?.querySelector('[data-dsds-autofocus]') ?? panel?.querySelector('.dsds-btn')
        target?.focus()
      }, [phase])

      const leave = () => {
        if (busy) return
        store.close()
      }

      const finish = () => {
        if (request.current) {
          try {
            closePanel()
          } catch (reason) {
            console.warn('[delete-session] could not close the current panel', reason)
          }
        }
        store.close()
      }

      const submit = async (mode) => {
        setPhase('busy')
        setError(null)
        try {
          const result = await postDelete(request.sessionId, mode)
          if (result?.deferred === true) {
            setPhase('deferred')
            return
          }
          finish()
        } catch (reason) {
          if (reason?.code === 'session/live' && mode !== 'defer') {
            setPhase('live')
            return
          }
          setPhase('error')
          setError(errorText(reason, t))
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          leave()
          return
        }
        if (event.key !== 'Tab') return
        const panel = panelRef.current
        if (!panel) return
        const nodes = [...panel.querySelectorAll('button:not([disabled])')]
        if (nodes.length === 0) {
          event.preventDefault()
          panel.focus()
          return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }

      const footer = (() => {
        if (phase === 'deferred') {
          return [h(DialogButton, {
            key: 'done',
            variant: 'primary',
            autoFocus: true,
            onClick: finish,
          }, t('action.done'))]
        }
        if (phase === 'live') {
          return [
            h(DialogButton, {
              key: 'cancel',
              autoFocus: true,
              onClick: leave,
            }, t('action.cancel')),
            h(DialogButton, {
              key: 'defer',
              danger: true,
              onClick: () => submit('defer'),
            }, t('dialog.defer')),
          ]
        }
        return [
          h(DialogButton, {
            key: 'cancel',
            disabled: busy,
            autoFocus: true,
            onClick: leave,
          }, t('action.cancel')),
          h(DialogButton, {
            key: 'delete',
            danger: true,
            disabled: busy,
            onClick: () => submit('delete'),
          }, t('action.delete')),
        ]
      })()

      return h('div', {
        className: 'dsds-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) leave()
        },
      },
      h('div', {
        ref: panelRef,
        className: 'dsds-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dsds-title',
        tabIndex: -1,
        onKeyDown,
      },
      h('button', {
        type: 'button',
        className: 'dsds-close',
        'aria-label': t('action.close'),
        onClick: leave,
      }, '×'),
      h('h2', { id: 'dsds-title', className: 'dsds-title' }, t('dialog.title')),
      h('p', { className: 'dsds-desc' }, t('dialog.desc', { title: request.title })),
      h('p', { className: 'dsds-note' }, t('dialog.note')),
      request.current ? h('p', { className: 'dsds-warn' }, t('dialog.current')) : null,
      phase === 'live' ? h('p', { className: 'dsds-warn' }, t('dialog.live')) : null,
      phase === 'deferred' ? h('p', { className: 'dsds-ok' }, t('dialog.deferred')) : null,
      busy ? h('p', { className: 'dsds-status', role: 'status' }, t('dialog.deleting')) : null,
      error !== null ? h('p', { className: 'dsds-error', role: 'alert' }, error) : null,
      h('div', { className: 'dsds-footer' }, footer),
      ),
      )
    }

    /* --------------------------------------------------------------- apply -- */

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const store = createRequestStore()
        const closePanel = () => {
          try {
            ctx.layout?.selectPanel?.(null)
          } catch (error) {
            console.warn('[delete-session] layout service refused to close the panel', error)
          }
        }

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'delete-session: dictionaries')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'delete-session'
          tag.dataset.pluginCss = 'delete-session/styles'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'delete-session: styles')

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'delete-session',
          order: 500,
          locale: NS,
          inject: () => ({ store }),
        }, DeleteSessionMenuItem))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'delete-session-dialog',
          order: 800,
          locale: NS,
          inject: () => ({ store, closePanel }),
        }, DeleteSessionDialog))
      },
    }
  },
})
