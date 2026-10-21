
    // ---------------------------------------------------------------- task
    const STEP_OF_STATE = {
      created: 0,
      analyzing: 1,
      scene_review: 2,
      mask_review: 3,
      mask_rejected: 3,
      background_review: 5,
      editing: 6,
      exporting: 6,
      done: 7,
      failed: 0,
      cancelled: 0,
      remote_outcome_unknown: 1,
    }

    function Stepper(props) {
      const current = STEP_OF_STATE[props.state] != null ? STEP_OF_STATE[props.state] : 0
      const labels = [t('step1'), t('step2'), t('step3'), t('step4'), t('step5'), t('step6'), t('step7'), t('step8')]
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        labels.map((label, index) => h('div', {
          key: label,
          style: {
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
            fontSize: 11.5,
            border: `1px solid ${index === current ? C.brand : C.border}`,
            color: index < current ? C.dim : index === current ? C.text : C.dim,
            background: index === current ? C.layer2 : 'transparent',
            fontWeight: index === current ? 700 : 500,
          },
        },
        h('span', {
          style: {
            width: 16, height: 16, borderRadius: '50%', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 10,
            background: index < current ? C.ok : index === current ? C.brand : C.layer2,
            color: index < current || index === current ? '#ffffff' : C.dim,
          },
        }, index < current ? '✓' : String(index + 1)),
        label)))
    }

    function AcceptStage(props) {
      const { snapshot } = props
      const [rating, setRating] = useState(snapshot.task.accept && snapshot.task.accept.rating ? snapshot.task.accept.rating : 4)
      const [notes, setNotes] = useState((snapshot.task.accept && snapshot.task.accept.notes) || '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const lastExport = (snapshot.task.exports || [])[snapshot.task.exports.length - 1]
      const url = lastExport
        ? `${API}/file?task=${encodeURIComponent(snapshot.task.id)}&file=${encodeURIComponent(lastExport.file.split('/').pop())}`
        : ''

      const submit = async () => {
        setBusy(true)
        setError('')
        try {
          const data = await taskApi(snapshot.task.id, 'accept', { method: 'POST', body: { rating, notes } })
          props.onChanged(data)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 14, alignItems: 'start' } },
        h('div', { style: ui.card },
          h('h3', { style: ui.h3 }, t('exportResult')),
          url ? h('img', { src: url, alt: 'export', style: { width: '100%', borderRadius: 12, marginTop: 8 } }) : h('p', { style: ui.p }, t('empty')),
          h('div', { style: Object.assign({}, ui.row, { marginTop: 10 }) },
            url ? h(Btn, { variant: 'primary', onClick: () => downloadDataUrl(url, lastExport.file.split('/').pop()) }, t('downloadPng')) : null,
            h(Btn, { onClick: () => api('/reveal', { method: 'POST', body: { task: snapshot.task.id } }).catch(() => {}) }, t('openDir')))),
        h('div', { style: ui.card },
          h('h3', { style: ui.h3 }, t('acceptTitle')),
          h('p', { style: ui.p }, t('acceptIntro')),
          error ? h('div', { style: { marginTop: 8 } }, h(Notice, { tone: 'bad' }, error)) : null,
          h('div', { style: { marginTop: 10 } },
            h(Field, { label: t('rating') },
              h(Select, {
                value: String(rating),
                options: [5, 4, 3, 2, 1].map(value => ({ value: String(value), label: `${value} / 5` })),
                onChange: value => setRating(Number(value)),
              })),
            h(Field, { label: t('notes') },
              h(TextArea, { rows: 4, value: notes, onChange: setNotes })),
            h(Btn, { variant: 'primary', disabled: busy, onClick: submit }, busy ? t('saving') : t('accept')))))
    }

    function TaskView(props) {
      const { snapshot, refresh, notify } = props
      const state = snapshot.task.state
      const busyState = ACTIVE_STATES.indexOf(state) >= 0

      useEffect(() => {
        const timer = window.setInterval(() => {
          refresh().catch(() => {})
        }, 2000)
        return () => window.clearInterval(timer)
      }, [refresh])

      const cancel = async () => {
        try {
          const data = await taskApi(snapshot.task.id, 'cancel', { method: 'POST', body: {} })
          props.onChanged(data)
        } catch (failure) {
          notify('bad', failure.message)
        }
      }

      let stage = null
      if (state === 'done') {
        stage = h(AcceptStage, { snapshot, onChanged: props.onChanged, notify })
      } else if (state === 'editing' || state === 'exporting') {
        stage = h(Workbench, { snapshot, onChanged: props.onChanged, notify })
      } else if (state === 'background_review') {
        stage = h(BackgroundStage, { snapshot, onChanged: props.onChanged, notify })
      } else if (state === 'mask_review' || state === 'mask_rejected') {
        stage = h(MaskStage, { snapshot, onChanged: props.onChanged, notify })
      } else if (state === 'analyzing') {
        stage = h('div', { style: Object.assign({}, ui.card, { display: 'flex', gap: 10, alignItems: 'center' }) }, h(Spinner), h('span', null, t('analyzing')))
      } else {
        stage = h(SceneStage, { snapshot, settings: props.settings, onChanged: props.onChanged, notify })
      }

      const banners = []
      if (state === 'remote_outcome_unknown') {
        banners.push(h(Notice, { key: 'unknown', tone: 'warn' }, h('strong', null, t('timeoutTitle')), h('div', { style: { marginTop: 4 } }, t('timeoutBody'))))
      }
      if (state === 'failed') {
        banners.push(h(Notice, { key: 'failed', tone: 'bad' }, `${t('errorPrefix')}${(snapshot.task.error && snapshot.task.error.message) || 'unknown'}`))
      }
      if (state === 'cancelled') {
        banners.push(h(Notice, { key: 'cancelled', tone: 'warn' }, t('st_cancelled')))
      }
      if (snapshot.task.compatibility && snapshot.task.compatibility.level === 'warn') {
        const issues = (snapshot.task.compatibility.issues || []).map(item => item.zh).join('；')
        banners.push(h(Notice, { key: 'compat', tone: 'warn' }, `视角提示：${issues}`))
      }
      if (snapshot.task.compatibility && snapshot.task.compatibility.overridden === true) {
        banners.push(h(Notice, { key: 'override', tone: 'dim' }, '已按你的确认继续：商品视角与参考场景不一致。'))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', flexDirection: 'column', gap: 10 }) },
          h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
            h('div', { style: ui.row },
              h(Badge, { tone: state === 'done' ? 'ok' : state === 'failed' ? 'bad' : 'dim' }, t(`st_${state}`) || state),
              h('span', { style: { fontSize: 11.5, color: C.dim } }, snapshot.task.id),
              snapshot.task.form ? h(Badge, { tone: 'dim' }, `${snapshot.task.form.aspect} · ${snapshot.task.form.output_size}`) : null),
            h('div', { style: ui.row },
              h(Btn, { small: true, variant: 'ghost', onClick: () => refresh().catch(() => {}) }, t('refresh')),
              state !== 'done' && state !== 'cancelled' ? h(Btn, { small: true, variant: 'ghost', onClick: cancel }, t('cancelTask')) : null)),
          h(Stepper, { state })),
        banners,
        stage)
    }
