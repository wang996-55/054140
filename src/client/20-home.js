
    // ---------------------------------------------------------------- home
    const DEFAULT_FORM = {
      reference_type: 'ecommerce',
      mode: 'style_reference',
      fidelity: 0.8,
      creative_mode: false,
      product_view: 'front',
      product_kind: 'apparel',
      user_requirement: '',
      lang: 'zh',
      aspect: '1:1',
      output_size: 1024,
      background_count: 1,
    }

    function HomeView(props) {
      const [form, setForm] = useState(() => Object.assign({}, DEFAULT_FORM, readStore(LS_DRAFT, {}) || {}))
      const [images, setImages] = useState({ reference: null, product: null })
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const labels = (props.settings && props.settings.labels) || {}
      const enums = (props.settings && props.settings.enums) || {}

      const patch = useCallback(patchValue => {
        setForm(current => {
          const next = Object.assign({}, current, patchValue)
          writeStore(LS_DRAFT, next)
          return next
        })
      }, [])

      const pick = async (kind, file) => {
        if (!file) return
        try {
          const dataUrl = await fileToDataUrl(file)
          setImages(current => Object.assign({}, current, { [kind]: { dataUrl, name: file.name } }))
          setError('')
        } catch (failure) {
          setError(failure.message)
        }
      }

      const optionsOf = (path, fallback) => {
        const list = enums[path] || fallback
        const table = labels[path] || {}
        return list.map(value => ({ value, label: table[value] || value }))
      }

      const submit = async () => {
        if (!images.reference) {
          setError(t('needReference'))
          return
        }
        if (!images.product && !form.creative_mode) {
          setError(t('needProduct'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const payload = {
            form,
            images: {
              reference: { data_url: images.reference.dataUrl, name: images.reference.name },
              product: images.product ? { data_url: images.product.dataUrl, name: images.product.name } : null,
            },
          }
          const data = await api('/tasks', { method: 'POST', body: payload })
          props.onCreated(data)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      const upload = (kind, label) => h('div', null,
        h('label', { style: ui.label }, label),
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
          images[kind]
            ? h(Thumb, { src: images[kind].dataUrl, size: 108 })
            : h('div', {
              style: {
                width: 108, height: 108, borderRadius: 10, border: `1px dashed ${C.border2}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 12,
              },
            }, t('pickImage')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('label', {
              style: {
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: C.layer2, fontSize: 12.5, color: C.text,
              },
            },
            images[kind] ? t('replaceImage') : t('pickImage'),
            h('input', {
              type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' },
              onChange: event => {
                const file = event.target.files && event.target.files[0]
                event.target.value = ''
                pick(kind, file)
              },
            })),
            images[kind] ? h('div', { style: { fontSize: 11.5, color: C.dim, maxWidth: 220, wordBreak: 'break-all' } }, images[kind].name) : null,
            images[kind]
              ? h(Btn, {
                small: true,
                variant: 'ghost',
                onClick: () => setImages(current => Object.assign({}, current, { [kind]: null })),
              }, t('removeImage'))
              : null)))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 } },
        h('div', null,
          h('h2', { style: ui.h2 }, t('homeTitle')),
          h('p', { style: ui.p }, t('homeIntro'))),
        error ? h(Notice, { tone: 'bad' }, error) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 } },
          h('div', { style: ui.card },
            h('h3', { style: ui.h3 }, t('referenceTitle')),
            h('p', { style: Object.assign({}, ui.p, { marginBottom: 10 }) }, t('referenceHint')),
            upload('reference', t('referenceTitle')))
          ,
          h('div', { style: ui.card },
            h('h3', { style: ui.h3 }, t('productTitle')),
            h('p', { style: Object.assign({}, ui.p, { marginBottom: 10 }) }, t('productHint')),
            upload('product', t('productTitle')),
            h('div', { style: { marginTop: 12 } },
              h(Check, {
                checked: form.creative_mode === true,
                onChange: value => patch({ creative_mode: value }),
              }, t('creativeMode'))),
            h('p', { style: Object.assign({}, ui.p, { marginTop: 4, fontSize: 11.5 }) }, t('creativeHint')))),
        h('div', { style: ui.card },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 } },
            h(Field, { label: t('referenceType') },
              h(Select, { value: form.reference_type, options: optionsOf('reference_type', ['ecommerce', 'apparel', 'marketing_poster', 'social_post', 'creative_poster', 'other']), onChange: value => patch({ reference_type: value }) })),
            h(Field, { label: t('mode') },
              h(Select, {
                value: form.mode,
                options: [{ value: 'style_reference', label: t('modeStyle') }, { value: 'high_fidelity', label: t('modeFidelity') }],
                onChange: value => patch({ mode: value }),
              })),
            h(Field, { label: t('fidelity') },
              h(Range, { min: 0, max: 1, step: 0.05, value: form.fidelity, onChange: value => patch({ fidelity: value }), display: `${Math.round(form.fidelity * 100)}%` })),
            h(Field, { label: t('productView') },
              h(Select, { value: form.product_view, options: optionsOf('camera.expected_product_view', ['front', 'side', 'back', 'top', 'angle_45', 'unknown']), onChange: value => patch({ product_view: value }) })),
            h(Field, { label: t('productKind') },
              h(Select, {
                value: form.product_kind,
                options: [{ value: 'apparel', label: t('kindApparel') }, { value: 'non_apparel', label: t('kindOther') }],
                onChange: value => patch({ product_kind: value }),
              })),
            h(Field, { label: t('lang') },
              h(Select, {
                value: form.lang,
                options: [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }],
                onChange: value => patch({ lang: value }),
              })),
            h(Field, { label: t('aspect') },
              h(Select, {
                value: form.aspect,
                options: ['1:1', '4:5', '3:4', '16:9'].map(value => ({ value, label: value })),
                onChange: value => patch({ aspect: value }),
              })),
            h(Field, { label: t('outputSize') },
              h(Select, {
                value: String(form.output_size),
                options: [768, 1024, 1280, 1536].map(value => ({ value: String(value), label: String(value) })),
                onChange: value => patch({ output_size: Number(value) }),
              })),
            h(Field, { label: t('backgroundCount') },
              h(Select, {
                value: String(form.background_count),
                options: [{ value: '1', label: '1' }, { value: '2', label: '2' }],
                onChange: value => patch({ background_count: Number(value) }),
              }))),
          h('div', { style: { marginTop: 12 } },
            h(Field, { label: t('requirement'), hint: t('requirementHint') },
              h(TextArea, { value: form.user_requirement, rows: 3, placeholder: t('requirementHint'), onChange: value => patch({ user_requirement: value }) })))),
        h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', gap: 16, alignItems: 'flex-start' }) },
          h('div', { style: { flex: 1 } },
            h('h3', { style: ui.h3 }, t('tipsTitle')),
            h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: C.dim, lineHeight: 1.8 } },
              h('li', null, t('tip1')),
              h('li', null, t('tip2')))),
          h(Btn, { variant: 'primary', disabled: busy, onClick: submit }, busy ? t('submitting') : t('submit'))))
    }
