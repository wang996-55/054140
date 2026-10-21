
    // ---------------------------------------------------------- background
    function BackgroundStage(props) {
      const { snapshot } = props
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [checks, setChecks] = useState({ a: false, b: false, c: false })
      const [active, setActive] = useState(null)
      const versions = snapshot.task.backgrounds || []
      const budget = snapshot.task.budget
      const prompt = snapshot.prompts && snapshot.prompts.background
      const allChecked = checks.a && checks.b && checks.c

      useEffect(() => {
        if (active === null && versions.length > 0) {
          const selected = versions.find(item => item.id === snapshot.task.background_version_id)
          setActive(selected ? selected.id : versions[versions.length - 1].id)
        }
      }, [versions.length, snapshot.task.background_version_id, active])

      const run = async (label, work) => {
        setBusy(label)
        setError('')
        try {
          const data = await work()
          props.onChanged(data)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      const generate = () => run('generate', () => api(`/tasks/${snapshot.task.id}/background`, { method: 'POST', body: { mode: 'generate' } }))

      const upload = async file => {
        if (!file) return
        const dataUrl = await fileToDataUrl(file)
        run('upload', () => api(`/tasks/${snapshot.task.id}/background`, {
          method: 'POST',
          body: { mode: 'upload', image: { data_url: dataUrl, name: file.name } },
        }))
      }

      const normalize = async version => {
        const entry = (snapshot.urls.backgrounds || []).find(item => item.id === version.id)
        const image = await loadImage(entry ? entry.url : snapshot.urls.product)
        const size = snapshot.task.form ? aspectSize(snapshot.task.form.aspect, snapshot.task.form.output_size) : { width: 1024, height: 1024 }
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size.width, size.height)
        const scale = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight)
        const drawWidth = image.naturalWidth * scale
        const drawHeight = image.naturalHeight * scale
        ctx.drawImage(image, (size.width - drawWidth) / 2, (size.height - drawHeight) / 2, drawWidth, drawHeight)
        return canvasToPngDataUrl(canvas)
      }

      const select = () => {
        const version = versions.find(item => item.id === active)
        if (!version) return
        run('select', async () => {
          const normalized = await normalize(version)
          return api(`/tasks/${snapshot.task.id}/background`, {
            method: 'POST',
            body: { mode: 'select', version_id: version.id, normalized_png: normalized, confirm: allChecked },
          })
        })
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: ui.card },
          h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
            h('div', null,
              h('h3', { style: ui.h3 }, t('bgTitle')),
              h('p', { style: ui.p }, t('promptHint'))),
            h(Badge, { tone: 'dim' }, t('budgetLine', { v: budget.vision_calls, vm: budget.max_vision_calls, i: budget.image_calls, im: budget.max_image_calls }))),
          error ? h('div', { style: { marginTop: 10 } }, h(Notice, { tone: 'bad' }, error)) : null,
          prompt ? h('details', { style: { marginTop: 10 } },
            h('summary', { style: { fontSize: 12, color: C.dim, cursor: 'pointer' } }, t('promptTitle')),
            h('pre', { style: Object.assign({}, ui.mono, { marginTop: 8, maxHeight: 200, overflow: 'auto', background: C.layer2, padding: 10, borderRadius: 8 }) }, prompt.text)) : null,
          h('div', { style: Object.assign({}, ui.row, { marginTop: 12 }) },
            h(Btn, {
              variant: 'primary',
              disabled: busy !== '' || budget.image_calls >= budget.max_image_calls,
              title: t('costImage'),
              onClick: generate,
            }, busy === 'generate' ? t('generating') : t('generate')),
            h('label', {
              style: {
                display: 'inline-flex', alignItems: 'center', padding: '8px 14px', borderRadius: 9,
                border: `1px solid ${C.border}`, background: C.layer2, fontSize: 13, cursor: 'pointer', color: C.text,
              },
            },
            t('uploadBg'),
            h('input', {
              type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' },
              onChange: event => {
                const file = event.target.files && event.target.files[0]
                event.target.value = ''
                upload(file)
              },
            })),
            busy ? h(Spinner) : null)),
        h('div', { style: ui.card },
          h('h3', { style: ui.h3 }, t('versions')),
          versions.length === 0
            ? h('p', { style: ui.p }, t('noBg'))
            : h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 } },
              versions.map(version => h('div', { key: version.id, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h(Thumb, {
                  src: ((snapshot.urls.backgrounds || []).find(item => item.id === version.id) || {}).url,
                  size: 160,
                  active: active === version.id,
                  onClick: () => setActive(version.id),
                  placeholder: version.source,
                }),
                h('div', { style: Object.assign({}, ui.row, { gap: 6, justifyContent: 'space-between', maxWidth: 160 }) },
                  h(Badge, { tone: version.source === 'upload' ? 'ok' : 'dim' }, version.source === 'upload' ? '手动上传' : 'AI 生成'),
                  version.sha256 ? h('span', { style: { fontSize: 10.5, color: C.dim } }, version.sha256.slice(0, 8)) : null)))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 } },
            h(Check, { checked: checks.a, onChange: value => setChecks(current => Object.assign({}, current, { a: value })) }, t('checklist1')),
            h(Check, { checked: checks.b, onChange: value => setChecks(current => Object.assign({}, current, { b: value })) }, t('checklist2')),
            h(Check, { checked: checks.c, onChange: value => setChecks(current => Object.assign({}, current, { c: value })) }, t('checklist3'))),
          h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between', marginTop: 14 }) },
            h('span', { style: { fontSize: 12, color: C.dim } }, t('bgGate')),
            h('div', { style: ui.row },
              h(Btn, {
                disabled: busy !== '' || versions.length === 0 || active === null,
                onClick: select,
              }, busy === 'select' ? t('working') : t('confirmBg')),
              h(Btn, {
                variant: 'ghost',
                disabled: busy !== '' || budget.image_calls >= budget.max_image_calls,
                onClick: generate,
                title: t('costImage'),
              }, t('forceNew'))))))
    }
