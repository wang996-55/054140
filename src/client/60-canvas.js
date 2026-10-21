
    // ------------------------------------------------------------- canvas
    const TEXT_TEMPLATES = {
      title_sub: {
        zh: { title: '新品上架', sub: '限时 8 折' },
        en: { title: 'New arrival', sub: 'Limited offer' },
      },
      hero_center: {
        zh: { title: '爆款推荐' },
        en: { title: 'Bestseller' },
      },
      corner_tag: {
        zh: { title: 'NEW' },
        en: { title: 'NEW' },
      },
    }

    function productGeometry(comp, image) {
      const width = comp.canvas.width
      const height = comp.canvas.height
      const ratio = clamp(num(comp.product.width_ratio, 0.42), 0.02, 1)
      const pw = ratio * width
      const sourceWidth = (image && image.naturalWidth) || 1
      const sourceHeight = (image && image.naturalHeight) || 1
      const ph = (pw * sourceHeight) / sourceWidth
      return {
        cx: num(comp.product.cx, 0.5) * width,
        cy: num(comp.product.cy, 0.6) * height,
        pw,
        ph,
        rotation: (num(comp.product.rotation_deg, 0) * Math.PI) / 180,
        short: Math.min(width, height),
      }
    }

    function drawTextLayers(ctx, layers, width, height, placement) {
      const S = Math.min(width, height)
      const family = name => (name === 'serif'
        ? '"Songti SC", "SimSun", Georgia, serif'
        : '"PingFang SC", "Microsoft YaHei", -apple-system, system-ui, sans-serif')
      for (const layer of layers) {
        if (layer.visible === false) continue
        if ((layer.placement || 'behind') !== placement) continue
        const fontPx = num(layer.font_size, 0.062) * S
        const lineHeight = fontPx * num(layer.line_height, 1.25)
        const box = num(layer.width, 0.6) * width
        const x = num(layer.x, 0.08) * width
        const y = num(layer.y, 0.08) * height
        const align = layer.align === 'center' || layer.align === 'right' ? layer.align : 'left'
        ctx.save()
        ctx.font = `${layer.weight === 'bold' ? '700' : '500'} ${fontPx}px ${family(layer.font_family)}`
        ctx.fillStyle = layer.color || '#111111'
        ctx.textBaseline = 'top'
        ctx.textAlign = align
        if (layer.shadow === true) {
          ctx.shadowColor = 'rgba(0,0,0,0.28)'
          ctx.shadowBlur = fontPx * 0.25
          ctx.shadowOffsetY = fontPx * 0.06
        }
        const anchorX = align === 'center' ? x + box / 2 : align === 'right' ? x + box : x
        const lines = []
        for (const paragraph of String(layer.text || '').split('\n')) {
          let current = ''
          for (const char of paragraph) {
            const candidate = current + char
            if (ctx.measureText(candidate).width > box && current) {
              lines.push(current)
              current = char
            } else {
              current = candidate
            }
          }
          lines.push(current)
        }
        lines.forEach((line, index) => {
          ctx.fillText(line, anchorX, y + index * lineHeight)
        })
        ctx.restore()
      }
    }

    function drawWorkbench(ctx, comp, images) {
      const width = comp.canvas.width
      const height = comp.canvas.height
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      if (images.background) {
        const scale = Math.max(width / images.background.naturalWidth, height / images.background.naturalHeight)
        const dw = images.background.naturalWidth * scale
        const dh = images.background.naturalHeight * scale
        ctx.drawImage(images.background, (width - dw) / 2, (height - dh) / 2, dw, dh)
      }
      drawTextLayers(ctx, comp.text_layers || [], width, height, 'behind')
      const geo = productGeometry(comp, images.product)
      if (images.product && comp.product.visible !== false) {
        const shadow = comp.shadow || {}
        ctx.save()
        ctx.translate(geo.cx, geo.cy)
        ctx.rotate(geo.rotation)
        if (shadow.enabled !== false) {
          const blur = (num(shadow.blur, 4) * geo.short) / 100
          const opacity = clamp(num(shadow.opacity, 0.35), 0, 1)
          ctx.save()
          ctx.globalAlpha = opacity
          if (blur > 0.4) ctx.filter = `blur(${blur}px) brightness(0)`
          else ctx.filter = 'brightness(0)'
          ctx.drawImage(images.product, -geo.pw / 2 + (num(shadow.offset_x, 0) * geo.short) / 100, -geo.ph / 2 + (num(shadow.offset_y, 1.5) * geo.short) / 100, geo.pw, geo.ph)
          ctx.restore()
          if (shadow.contact !== false) {
            ctx.save()
            ctx.globalAlpha = Math.min(1, opacity * 1.6)
            ctx.filter = `blur(${Math.max(1, blur * 0.25)}px) brightness(0)`
            ctx.drawImage(images.product, -geo.pw / 2 + (num(shadow.offset_x, 0) * geo.short * 0.0035), -geo.ph / 2 + (num(shadow.offset_y, 1.5) * geo.short * 0.0035), geo.pw, geo.ph)
            ctx.restore()
          }
        }
        const adjustments = comp.adjustments || {}
        ctx.globalAlpha = clamp(num(comp.product.opacity, 1), 0, 1)
        if (adjustments.enabled === true) {
          const brightness = 1 + clamp(num(adjustments.brightness, 0), -1, 1) * 0.5
          const warmth = clamp(num(adjustments.warmth, 0), -1, 1)
          const filters = [`brightness(${brightness})`]
          if (warmth > 0) filters.push(`sepia(${(warmth * 0.4).toFixed(3)})`, `saturate(${1 + warmth * 0.2})`)
          if (warmth < 0) filters.push(`hue-rotate(${(warmth * 12).toFixed(1)}deg)`, `saturate(${1 + warmth * 0.1})`)
          ctx.filter = filters.join(' ')
        }
        ctx.drawImage(images.product, -geo.pw / 2, -geo.ph / 2, geo.pw, geo.ph)
        ctx.restore()
      }
      drawTextLayers(ctx, comp.text_layers || [], width, height, 'front')
      return geo
    }

    function renderOverlay(comp, placement) {
      const layers = (comp.text_layers || []).filter(layer => layer.visible !== false && (layer.placement || 'behind') === placement)
      if (layers.length === 0) return null
      const canvas = document.createElement('canvas')
      canvas.width = comp.canvas.width
      canvas.height = comp.canvas.height
      const ctx = canvas.getContext('2d')
      drawTextLayers(ctx, layers, canvas.width, canvas.height, placement)
      return canvasToPngDataUrl(canvas)
    }

    function Workbench(props) {
      const { snapshot } = props
      const canvasRef = useRef(null)
      const boxRef = useRef(null)
      const imagesRef = useRef({ background: null, product: null })
      const dragRef = useRef(null)
      const [comp, setComp] = useState(() => JSON.parse(JSON.stringify(snapshot.composition || snapshot.composition_default)))
      const [history, setHistory] = useState([])
      const [future, setFuture] = useState([])
      const [selected, setSelected] = useState('product')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [tick, setTick] = useState(0)
      const [exported, setExported] = useState(null)
      const [imagesReady, setImagesReady] = useState(false)

      const backgroundEntry = () => {
        const list = snapshot.urls.backgrounds || []
        const id = comp.background.asset_id || snapshot.task.background_version_id
        return list.find(item => item.id === id) || list[list.length - 1] || null
      }

      useEffect(() => {
        let cancelled = false
        const run = async () => {
          const entry = backgroundEntry()
          const urls = {
            background: entry ? entry.normalized || entry.url : '',
            product: snapshot.urls.product_rgba || snapshot.urls.product,
          }
          try {
            const [background, product] = await Promise.all([
              urls.background ? loadImage(urls.background) : Promise.resolve(null),
              urls.product ? loadImage(urls.product) : Promise.resolve(null),
            ])
            if (cancelled) return
            imagesRef.current = { background, product }
            setImagesReady(true)
          } catch (failure) {
            if (!cancelled) setError(failure.message)
          }
        }
        run()
        return () => { cancelled = true }
      }, [snapshot.task.id, snapshot.task.background_version_id, snapshot.urls.product_rgba])

      const paint = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (canvas.width !== comp.canvas.width || canvas.height !== comp.canvas.height) {
          canvas.width = comp.canvas.width
          canvas.height = comp.canvas.height
        }
        const geo = drawWorkbench(ctx, comp, imagesRef.current)
        if (selected === 'product' && comp.product.visible !== false) {
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
          ctx.save()
          ctx.translate(geo.cx, geo.cy)
          ctx.rotate(geo.rotation)
          ctx.strokeStyle = 'rgba(0,122,255,0.9)'
          ctx.lineWidth = Math.max(1.5, geo.short * 0.004)
          ctx.strokeRect(-geo.pw / 2, -geo.ph / 2, geo.pw, geo.ph)
          const handle = geo.short * 0.022
          ctx.fillStyle = 'rgba(0,122,255,0.95)'
          for (const corner of corners) {
            ctx.beginPath()
            ctx.arc((corner[0] * geo.pw) / 2, (corner[1] * geo.ph) / 2, handle, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.beginPath()
          ctx.moveTo(0, -geo.ph / 2)
          ctx.lineTo(0, -geo.ph / 2 - geo.short * 0.07)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(0, -geo.ph / 2 - geo.short * 0.07, handle, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }, [comp, selected])

      useEffect(() => {
        paint()
      }, [paint, tick, imagesReady])

      const commit = useCallback(next => {
        setComp(current => {
          setHistory(items => items.concat([JSON.parse(JSON.stringify(current))]).slice(-40))
          setFuture([])
          return next
        })
      }, [])

      const patchProduct = (patch, record) => {
        const next = JSON.parse(JSON.stringify(comp))
        Object.assign(next.product, patch)
        if (record) commit(next)
        else setComp(next)
        setTick(value => value + 1)
      }

      const patchNested = (group, patch, record) => {
        const next = JSON.parse(JSON.stringify(comp))
        next[group] = Object.assign({}, next[group], patch)
        if (record) commit(next)
        else setComp(next)
        setTick(value => value + 1)
      }

      const localPoint = event => {
        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        return {
          x: ((event.clientX - rect.left) / rect.width) * comp.canvas.width,
          y: ((event.clientY - rect.top) / rect.height) * comp.canvas.height,
          rect,
        }
      }

      const hitTest = point => {
        const geo = productGeometry(comp, imagesRef.current.product)
        if (comp.product.visible === false) return null
        const dx = point.x - geo.cx
        const dy = point.y - geo.cy
        const cos = Math.cos(-geo.rotation)
        const sin = Math.sin(-geo.rotation)
        const lx = dx * cos - dy * sin
        const ly = dx * sin + dy * cos
        const handle = geo.short * 0.045
        if (Math.hypot(lx, ly + geo.ph / 2 + geo.short * 0.07) < handle) return { kind: 'rotate' }
        if (Math.abs(lx - geo.pw / 2) < handle && Math.abs(ly - geo.ph / 2) < handle) return { kind: 'scale' }
        if (Math.abs(lx) <= geo.pw / 2 && Math.abs(ly) <= geo.ph / 2) return { kind: 'move' }
        return null
      }

      const onPointerDown = event => {
        if (selected !== 'product') return
        const point = localPoint(event)
        const hit = hitTest(point)
        if (!hit) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const geo = productGeometry(comp, imagesRef.current.product)
        dragRef.current = {
          kind: hit.kind,
          start: point,
          origin: { cx: comp.product.cx, cy: comp.product.cy, ratio: comp.product.width_ratio, rotation: comp.product.rotation_deg },
          angle: Math.atan2(point.y - geo.cy, point.x - geo.cx),
          distance: Math.hypot(point.x - geo.cx, point.y - geo.cy),
        }
      }

      const onPointerMove = event => {
        const drag = dragRef.current
        if (!drag) return
        const point = localPoint(event)
        if (drag.kind === 'move') {
          patchProduct({
            cx: clamp(drag.origin.cx + (point.x - drag.start.x) / comp.canvas.width, -0.5, 1.5),
            cy: clamp(drag.origin.cy + (point.y - drag.start.y) / comp.canvas.height, -0.5, 1.5),
          }, false)
        } else if (drag.kind === 'scale') {
          const geo = productGeometry(comp, imagesRef.current.product)
          const distance = Math.hypot(point.x - geo.cx, point.y - geo.cy)
          const factor = Math.max(0.05, distance / Math.max(1, drag.distance))
          patchProduct({ width_ratio: clamp(drag.origin.ratio * factor, 0.04, 1) }, false)
        } else if (drag.kind === 'rotate') {
          const geo = productGeometry(comp, imagesRef.current.product)
          const angle = Math.atan2(point.y - geo.cy, point.x - geo.cx)
          let degrees = drag.origin.rotation + ((angle - drag.angle) * 180) / Math.PI
          degrees = Math.round(degrees)
          while (degrees > 180) degrees -= 360
          while (degrees < -180) degrees += 360
          patchProduct({ rotation_deg: degrees }, false)
        }
      }

      const onPointerUp = () => {
        if (!dragRef.current) return
        dragRef.current = null
        commit(JSON.parse(JSON.stringify(comp)))
      }

      const undo = () => {
        if (history.length === 0) return
        const previous = history[history.length - 1]
        setHistory(items => items.slice(0, -1))
        setFuture(items => [JSON.parse(JSON.stringify(comp))].concat(items).slice(0, 40))
        setComp(previous)
        setTick(value => value + 1)
      }

      const redo = () => {
        if (future.length === 0) return
        const next = future[0]
        setFuture(items => items.slice(1))
        setHistory(items => items.concat([JSON.parse(JSON.stringify(comp))]).slice(-40))
        setComp(next)
        setTick(value => value + 1)
      }

      const saveComposition = async () => {
        setBusy('save')
        setError('')
        try {
          const data = await api(`/tasks/${snapshot.task.id}/composition`, { method: 'PUT', body: { composition: comp } })
          props.onChanged(data)
          props.notify('ok', t('compSaved'))
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      const doExport = async () => {
        setBusy('export')
        setError('')
        try {
          const behind = renderOverlay(comp, 'behind')
          const front = renderOverlay(comp, 'front')
          const data = await api(`/tasks/${snapshot.task.id}/export`, {
            method: 'POST',
            body: {
              composition: comp,
              overlays: Object.assign({}, behind ? { behind } : {}, front ? { front } : {}),
            },
          })
          props.onChanged(data)
          const name = (data.export && data.export.file ? data.export.file.split('/').pop() : 'export.png')
          setExported({
            url: `${API}/file?task=${encodeURIComponent(snapshot.task.id)}&file=${encodeURIComponent(name)}`,
            width: data.export.width,
            height: data.export.height,
            bytes: data.export.bytes,
            file: name,
          })
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      const addText = template => {
        const copy = TEXT_TEMPLATES[template][LANG.current] || TEXT_TEMPLATES[template].zh
        const id = `t${Date.now().toString(36).slice(-4)}`
        const layers = (comp.text_layers || []).slice()
        const base = {
          id,
          text: template === 'title_sub' ? `${copy.title}\n${copy.sub}` : copy.title,
          font_family: 'sans',
          font_size: template === 'corner_tag' ? 0.042 : 0.07,
          line_height: 1.25,
          color: '#111111',
          align: template === 'hero_center' ? 'center' : 'left',
          x: template === 'hero_center' ? 0.2 : template === 'corner_tag' ? 0.06 : 0.08,
          y: template === 'corner_tag' ? 0.06 : 0.1,
          width: template === 'hero_center' ? 0.6 : 0.5,
          placement: template === 'corner_tag' ? 'front' : 'behind',
          visible: true,
          weight: template === 'hero_center' ? 'bold' : 'medium',
          shadow: false,
        }
        layers.push(base)
        const next = JSON.parse(JSON.stringify(comp))
        next.text_layers = layers
        commit(next)
        setSelected(id)
      }

      const patchLayer = (id, patch) => {
        const next = JSON.parse(JSON.stringify(comp))
        next.text_layers = (next.text_layers || []).map(layer => (layer.id === id ? Object.assign({}, layer, patch) : layer))
        commit(next)
      }

      const removeLayer = id => {
        const next = JSON.parse(JSON.stringify(comp))
        next.text_layers = (next.text_layers || []).filter(layer => layer.id !== id)
        commit(next)
        setSelected('product')
      }

      const activeLayer = (comp.text_layers || []).find(layer => layer.id === selected)
      const canvasStyle = {
        width: '100%',
        height: 'auto',
        display: 'block',
        borderRadius: 12,
        background: C.layer2,
        touchAction: 'none',
        cursor: selected === 'product' ? 'grab' : 'default',
      }

      return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 14, alignItems: 'start' } },
        h('div', { ref: boxRef, style: Object.assign({}, ui.card, { padding: 12 }) },
          h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between', marginBottom: 10 }) },
            h('div', null,
              h('h3', { style: ui.h3 }, t('wbTitle')),
              h('p', { style: { fontSize: 11.5, color: C.dim, margin: 0, lineHeight: 1.6 } }, t('wbIntro'))),
            h('div', { style: ui.row },
              h(Btn, { small: true, disabled: history.length === 0, onClick: undo }, t('undo')),
              h(Btn, { small: true, disabled: future.length === 0, onClick: redo }, t('redo')))),
          error ? h('div', { style: { marginBottom: 10 } }, h(Notice, { tone: 'bad' }, error)) : null,
          h('canvas', {
            ref: canvasRef,
            style: canvasStyle,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerLeave: onPointerUp,
          }),
          exported
            ? h('div', { style: Object.assign({}, ui.cardTight, { marginTop: 12 }) },
              h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
                h('div', null,
                  h('h3', { style: ui.h3 }, t('exportResult')),
                  h('p', { style: { fontSize: 12, color: C.dim, margin: 0 } }, t('exportOk', { w: exported.width, h: exported.height, kb: Math.round((exported.bytes || 0) / 1024) }))),
                h('div', { style: ui.row },
                  h(Btn, { variant: 'primary', small: true, onClick: () => downloadDataUrl(exported.url, exported.file) }, t('downloadPng')),
                  h(Btn, { small: true, onClick: () => api('/reveal', { method: 'POST', body: { task: snapshot.task.id } }).catch(() => {}) }, t('openDir')))),
              h('img', { src: exported.url, alt: 'export', style: { width: '100%', borderRadius: 10, marginTop: 10 } }))
            : null),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h('div', { style: ui.card },
            h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
              h('h3', { style: ui.h3 }, t('layers')),
              h(Btn, { small: true, variant: 'ghost', onClick: () => addText('title_sub') }, t('addText'))),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
              h('button', {
                type: 'button',
                onClick: () => setSelected('product'),
                style: Object.assign({}, ui.input, {
                  textAlign: 'left', cursor: 'pointer', padding: '7px 10px',
                  borderColor: selected === 'product' ? C.brand : C.border,
                }),
              }, `🖼 ${t('productLayer')}`),
              (comp.text_layers || []).map(layer => h('button', {
                key: layer.id,
                type: 'button',
                onClick: () => setSelected(layer.id),
                style: Object.assign({}, ui.input, {
                  textAlign: 'left', cursor: 'pointer', padding: '7px 10px',
                  borderColor: selected === layer.id ? C.brand : C.border,
                  opacity: layer.visible === false ? 0.5 : 1,
                }),
              }, `T ${String(layer.text || '').split('\n')[0].slice(0, 16)}`))),
            h('div', { style: Object.assign({}, ui.row, { marginTop: 10, gap: 6 }) },
              Object.keys(TEXT_TEMPLATES).map(template => h(Btn, { key: template, small: true, variant: 'ghost', onClick: () => addText(template) },
                template === 'title_sub' ? t('tplTitleSub') : template === 'hero_center' ? t('tplCenter') : t('tplCorner'))))),
          activeLayer
            ? h('div', { style: ui.card },
              h('h3', { style: ui.h3 }, t('textLayer')),
              h(Field, { label: t('textContent') },
                h(TextArea, { rows: 2, value: activeLayer.text, onChange: value => patchLayer(activeLayer.id, { text: value }) })),
              h(Field, { label: t('fontSize') }, h(Range, { min: 0.02, max: 0.2, step: 0.005, value: activeLayer.font_size, onChange: value => patchLayer(activeLayer.id, { font_size: value }) , display: `${Math.round(activeLayer.font_size * 100)}%` })),
              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
                h(Field, { label: t('textColor') },
                  h('input', {
                    type: 'color', value: activeLayer.color || '#111111',
                    onChange: event => patchLayer(activeLayer.id, { color: event.target.value }),
                    style: { width: '100%', height: 34, border: `1px solid ${C.border}`, borderRadius: 9, background: C.layer2 },
                  })),
                h(Field, { label: t('align') },
                  h(Select, {
                    value: activeLayer.align,
                    options: [{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }],
                    onChange: value => patchLayer(activeLayer.id, { align: value }),
                  })),
                h(Field, { label: t('placement') },
                  h(Select, {
                    value: activeLayer.placement,
                    options: [{ value: 'front', label: t('front') }, { value: 'behind', label: t('behind') }],
                    onChange: value => patchLayer(activeLayer.id, { placement: value }),
                  })),
                h(Field, { label: t('visible') },
                  h(Select, {
                    value: activeLayer.visible === false ? 'off' : 'on',
                    options: [{ value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }],
                    onChange: value => patchLayer(activeLayer.id, { visible: value === 'on' }),
                  }))),
              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
                h(Field, { label: 'X' }, h(Range, { min: -0.1, max: 0.9, step: 0.01, value: activeLayer.x, onChange: value => patchLayer(activeLayer.id, { x: value }), display: activeLayer.x.toFixed(2) })),
                h(Field, { label: 'Y' }, h(Range, { min: -0.1, max: 0.9, step: 0.01, value: activeLayer.y, onChange: value => patchLayer(activeLayer.id, { y: value }), display: activeLayer.y.toFixed(2) })),
                h(Field, { label: 'W' }, h(Range, { min: 0.2, max: 1, step: 0.02, value: activeLayer.width, onChange: value => patchLayer(activeLayer.id, { width: value }), display: activeLayer.width.toFixed(2) }))),
              h(Btn, { small: true, variant: 'danger', onClick: () => removeLayer(activeLayer.id) }, t('remove')))
            : null,
          h('div', { style: ui.card },
            h('h3', { style: ui.h3 }, t('productLayer')),
            h(Field, { label: t('scale') }, h(Range, { min: 0.04, max: 1, step: 0.01, value: comp.product.width_ratio, onChange: value => patchProduct({ width_ratio: value }, true), display: `${Math.round(comp.product.width_ratio * 100)}%` })),
            h(Field, { label: t('rotate') }, h(Range, { min: -45, max: 45, step: 1, value: comp.product.rotation_deg, onChange: value => patchProduct({ rotation_deg: value }, true), display: `${comp.product.rotation_deg}°` })),
            h(Field, { label: t('opacityLabel') }, h(Range, { min: 0.1, max: 1, step: 0.01, value: comp.product.opacity, onChange: value => patchProduct({ opacity: value }, true), display: `${Math.round(comp.product.opacity * 100)}%` }))),
          h('div', { style: ui.card },
            h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
              h('h3', { style: ui.h3 }, t('shadowTitle')),
              h(Check, { checked: comp.shadow.enabled !== false, onChange: value => patchNested('shadow', { enabled: value }, true) }, t('shadowOn'))),
            h(Field, { label: t('offsetY') }, h(Range, { min: -20, max: 20, step: 0.5, value: comp.shadow.offset_y, onChange: value => patchNested('shadow', { offset_y: value }, true), display: `${comp.shadow.offset_y}%` })),
            h(Field, { label: t('offsetX') }, h(Range, { min: -20, max: 20, step: 0.5, value: comp.shadow.offset_x, onChange: value => patchNested('shadow', { offset_x: value }, true), display: `${comp.shadow.offset_x}%` })),
            h(Field, { label: t('blurLabel') }, h(Range, { min: 0, max: 20, step: 0.5, value: comp.shadow.blur, onChange: value => patchNested('shadow', { blur: value }, true), display: `${comp.shadow.blur}%` })),
            h(Field, { label: t('opacityLabel') }, h(Range, { min: 0, max: 1, step: 0.01, value: comp.shadow.opacity, onChange: value => patchNested('shadow', { opacity: value }, true), display: `${Math.round(comp.shadow.opacity * 100)}%` })),
            h(Check, { checked: comp.shadow.contact !== false, onChange: value => patchNested('shadow', { contact: value }, true) }, t('contact'))),
          h('div', { style: ui.card },
            h('div', { style: Object.assign({}, ui.row, { justifyContent: 'space-between' }) },
              h('h3', { style: ui.h3 }, t('adjustTitle')),
              h(Check, { checked: comp.adjustments.enabled === true, onChange: value => patchNested('adjustments', { enabled: value }, true) }, t('adjustOn'))),
            h(Field, { label: t('brightness') }, h(Range, { min: -1, max: 1, step: 0.02, value: comp.adjustments.brightness, onChange: value => patchNested('adjustments', { brightness: value }, true), display: comp.adjustments.brightness.toFixed(2) })),
            h(Field, { label: t('warmth') }, h(Range, { min: -1, max: 1, step: 0.02, value: comp.adjustments.warmth, onChange: value => patchNested('adjustments', { warmth: value }, true), display: comp.adjustments.warmth.toFixed(2) }))),
          h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', flexDirection: 'column', gap: 8 }) },
            h('div', { style: ui.row },
              h(Btn, { disabled: busy !== '', onClick: saveComposition }, busy === 'save' ? t('saving') : t('saveComp')),
              h(Btn, { variant: 'primary', disabled: busy !== '', onClick: doExport }, busy === 'export' ? t('exporting') : t('exportBtn'))),
            h('p', { style: { fontSize: 11.5, color: C.dim, margin: 0, lineHeight: 1.6 } }, '导出由 Host 用同一套参数在 PNG 原生缓冲上完成，浏览器只负责文字图层。'))))
    }
