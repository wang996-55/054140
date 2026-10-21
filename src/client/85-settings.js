
    // ------------------------------------------------------------ settings
    /* 视觉与生图两条独立通道：各填各的中转站、路径、模型、鉴权与 Key。
       下拉选项由 Host 下发的 relay 枚举驱动，第三方中转站新协议不必改页面。 */
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
      return h('div', { style: ui.card },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('h3', { style: ui.h3 }, props.title),
          h(Badge, { tone: props.keyState && props.keyState.has_key ? 'ok' : 'dim' },
            props.keyState && props.keyState.has_key
              ? (props.keyState.source === 'env' ? t('keyEnv') : t('keySaved'))
              : '未配置 Key')),
        h('p', { style: Object.assign({}, ui.p, { marginTop: 4 }) }, props.hint),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 10 } },
          h(Field, { label: t('provider') },
            h(Select, { value: channel.provider, options: providerOptions(props.providers), onChange: value => set('provider', value) })),
          h(Field, { label: t('relayUrl'), hint: t('relayUrlHint') },
            h(TextInput, { value: channel.base_url, placeholder: 'https://relay.example.com/v1', onChange: value => set('base_url', value) })),
          h(Field, { label: t('relayPath'), hint: t('relayPathHint') },
            h(TextInput, { value: channel.path, onChange: value => set('path', value) })),
          h(Field, { label: t('modelId') },
            h(TextInput, { value: channel.model, onChange: value => set('model', value) })),
          h(Field, { label: t('authStyle') },
            h(Select, { value: channel.auth, options: authOptions(relay.auth_styles), onChange: value => set('auth', value) })),
          h(Field, { label: props.timeoutLabel },
            h(TextInput, { value: String(channel.timeout_ms), onChange: value => set('timeout_ms', Number(value) || 0) })),
          h(Field, { label: t('channelKey'), hint: props.keyState && props.keyState.has_key ? t('keySaved') : '' },
            h(TextInput, { type: 'password', value: props.keyValue, placeholder: props.keyState && props.keyState.has_key ? '••••••••' : 'sk-…', onChange: props.onKey })),
          props.extraFields || null),
        h(Field, { label: t('headersJson'), hint: t('headersInvalid') },
          h(TextArea, { rows: 2, value: props.headersText, onChange: props.onHeaders })),
        h('div', { style: Object.assign({}, ui.row, { marginTop: 10 }) },
          h(Btn, { disabled: props.busy || !(props.keyState && props.keyState.has_key), onClick: props.onTest },
            props.busy ? t('working') : props.testLabel)))
    }

    function SettingsView(props) {
      const [settings, setSettings] = useState(null)
      const [relay, setRelay] = useState({ vision_providers: [], image_providers: [], auth_styles: [] })
      const [keys, setKeys] = useState({ has_key: false, vision: { has_key: false }, image: { has_key: false } })
      const [draftKey, setDraftKey] = useState({ vision: '', image: '' })
      const [headersText, setHeadersText] = useState({ vision: '{}', image: '{}' })
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

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
          props.onSettings && props.onSettings(data)
          setError('')
        } catch (failure) {
          setError(failure.message)
        }
      }, [props.onSettings])

      useEffect(() => {
        load()
      }, [load])

      if (!settings) {
        return h('div', { style: ui.row }, error ? h(Notice, { tone: 'bad' }, error) : h(Spinner), error ? null : h('span', null, t('loading')))
      }

      const patchShared = (field, value) => setSettings(current => Object.assign({}, current, { [field]: value }))
      const patchChannel = name => next => setSettings(current => Object.assign({}, current, { [name]: next }))

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

      const save = async () => {
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
          setKeys({ has_key: data.has_key, vision: data.vision || { has_key: false }, image: data.image || { has_key: false } })
          setDraftKey({ vision: '', image: '' })
          setNotice(t('saved'))
          props.onSettings && props.onSettings(data)
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
        onHeaders: value => setHeadersText(current => Object.assign({}, current, { vision: value })),
        timeoutLabel: t('timeout'),
        testLabel: t('testVision'),
        busy: busy === 'vision',
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
        onHeaders: value => setHeadersText(current => Object.assign({}, current, { image: value })),
        timeoutLabel: t('imageTimeout'),
        testLabel: t('testImage'),
        busy: busy === 'image',
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

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1000 } },
        h('div', null,
          h('h2', { style: ui.h2 }, t('setTitle')),
          h('p', { style: ui.p }, t('setIntro'))),
        error ? h(Notice, { tone: 'bad' }, error) : null,
        notice ? h(Notice, { tone: 'ok' }, notice) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, alignItems: 'start' } },
          visionCard,
          imageCard),
        h('div', { style: ui.cardTight },
          h('strong', { style: { fontSize: 13 } }, t('sharedCard')),
          h('span', { style: { fontSize: 11.5, color: C.dim, marginLeft: 8 } }, t('sharedHint')),
          h('div', { style: { marginTop: 10 } },
            h(Check, { checked: settings.allow_localhost === true, onChange: value => patchShared('allow_localhost', value) }, t('allowLocalhost')))),
        h('div', { style: ui.row },
          h(Btn, { variant: 'primary', disabled: busy !== '', onClick: save }, busy === 'save' ? t('saving') : t('saveSettings'))),
        h('p', { style: Object.assign({}, ui.p, { fontSize: 11.5 }) }, t('enumsHint')))
    }
