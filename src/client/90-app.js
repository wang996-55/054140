
    // --------------------------------------------------------------- shell
    function ReplicaIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 3.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 8.5, cy: 10, r: 1.6, fill: 'currentColor' }),
        h('path', { d: 'M4.5 17.5l4.6-4.2 3.2 2.9 2.9-2.4 4.3 3.7', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M17.4 3.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z', fill: 'currentColor' }))
    }

    class AppBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      render() {
        if (this.state.error) {
          return h('div', { style: Object.assign({}, ui.card, { margin: 16, display: 'flex', flexDirection: 'column', gap: 10 }) },
            h('h3', { style: ui.h3 }, '页面渲染出错'),
            h('pre', { style: ui.mono }, String((this.state.error && this.state.error.stack) || this.state.error)),
            h(Btn, { onClick: () => { this.setState({ error: null }); try { window.location.reload() } catch { /* ignore */ } } }, t('refresh')))
        }
        return this.props.children
      }
    }

    function App(props) {
      const ctx = props.ctx
      useLang(ctx)
      const [view, setView] = useState(() => readStore(LS_VIEW, 'home') || 'home')
      const [taskId, setTaskId] = useState(() => readStore(LS_LAST_TASK, '') || '')
      const [snapshot, setSnapshot] = useState(null)
      const [settings, setSettings] = useState(null)
      const [health, setHealth] = useState(null)
      const [toast, setToast] = useState(null)
      const [error, setError] = useState('')

      const notify = useCallback((tone, message) => {
        setToast({ tone, message, at: Date.now() })
      }, [])

      useEffect(() => {
        if (!toast) return undefined
        const timer = window.setTimeout(() => setToast(null), 3200)
        return () => window.clearTimeout(timer)
      }, [toast])

      useEffect(() => {
        api('/settings')
          .then(data => {
            setSettings(data)
            setHealth({ has_key: data.has_key, key_source: data.key_source })
          })
          .catch(failure => setError(failure.message))
      }, [])

      const applySnapshot = useCallback(data => {
        if (data && data.task) {
          setSnapshot(data)
          setTaskId(data.task.id)
          writeStore(LS_LAST_TASK, data.task.id)
        }
      }, [])

      const refresh = useCallback(async () => {
        if (!taskId) return null
        const data = await api(`/tasks/${taskId}`)
        setSnapshot(data)
        return data
      }, [taskId])

      useEffect(() => {
        if (view !== 'task' || !taskId) return undefined
        let cancelled = false
        api(`/tasks/${taskId}`)
          .then(data => { if (!cancelled) setSnapshot(data) })
          .catch(failure => { if (!cancelled) setError(failure.message) })
        return () => { cancelled = true }
      }, [view, taskId])

      const go = useCallback(next => {
        setView(next)
        writeStore(LS_VIEW, next)
      }, [])

      const openTask = useCallback(id => {
        setTaskId(id)
        writeStore(LS_LAST_TASK, id)
        setSnapshot(null)
        go('task')
      }, [go])

      const onCreated = useCallback(data => {
        applySnapshot(data)
        go('task')
      }, [applySnapshot, go])

      const configured = health && health.has_key

      const navItems = [
        { id: 'home', label: t('navHome') },
        { id: 'task', label: t('navTask') },
        { id: 'history', label: t('navHistory') },
        { id: 'settings', label: t('navSettings') },
      ]

      let body = null
      if (view === 'home') body = h(HomeView, { settings, onCreated })
      else if (view === 'history') body = h(HistoryView, { onOpen: openTask })
      else if (view === 'settings') body = h(SettingsView, { onSettings: data => { setSettings(data); setHealth({ has_key: data.has_key, key_source: data.key_source }) } })
      else if (view === 'task') {
        body = snapshot && snapshot.task
          ? h(TaskView, { snapshot, settings, refresh, notify, onChanged: applySnapshot })
          : h('div', { style: Object.assign({}, ui.card, { display: 'flex', gap: 10, alignItems: 'center' }) },
            h(Spinner),
            h('span', null, t('loading')),
            taskId ? null : h(Btn, { small: true, onClick: () => go('home') }, t('navHome')))
      }

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px 40px',
          background: C.bg, color: C.text, minHeight: '100%', boxSizing: 'border-box',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } },
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
          h('div', {
            style: {
              width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.layer2, border: `1px solid ${C.border}`, color: C.brand,
            },
          }, h(ReplicaIcon)),
          h('div', null,
            h('div', { style: { fontSize: 17, fontWeight: 700, letterSpacing: 0.2 } }, t('appTitle')),
            h('div', { style: { fontSize: 12, color: C.dim } }, t('appSubtitle')))),
        h('div', { style: Object.assign({}, ui.row, { gap: 6 }) },
          navItems.map(item => h(Btn, {
            key: item.id,
            small: true,
            variant: view === item.id ? 'primary' : 'ghost',
            onClick: () => go(item.id),
          }, item.label)),
          health ? h(Badge, { tone: configured ? 'ok' : 'warn' }, configured ? `v${health.version || ''}` : t('notConfigured')) : null)),
      error ? h(Notice, { tone: 'bad' }, `${t('errorPrefix')}${error}`) : null,
      !configured && view !== 'settings'
        ? h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }) },
          h('span', { style: { fontSize: 12.5, color: C.dim } }, t('notConfigured')),
          h(Btn, { small: true, onClick: () => go('settings') }, t('goSettings')))
        : null,
      body,
      toast
        ? h('div', {
          style: {
            position: 'fixed', right: 24, bottom: 24, zIndex: 60, padding: '10px 16px', borderRadius: 10,
            fontSize: 12.5, background: C.layer1, color: C.text,
            border: `1px solid ${toast.tone === 'bad' ? C.bad : toast.tone === 'ok' ? C.ok : C.border}`,
            boxShadow: '0 8px 26px rgba(0,0,0,0.18)', maxWidth: 420,
          },
        }, toast.message)
        : null)
    }

    function Page(props) {
      return h(AppBoundary, null, h(App, { ctx: props.ctx }))
    }

    return {
      inject: ['slots', 'locale', 'theme', 'layout', 'uiWorkspace'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'ai-replica' }, () => h(Page, { ctx })))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'ai-replica',
            order: -12,
            label: () => {
              try {
                const snapshot = ctx.locale.getLocale()
                const id = String((snapshot && (snapshot.id || snapshot.locale)) || '')
                return id.toLowerCase().indexOf('en') === 0 ? 'Replica Studio' : '爆款图复刻'
              } catch {
                return '爆款图复刻'
              }
            },
          }, ReplicaIcon))
      },
    }
  },
})
