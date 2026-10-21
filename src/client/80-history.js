
    // ------------------------------------------------------------- history
    function HistoryView(props) {
      const [items, setItems] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('/tasks?limit=60')
          setItems(data.items || [])
          setError('')
        } catch (failure) {
          setError(failure.message)
          setItems([])
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const remove = async id => {
        if (!window.confirm(t('deleteConfirm'))) return
        setBusy(id)
        try {
          await api(`/tasks/${id}?confirm=1`, { method: 'DELETE' })
          await load()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy('')
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
          h('h2', { style: ui.h2 }, t('histTitle')),
          h(Btn, { small: true, onClick: load }, t('refresh'))),
        error ? h(Notice, { tone: 'bad' }, error) : null,
        items === null
          ? h('div', { style: Object.assign({}, ui.row) }, h(Spinner), h('span', null, t('loading')))
          : items.length === 0
            ? h('div', { style: ui.card }, h('p', { style: ui.p }, t('histEmpty')))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              items.map(item => h('div', { key: item.id, style: Object.assign({}, ui.cardTight, { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }) },
                h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 } },
                  item.thumb
                    ? h('img', { src: item.thumb, alt: '', style: { width: 54, height: 54, borderRadius: 8, objectFit: 'cover', border: `1px solid ${C.border}` } })
                    : null,
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: { fontSize: 13, fontWeight: 600 } }, `${item.form ? item.form.reference_type : 'task'} · ${item.form ? item.form.aspect : ''}`),
                    h('div', { style: { fontSize: 11.5, color: C.dim, display: 'flex', gap: 8, flexWrap: 'wrap' } },
                      h('span', null, item.id),
                      h('span', null, formatTime(item.updated_at || item.created_at)),
                      item.rating ? h('span', null, `${t('ratingLabel')} ${item.rating}/5`) : null))),
                h('div', { style: ui.row },
                  h(Badge, { tone: item.state === 'done' ? 'ok' : item.state === 'failed' ? 'bad' : 'dim' }, t(`st_${item.state}`) || item.state),
                  h(Btn, { small: true, onClick: () => props.onOpen(item.id) }, t('open')),
                  h(Btn, { small: true, variant: 'danger', disabled: busy === item.id, onClick: () => remove(item.id) }, t('deleteTask')))))))
    }
