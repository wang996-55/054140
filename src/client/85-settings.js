
    // ------------------------------------------------------------ settings
    const PROTOCOL_OPTIONS = [
      { value: 'openai_chat', label: 'OpenAI Chat (/chat/completions)' },
      { value: 'openai_images', label: 'OpenAI Images (/images/generations)' },
      { value: 'openai_edits', label: 'OpenAI Edits (/images/edits)' },
    ]

    function SettingsView(props) {
      const [settings, setSettings] = useState(null)
      const [keyState, setKeyState] = useState({ has_key: false, key_source: '' })
      const [apiKey, setApiKey] = useState('')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('/settings')
          setSettings(data.settings)
          setKeyState({ has_key: data.has_key, key_source: data.source })
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

      const patch = (path, value) => {
        setSettings(current => {
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

      const save = async () => {
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const data = await api('/settings', { method: 'PUT', body: { settings, api_key: apiKey } })
          setSettings(data.settings)
          setKeyState({ has_key: data.has_key, key_source: data.source })
          setApiKey('')
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
          setNotice(`${t('testOk')} · ${data.model || ''} ${data.ms ? `${data.ms}ms` : ''}`)
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900 } },
        h('div', null,
          h('h2', { style: ui.h2 }, t('setTitle')),
          h('p', { style: ui.p }, t('setIntro'))),
        error ? h(Notice, { tone: 'bad' }, error) : null,
        notice ? h(Notice, { tone: 'ok' }, notice) : null,
        h('div', { style: ui.card },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 } },
            h(Field, { label: t('baseUrl') },
              h(TextInput, { value: settings.base_url, placeholder: 'https://relay.example.com/v1', onChange: value => patch('base_url', value) })),
            h(Field, { label: t('apiKey'), hint: keyState.has_key ? (keyState.key_source === 'env' ? t('apiKeyEnv') : t('apiKeySaved')) : '' },
              h(TextInput, { type: 'password', value: apiKey, placeholder: keyState.has_key ? '••••••••' : 'sk-…', onChange: setApiKey })),
            h(Field, { label: t('visionModel') },
              h(TextInput, { value: settings.models.vision, onChange: value => patch('models.vision', value) })),
            h(Field, { label: t('imageModel') },
              h(TextInput, { value: settings.models.image, onChange: value => patch('models.image', value) })),
            h(Field, { label: t('visionProtocol') },
              h(Select, { value: settings.protocols.vision, options: PROTOCOL_OPTIONS, onChange: value => patch('protocols.vision', value) })),
            h(Field, { label: t('imageProtocol') },
              h(Select, { value: settings.protocols.image, options: PROTOCOL_OPTIONS, onChange: value => patch('protocols.image', value) })),
            h(Field, { label: t('chatPath') },
              h(TextInput, { value: settings.paths.chat, onChange: value => patch('paths.chat', value) })),
            h(Field, { label: t('imagesPath') },
              h(TextInput, { value: settings.paths.images, onChange: value => patch('paths.images', value) })),
            h(Field, { label: t('editsPath') },
              h(TextInput, { value: settings.paths.edits, onChange: value => patch('paths.edits', value) })),
            h(Field, { label: t('timeout') },
              h(TextInput, { value: String(settings.timeout_ms), onChange: value => patch('timeout_ms', Number(value) || 0) })),
            h(Field, { label: t('imageTimeout') },
              h(TextInput, { value: String(settings.image_timeout_ms), onChange: value => patch('image_timeout_ms', Number(value) || 0) })),
            h(Field, { label: t('imageSize') },
              h(TextInput, { value: settings.image_size || '', placeholder: '1024x1024', onChange: value => patch('image_size', value) }))),
          h('div', { style: { marginTop: 8 } },
            h(Check, { checked: settings.allow_localhost === true, onChange: value => patch('allow_localhost', value) }, t('allowLocalhost'))),
          h('div', { style: Object.assign({}, ui.row, { marginTop: 14 }) },
            h(Btn, { variant: 'primary', disabled: busy !== '', onClick: save }, busy === 'save' ? t('saving') : t('saveSettings')),
            h(Btn, { disabled: busy !== '' || !keyState.has_key, onClick: () => test('vision') }, busy === 'vision' ? t('working') : t('testVision')),
            h(Btn, { disabled: busy !== '' || !keyState.has_key, onClick: () => test('image') }, busy === 'image' ? t('working') : t('testImage')))),
        h('p', { style: Object.assign({}, ui.p, { fontSize: 11.5 }) }, t('enumsHint')))
    }
