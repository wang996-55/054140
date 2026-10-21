
    // --------------------------------------------------------------- scene
    function sceneValueOptions(settings, path, fallback) {
      const enums = (settings && settings.enums) || {}
      const labels = (settings && settings.labels) || {}
      const list = enums[path] || fallback
      const table = labels[path] || {}
      return list.map(value => ({ value, label: table[value] || value }))
    }

    /* 商品信息（商品描述词）：上传商品图后由视觉模型按固定顺序提取
       1 商品名称 / 2 核心卖点 / 3 规格参数（颜色、外观）。可以改，也可以重新提取；
       这里的内容会进入场景分析与背景提示词。 */
    function ProductCard(props) {
      const product = (props.snapshot && props.snapshot.product) || {}
      const profile = product.profile || {}
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [open, setOpen] = useState(!product.profile)
      const [draft, setDraft] = useState(() => ({
        name: profile.name && profile.name !== '未提供' ? profile.name : '',
        selling_points: (profile.selling_points || []).join('；'),
        color: profile.color && profile.color !== '未提供' ? profile.color : '',
        appearance: profile.appearance && profile.appearance !== '未提供' ? profile.appearance : '',
      }))
      useEffect(() => {
        setDraft({
          name: profile.name && profile.name !== '未提供' ? profile.name : '',
          selling_points: (profile.selling_points || []).join('；'),
          color: profile.color && profile.color !== '未提供' ? profile.color : '',
          appearance: profile.appearance && profile.appearance !== '未提供' ? profile.appearance : '',
        })
      }, [product.created_at, product.source, profile.name, profile.color, profile.appearance])

      if (!product.has_product_image) return null

      const run = async (label, action, body, method) => {
        setBusy(true)
        setError('')
        try {
          const data = await taskApi(props.snapshot.task.id, action, { method: method || 'POST', body: body || {} })
          props.onChanged(data)
          if (props.notify) props.notify('ok', t('profileSaved'))
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      const describe = () => run('describe', 'describe')
      const save = () => run('save', 'product-profile', {
        profile: {
          name: draft.name,
          selling_points: draft.selling_points.split(/[；;、,，\n]+/).map(item => item.trim()).filter(Boolean).slice(0, 3),
          color: draft.color,
          appearance: draft.appearance,
        },
      }, 'PUT')

      const field = (label, key, rows) => h(Field, { label },
        rows
          ? h(TextArea, { value: draft[key], rows, onChange: value => setDraft(current => Object.assign({}, current, { [key]: value })) })
          : h(TextInput, { value: draft[key], onChange: value => setDraft(current => Object.assign({}, current, { [key]: value })) }))

      const hasProfile = Boolean(product.profile)
      return h('div', { style: Object.assign({}, ui.card, { borderLeft: `3px solid ${C.brand}` }) },
        h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between', alignItems: 'flex-start' }) },
          h('div', null,
            h('h3', { style: ui.h3 }, t('profileTitle')),
            h('p', { style: ui.p }, hasProfile ? t('profileIntro') : t('profileEmpty'))),
          h('div', { style: ui.row },
            product.source ? h(Badge, { tone: 'dim' }, product.source === 'manual' ? t('profileManual') : t('profileFromVision')) : null,
            h(Btn, { small: true, disabled: busy, title: t('costVision'), onClick: describe }, busy ? t('profileDescribing') : t('profileRedescribe')),
            h(Btn, { small: true, onClick: () => setOpen(value => !value) }, open ? t('profileCollapse') : t('profileEdit')))),
        error ? h('div', { style: { marginTop: 10 } }, h(Notice, { tone: 'bad' }, error)) : null,
        open
          ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 } },
            field(t('profileName'), 'name'),
            field(t('profilePoints'), 'selling_points'),
            field(t('profileColor'), 'color'),
            field(t('profileAppearance'), 'appearance'),
            h('div', { style: Object.assign({}, ui.row, { marginTop: 4 }) },
              h(Btn, { variant: 'primary', small: true, disabled: busy, onClick: save }, t('profileSave'))))
          : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 12 } },
            h('div', null, h('div', { style: ui.label }, t('profileName')), h('div', { style: ui.value }, draft.name || t('notProvided'))),
            h('div', null, h('div', { style: ui.label }, t('profilePoints')), h('div', { style: ui.value }, draft.selling_points || t('notProvided'))),
            h('div', null, h('div', { style: ui.label }, t('profileColor')), h('div', { style: ui.value }, draft.color || t('notProvided'))),
            h('div', null, h('div', { style: ui.label }, t('profileAppearance')), h('div', { style: ui.value }, draft.appearance || t('notProvided')))),
        h('p', { style: Object.assign({}, ui.p, { marginTop: 10, fontSize: 11.5 }) }, t('profileHint')))
    }

    function SceneStage(props) {
      const { snapshot, settings } = props
      const analysis = snapshot.scene.analysis
      const [scene, setScene] = useState(() => JSON.parse(JSON.stringify(snapshot.scene.effective || (analysis && analysis.scene) || {})))
      const [ack, setAck] = useState({})
      const [global, setGlobal] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [showRaw, setShowRaw] = useState(false)

      useEffect(() => {
        const next = snapshot.scene.effective || (analysis && analysis.scene)
        if (next) setScene(JSON.parse(JSON.stringify(next)))
      }, [snapshot.scene.effective, analysis])

      const patch = (path, value) => {
        setScene(current => {
          const next = JSON.parse(JSON.stringify(current))
          const parts = path.split('.')
          let cursor = next
          for (let index = 0; index < parts.length - 1; index += 1) {
            if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') cursor[parts[index]] = {}
            cursor = cursor[parts[index]]
          }
          cursor[parts[parts.length - 1]] = value
          return next
        })
      }

      const runAnalysis = async () => {
        setBusy(true)
        setError('')
        try {
          const data = await taskApi(snapshot.task.id, 'analyze', { method: 'POST', body: {} })
          props.onChanged(data)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      const saveReview = async () => {
        setBusy(true)
        setError('')
        try {
          const unknownPaths = ['camera.angle', 'camera.expected_product_view', 'lighting.direction', 'support_surface.type', 'placement.preferred_region']
          const confirmed = { 'placement.needs_user_confirmation': global }
          for (const path of unknownPaths) {
            const value = path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), scene)
            if (value === 'unknown' || value === undefined) confirmed[path] = ack[path] === true
          }
          const data = await taskApi(snapshot.task.id, 'scene-review', {
            method: 'PUT',
            body: { scene, confirmed },
          })
          props.onChanged(data)
          props.notify('ok', t('sceneSaved'))
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      if (!analysis) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(ProductCard, { snapshot, notify: props.notify, onChanged: props.onChanged }),
          h('div', { style: Object.assign({}, ui.card, { display: 'flex', flexDirection: 'column', gap: 12 }) },
            h('h3', { style: ui.h3 }, t('step2')),
            h('p', { style: ui.p }, t('sceneIntro')),
            error ? h(Notice, { tone: 'bad' }, error) : null,
            h('div', { style: ui.row },
              h(Btn, { variant: 'primary', disabled: busy, onClick: runAnalysis }, busy ? t('analyzing') : t('analyze')),
              h('span', { style: { fontSize: 12, color: C.dim } }, t('costVision')))))
      }

      const unknownPaths = ['camera.angle', 'camera.expected_product_view', 'lighting.direction', 'support_surface.type', 'placement.preferred_region']
      const unknowns = unknownPaths.filter(path => {
        const value = path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), scene)
        return value === 'unknown' || value === undefined
      })
      const budget = snapshot.task.budget
      const canReanalyze = budget.vision_calls < budget.max_vision_calls

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(ProductCard, { snapshot, notify: props.notify, onChanged: props.onChanged }),
        h('div', { style: ui.card },
          h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
            h('div', null,
              h('h3', { style: ui.h3 }, t('sceneTitle')),
              h('p', { style: ui.p }, t('sceneIntro'))),
            h('div', { style: ui.row },
              h(Badge, { tone: 'dim' }, t('budgetLine', { v: budget.vision_calls, vm: budget.max_vision_calls, i: budget.image_calls, im: budget.max_image_calls })),
              h(Btn, { small: true, disabled: busy || !canReanalyze, onClick: runAnalysis, title: t('costVision') }, t('reanalyze')))),
          error ? h('div', { style: { marginTop: 10 } }, h(Notice, { tone: 'bad' }, error)) : null,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 } },
            h(Field, { label: t('referenceType') },
              h(Select, { value: scene.reference_type, options: sceneValueOptions(settings, 'reference_type', ['ecommerce', 'apparel', 'marketing_poster', 'social_post', 'creative_poster', 'other']), onChange: value => patch('reference_type', value) })),
            h(Field, { label: '机位 / camera.angle' },
              h(Select, { value: scene.camera.angle, options: sceneValueOptions(settings, 'camera.angle', ['eye_level', 'top_down', 'three_quarter', 'low_angle', 'unknown']), onChange: value => patch('camera.angle', value) })),
            h(Field, { label: '商品应呈视角 / expected_product_view' },
              h(Select, { value: scene.camera.expected_product_view, options: sceneValueOptions(settings, 'camera.expected_product_view', ['front', 'side', 'back', 'top', 'angle_45', 'unknown']), onChange: value => patch('camera.expected_product_view', value) })),
            h(Field, { label: '光源方向 / lighting.direction' },
              h(Select, { value: scene.lighting.direction, options: sceneValueOptions(settings, 'lighting.direction', ['top_left', 'top_right', 'left', 'right', 'top', 'front', 'back', 'diffuse', 'mixed', 'unknown']), onChange: value => patch('lighting.direction', value) })),
            h(Field, { label: '光质 / softness' },
              h(Select, { value: scene.lighting.softness, options: sceneValueOptions(settings, 'lighting.softness', ['hard', 'soft', 'diffuse', 'unknown']), onChange: value => patch('lighting.softness', value) })),
            h(Field, { label: '色温 / temperature' },
              h(Select, { value: scene.lighting.temperature, options: sceneValueOptions(settings, 'lighting.temperature', ['warm', 'neutral', 'cool', 'unknown']), onChange: value => patch('lighting.temperature', value) })),
            h(Field, { label: '承载面 / support_surface.type' },
              h(Select, { value: scene.support_surface.type, options: sceneValueOptions(settings, 'support_surface.type', ['tabletop', 'floor', 'podium', 'shelf', 'wall', 'suspended', 'none', 'unknown']), onChange: value => patch('support_surface.type', value) })),
            h(Field, { label: '承载面朝向 / orientation' },
              h(Select, { value: scene.support_surface.orientation, options: sceneValueOptions(settings, 'support_surface.orientation', ['horizontal', 'vertical', 'unknown']), onChange: value => patch('support_surface.orientation', value) })),
            h(Field, { label: '落点 / contact_point_hint' },
              h(Select, { value: scene.support_surface.contact_point_hint, options: sceneValueOptions(settings, 'support_surface.contact_point_hint', ['bottom_center', 'bottom_left', 'bottom_right', 'center', 'unknown']), onChange: value => patch('support_surface.contact_point_hint', value) })),
            h(Field, { label: '预留位置 / preferred_region' },
              h(Select, { value: scene.placement.preferred_region, options: sceneValueOptions(settings, 'placement.preferred_region', ['center', 'left', 'right', 'top', 'bottom', 'full_bleed', 'unknown']), onChange: value => patch('placement.preferred_region', value) })),
            h(Field, { label: '留白 / clearance' },
              h(Select, { value: scene.placement.clearance, options: sceneValueOptions(settings, 'placement.clearance', ['clear', 'partial', 'blocked', 'unknown']), onChange: value => patch('placement.clearance', value) })),
            h(Field, { label: t('description') },
              h(TextArea, { value: scene.scene_description, rows: 2, onChange: value => patch('scene_description', value) }))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 } },
            h(Field, { label: t('styleTags') },
              h(TextInput, { value: (scene.style_tags || []).join(', '), onChange: value => patch('style_tags', value.split(',').map(item => item.trim()).filter(Boolean)) })),
            h(Field, { label: t('palette') },
              h(TextInput, {
                value: (scene.color_palette || []).map(item => item.hex).join(', '),
                onChange: value => patch('color_palette', value.split(',').map(item => item.trim()).filter(Boolean).map(hex => ({ hex }))),
              })),
            h(Field, { label: t('risks') },
              h(TextInput, { value: (scene.risks || []).join('; '), onChange: value => patch('risks', value.split(';').map(item => item.trim()).filter(Boolean)) }))),
         h('details', { style: { marginTop: 12 } },
            h('summary', { style: { fontSize: 12, color: C.dim, cursor: 'pointer' } }, t('sceneRaw')),
            h('pre', { style: Object.assign({}, ui.mono, { marginTop: 8, maxHeight: 220, overflow: 'auto', background: C.layer2, padding: 10, borderRadius: 8 }) }, analysis.raw_text || JSON.stringify(analysis.scene, null, 2))),
          h('p', { style: Object.assign({}, ui.p, { marginTop: 10, fontSize: 11.5 }) }, t('confidenceNote'))),
        unknowns.length
          ? h('div', { style: ui.card },
            h('h3', { style: ui.h3 }, t('mustConfirm')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 } },
              unknowns.map(path => h(Check, {
                key: path,
                checked: ack[path] === true,
                onChange: value => setAck(current => Object.assign({}, current, { [path]: value })),
              }, h('code', { style: ui.mono }, path), ' — ', t('confirmKeep')))))
          : null,
        h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }) },
          h(Check, { checked: global, onChange: setGlobal }, '我已逐项核对机位、光线、承载面与预留区域'),
          h(Btn, { variant: 'primary', disabled: busy || !global, onClick: saveReview }, busy ? t('saving') : t('saveReview'))))
    }
