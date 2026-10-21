
    // ------------------------------------------------------------ settings
    /* 视觉与生图两条独立通道：各填各的中转站、路径、模型、鉴权与 Key。
       下拉选项由 Host 下发的 relay 枚举驱动，第三方中转站新协议不必改页面。

       页面分三页签（视觉 / 生图 / 共享），切换时内容横向滑入、页签高亮块跟着滑动，
       避免两条长表单竖着堆成一页把「保存」挤到屏幕外；保存条固定在底部，永远点得到。 */
    const PROVIDER_LABELS = {
      openai_chat: 'OpenAI Chat（/chat/completions）',
      openai_responses: 'OpenAI Responses（/responses）',
      anthropic: 'Anthropic Messages（/messages）',
      gemini: 'Google Gemini（:generateContent）',
      openai_images: 'OpenAI Images（/images/generations）',
    }
    const AUTH_LABELS = {
      bearer: 'Authorization: Bearer',
      'x-api-key': 'x-api-key（Anthropic 风格）',
      'api-key': 'api-key（Azure 风格）',
      google: 'x-goog-api-key（Google）',
      none: '不鉴权（本机代理）',
    }

    const providerOptions = list => (Array.isArray(list) ? list : ['openai_chat', 'openai_images'])
      .map(value => ({ value, label: PROVIDER_LABELS[value] || value }))
    const authOptions = list => (Array.isArray(list) ? list : ['bearer', 'x-api-key', 'api-key', 'google', 'none'])
      .map(value => ({ value, label: AUTH_LABELS[value] || value }))

    const SETTINGS_TABS = ['vision', 'image', 'shared']

    function ChannelCard(props) {
      const { channel, onChange, relay } = props
      const set = (path, value) => {
        const next = JSON.parse(JSON.stringify(channel))
        const parts = path.split('.')
        let cursor = next
        for (let index = 0; index < parts.length - 1; index += 1) {
          if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') cursor[parts[index]] = {}
          cursor = cursor[parts[index]]
        }
        cursor[parts[parts.length - 1]] = value
        onChange(next)
      }
      const hasKey = Boolean(props.keyState && props.keyState.has_key)
      return h('div', { style: ui.card },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('h3', { style: ui.h3 }, props.title),
          h(Badge, { tone: hasKey ? 'ok' : 'warn' },
            hasKey ? (props.keyState.source === 'env' ? t('keyEnv') : t('keySaved')) : t('noKey'))),
        h('p', { style: Object.assign({}, ui.p, { marginTop: 4 }) }, props.hint),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 10 } },
          h(Field, { label: t('provider') },
            h(Select, { value: channel.provider, options: providerOptions(props.providers), onChange: value => set('provider', value) })),
          h(Field, { label: t('relayUrl'), hint: t('relayUrlHint') },
            h(TextInput, { value: channel.base_url, placeholder: 'https://relay.example.com/v1', onChange: value => set('base_url', value) })),
          h(Field, { label: t('relayPath'), hint: t('relayPathHint') },
            h(TextInput, { value: channel.path, onChange: value => set('path', value) })),
          h(Field, { label: t('modelId') },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h(TextInput, { value: channel.model, onChange: value => set('model', value) }),
              h(Btn, { small: true, disabled: props.fetchingModels, onClick: props.onFetchModels, title: t('modelListHint') },
                props.fetchingModels ? t('fetchingModels') : t('fetchModels')))),
          props.modelOptions && props.modelOptions.length
            ? h(Field, { label: t('modelList'), hint: `${props.modelOptions.length} ${t('modelListCount')}` },
              h(Select, {
                value: '',
                options: [{ value: '', label: t('modelList') }]
                  .concat(props.modelOptions.map(id => ({ value: id, label: id }))),
                onChange: value => { if (value) props.onPickModel(value) },
              }))
            : null,
          h(Field, { label: t('authStyle') },
            h(Select, { value: channel.auth, options: authOptions(relay.auth_styles), onChange: value => set('auth', value) })),
          h(Field, { label: t('modelsPath'), hint: t('modelsPathHint') },
            h(TextInput, { value: channel.models_path || '', placeholder: '/models', onChange: value => set('models_path', value) })),
          h(Field, { label: props.timeoutLabel },
            h(TextInput, { value: String(channel.timeout_ms), onChange: value => set('timeout_ms', Number(value) || 0) })),
          h(Field, { label: t('channelKey'), hint: hasKey ? t('keySaved') : '' },
            h(TextInput, { type: 'password', value: props.keyValue, placeholder: hasKey ? '••••••••' : 'sk-…', onChange: props.onKey })),
          props.extraFields || null),
        h(Field, { label: t('headersJson'), hint: props.headersError ? t('headersInvalid') : t('headersHint'), style: { marginTop: 12 } },
          h(TextArea, { rows: 2, value: props.headersText, onChange: props.onHeaders })),
        h('div', { style: Object.assign({}, ui.row, { marginTop: 10 }) },
          h(Btn, { disabled: props.busy || !hasKey, onClick: props.onTest },
            props.busy ? t('working') : props.testLabel),
          hasKey ? null : h('span', { style: { fontSize: 11.5, color: C.dim } }, t('testNeedsKey'))))
    }

    function SettingsView(props) {
      const [settings, setSettings] = useState(null)
      const [relay, setRelay] = useState({ vision_providers: [], image_providers: [], auth_styles: [] })
      const [keys, setKeys] = useState({ has_key: false, vision: { has_key: false }, image: { has_key: false } })
      const [draftKey, setDraftKey] = useState({ vision: '', image: '' })
      const [headersText, setHeadersText] = useState({ vision: '{}', image: '{}' })
      const [headersError, setHeadersError] = useState('')
      const [busy, setBusy] = useState('')
      const [models, setModels] = useState({ vision: [], image: [] })
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [tab, setTab] = useState('vision')
      const baseline = useRef('')
      const previousTab = useRef(0)

      const load = useCallback(async () => {
        try {
          const data = await api('/settings')
          setSettings(data.settings)
          setRelay(data.relay || {})
          setKeys({ has_key: data.has_key, vision: data.vision || { has_key: false }, image: data.image || { has_key: false } })
          setHeadersText({
            vision: JSON.stringify((data.settings.vision && data.settings.vision.headers) || {}, null, 0),
            image: JSON.stringify((data.settings.image && data.settings.image.headers) || {}, null, 0),
          })
          baseline.current = JSON.stringify(data.settings)
          props.onSettings && props.onSettings(data)
          setError('')
        } catch (failure) {
          setError(failure.message)
        }
      }, [props.onSettings])

      useEffect(() => {
        load()
      }, [load])

      const tabIndex = Math.max(0, SETTINGS_TABS.indexOf(tab))
      useEffect(() => {
        previousTab.current = tabIndex
      }, [tabIndex])
      const slide = `rep-slide-${tabIndex >= previousTab.current ? 'right' : 'left'} 260ms cubic-bezier(.22,.61,.36,1) both`

      if (!settings) {
        return h('div', { style: ui.row }, error ? h(Notice, { tone: 'bad' }, error) : h(Spinner), error ? null : h('span', null, t('loading')))
      }

      const patchShared = (field, value) => setSettings(current => Object.assign({}, current, { [field]: value }))
      const patchChannel = name => next => setSettings(current => Object.assign({}, current, { [name]: next }))
      const dirty = baseline.current !== '' && JSON.stringify(settings) !== baseline.current

      /* 请求头用输入即校验：非法 JSON 时立刻在卡片里标红，而不是等到点保存才报错。 */
      const parseHeaders = () => {
        const parsed = {}
        for (const name of ['vision', 'image']) {
          const raw = String(headersText[name] || '').trim()
          if (!raw) {
            parsed[name] = {}
            continue
          }
          let value
          try {
            value = JSON.parse(raw)
          } catch {
            throw new Error(`${name === 'vision' ? t('visionCard') : t('imageCard')}: ${t('headersInvalid')}`)
          }
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${name === 'vision' ? t('visionCard') : t('imageCard')}: ${t('headersInvalid')}`)
          }
          parsed[name] = value
        }
        return parsed
      }
      const updateHeaders = name => value => {
        setHeadersText(current => Object.assign({}, current, { [name]: value }))
        try {
          const raw = String(value || '').trim()
          const parsedValue = raw ? JSON.parse(raw) : {}
          if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) throw new Error('object expected')
          setHeadersError('')
        } catch {
          setHeadersError(name)
        }
      }

      const save = async () => {
        if (busy) return
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const headers = parseHeaders()
          const payload = Object.assign({}, settings, {
            vision: Object.assign({}, settings.vision, { headers: headers.vision }),
            image: Object.assign({}, settings.image, { headers: headers.image }),
          })
          const body = { settings: payload }
          if (draftKey.vision) body.vision_api_key = draftKey.vision
          if (draftKey.image) body.image_api_key = draftKey.image
          const data = await api('/settings', { method: 'PUT', body })
          setSettings(data.settings)
          baseline.current = JSON.stringify(data.settings)
          setKeys({ has_key: data.has_key, vision: data.vision || { has_key: false }, image: data.image || { has_key: false } })
          setDraftKey({ vision: '', image: '' })
          setHeadersText({
            vision: JSON.stringify((data.settings.vision && data.settings.vision.headers) || {}, null, 0),
            image: JSON.stringify((data.settings.image && data.settings.image.headers) || {}, null, 0),
          })
          setHeadersError('')
          setNotice(t('saved'))
          props.onSettings && props.onSettings(data)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      /* 一键拉取模型：用「当前正在编辑、可能还没保存」的地址与 Key 去问中转站，
         拿到列表后由用户点选，避免手打模型名打错。 */
      const fetchModels = async kind => {
        if (busy) return
        setBusy(`models:${kind}`)
        setError('')
        setNotice('')
        try {
          const channel = kind === 'image' ? settings.image : settings.vision
          let headers = {}
          const rawHeaders = String(headersText[kind] || '').trim()
          if (rawHeaders) {
            try {
              headers = JSON.parse(rawHeaders)
            } catch {
              throw new Error(`${kind === 'image' ? t('imageCard') : t('visionCard')}: ${t('headersInvalid')}`)
            }
          }
          if (!headers || typeof headers !== 'object' || Array.isArray(headers)) headers = {}
          const data = await api('/settings/models', {
            method: 'POST',
            body: {
              kind,
              channel: {
                provider: channel.provider,
                base_url: channel.base_url,
                path: channel.path,
                auth: channel.auth,
                headers,
                models_path: channel.models_path || '',
              },
            },
          })
          const list = Array.isArray(data.models) ? data.models : []
          setModels(current => Object.assign({}, current, { [kind]: list }))
          if (list.length === 0) setError(`${kind === 'image' ? t('imageCard') : t('visionCard')}: ${t('modelListEmpty')}`)
          else setNotice(`${kind === 'image' ? t('imageCard') : t('visionCard')} · ${list.length} ${t('modelListCount')} · ${data.ms || 0}ms`)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      const test = async kind => {
        if (!window.confirm(t('testCost'))) return
        setBusy(kind)
        setError('')
        setNotice('')
        try {
          const data = await api('/settings/test', { method: 'POST', body: { kind, confirm_cost: true } })
          setNotice(`${t('testOk')} · ${kind === 'image' ? t('imageCard') : t('visionCard')} · ${data.model || ''} ${data.ms ? `${data.ms}ms` : ''}`)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      const visionCard = h(ChannelCard, {
        title: t('visionCard'),
        hint: t('visionCardHint'),
        channel: settings.vision,
        providers: relay.vision_providers,
        relay,
        onChange: patchChannel('vision'),
        keyValue: draftKey.vision,
        keyState: keys.vision,
        onKey: value => setDraftKey(current => Object.assign({}, current, { vision: value })),
        headersText: headersText.vision,
        headersError: headersError === 'vision',
        onHeaders: updateHeaders('vision'),
        timeoutLabel: t('timeout'),
        testLabel: t('testVision'),
        busy: busy === 'vision',
        fetchingModels: busy === 'models:vision',
        modelOptions: models.vision,
        onFetchModels: () => fetchModels('vision'),
        onPickModel: id => patchChannel('vision')(Object.assign({}, settings.vision, { model: id })),
        onTest: () => test('vision'),
      })

      const imageCard = h(ChannelCard, {
        title: t('imageCard'),
        hint: t('imageCardHint'),
        channel: settings.image,
        providers: relay.image_providers,
        relay,
        onChange: patchChannel('image'),
        keyValue: draftKey.image,
        keyState: keys.image,
        onKey: value => setDraftKey(current => Object.assign({}, current, { image: value })),
        headersText: headersText.image,
        headersError: headersError === 'image',
        onHeaders: updateHeaders('image'),
        timeoutLabel: t('imageTimeout'),
        testLabel: t('testImage'),
        busy: busy === 'image',
        fetchingModels: busy === 'models:image',
        modelOptions: models.image,
        onFetchModels: () => fetchModels('image'),
        onPickModel: id => patchChannel('image')(Object.assign({}, settings.image, { model: id, edit_model: settings.image.edit_model || id })),
        onTest: () => test('image'),
        extraFields: [
          h(Field, { key: 'size', label: t('imageSize') },
            h(TextInput, { value: settings.image.size, placeholder: '1024x1024', onChange: value => patchChannel('image')(Object.assign({}, settings.image, { size: value })) })),
          h(Field, { key: 'edit-model', label: t('editModel') },
            h(TextInput, { value: settings.image.edit_model, onChange: value => patchChannel('image')(Object.assign({}, settings.image, { edit_model: value })) })),
          h(Field, { key: 'edit-path', label: t('editPath') },
            h(TextInput, { value: settings.image.edit_path, onChange: value => patchChannel('image')(Object.assign({}, settings.image, { edit_path: value })) })),
          h(Field, { key: 'quality', label: t('qualityHint') },
            h(TextInput, { value: settings.image.quality, placeholder: 'high / medium / low', onChange: value => patchChannel('image')(Object.assign({}, settings.image, { quality: value })) })),
        ],
      })

      const sharedCard = h('div', { style: ui.card },
        h('h3', { style: ui.h3 }, t('sharedCard')),
        h('p', { style: Object.assign({}, ui.p, { marginTop: 4 }) }, t('sharedHint')),
        h('div', { style: { marginTop: 12 } },
          h(Check, { checked: settings.allow_localhost === true, onChange: value => patchShared('allow_localhost', value) }, t('allowLocalhost'))),
        h('p', { style: Object.assign({}, ui.p, { marginTop: 12, fontSize: 11.5, lineHeight: 1.9 }) }, t('enumsHint')))

      const panels = { vision: visionCard, image: imageCard, shared: sharedCard }
      const tabLabels = { vision: t('visionShort'), image: t('imageShort'), shared: t('sharedCard') }

      const tabStrip = h('div', {
        style: {
          position: 'relative', display: 'flex', padding: 3, borderRadius: 11,
          border: `1px solid ${C.border}`, background: C.layer1, marginTop: 10,
        },
      },
      h('div', {
        style: {
          position: 'absolute', top: 3, bottom: 3, left: 3,
          width: `calc((100% - 6px) / ${SETTINGS_TABS.length})`,
          borderRadius: 8, background: C.layer2, border: `1px solid ${C.border2}`,
          transform: `translateX(${tabIndex * 100}%)`,
          transition: 'transform 260ms cubic-bezier(.22,.61,.36,1)',
          pointerEvents: 'none',
        },
      }),
      SETTINGS_TABS.map((id, index) => h('button', {
        key: id,
        type: 'button',
        onClick: () => setTab(id),
        style: {
          flex: '1 1 0', position: 'relative', zIndex: 1, padding: '7px 10px', borderRadius: 8,
          border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 12.5, fontWeight: index === tabIndex ? 600 : 500,
          color: index === tabIndex ? C.text : C.dim,
          transition: 'color 180ms ease',
        },
      }, tabLabels[id])))

      const actionBar = h('div', {
        style: {
          position: 'sticky', bottom: 0, zIndex: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
          padding: '10px 12px', marginTop: 2, borderRadius: 12,
          border: `1px solid ${C.border}`, background: C.layer1,
          boxShadow: '0 -10px 24px -12px rgba(0,0,0,0.35)',
        },
      },
      h('div', { style: Object.assign({}, ui.row, { gap: 6 }) },
        h(Badge, { tone: keys.vision && keys.vision.has_key ? 'ok' : 'warn' },
          `${t('visionShort')} · ${keys.vision && keys.vision.has_key ? t('keySaved') : t('noKey')}`),
        h(Badge, { tone: keys.image && keys.image.has_key ? 'ok' : 'warn' },
          `${t('imageShort')} · ${keys.image && keys.image.has_key ? t('keySaved') : t('noKey')}`),
        dirty ? h(Badge, { tone: 'warn' }, t('unsaved')) : null),
      h('div', { style: ui.row },
        dirty ? h(Btn, { small: true, variant: 'ghost', disabled: busy !== '', onClick: () => { load() } }, t('discard')) : null,
        h(Btn, { variant: 'primary', disabled: busy !== '', onClick: save }, busy === 'save' ? t('saving') : t('saveSettings'))))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 880, overflowX: 'hidden' } },
        h('div', null,
          h('h2', { style: ui.h2 }, t('setTitle')),
          h('p', { style: ui.p }, t('setIntro'))),
        tabStrip,
        error ? h(Notice, { tone: 'bad' }, error) : null,
        notice ? h(Notice, { tone: 'ok' }, notice) : null,
        h('div', { key: tab, style: { animation: slide } }, panels[tab]),
        actionBar)
    }
