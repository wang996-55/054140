
    // ---------------------------------------------------------------- mask
    function maskStats(alpha) {
      let transparent = 0
      for (let index = 3; index < alpha.length; index += 4) {
        if (alpha[index] < 250) transparent += 1
      }
      return { ratio: transparent / (alpha.length / 4) }
    }

    /** Border flood fill on colour distance: the honest, dependency-free cutout
     *  available inside the plugin (rembg is not bundled). */
    function autoCutoutAlpha(rgba, width, height, tolerance) {
      const pixels = width * height
      const limit = (clamp(tolerance, 0, 100) / 100) * 441.7
      const reference = [0, 0, 0]
      let samples = 0
      const sampleAt = (x, y) => {
        const index = (y * width + x) * 4
        reference[0] += rgba[index]
        reference[1] += rgba[index + 1]
        reference[2] += rgba[index + 2]
        samples += 1
      }
      for (let x = 0; x < width; x += 1) {
        sampleAt(x, 0)
        sampleAt(x, height - 1)
      }
      for (let y = 0; y < height; y += 1) {
        sampleAt(0, y)
        sampleAt(width - 1, y)
      }
      for (let channel = 0; channel < 3; channel += 1) reference[channel] /= samples || 1

      const background = new Uint8Array(pixels)
      const stack = new Int32Array(pixels)
      let top = 0
      const visit = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        const index = y * width + x
        if (background[index]) return
        const offset = index * 4
        const dr = rgba[offset] - reference[0]
        const dg = rgba[offset + 1] - reference[1]
        const db = rgba[offset + 2] - reference[2]
        if (Math.sqrt(dr * dr + dg * dg + db * db) > limit) return
        background[index] = 1
        stack[top] = index
        top += 1
      }
      for (let x = 0; x < width; x += 1) {
        visit(x, 0)
        visit(x, height - 1)
      }
      for (let y = 0; y < height; y += 1) {
        visit(0, y)
        visit(width - 1, y)
      }
      while (top > 0) {
        top -= 1
        const index = stack[top]
        const x = index % width
        const y = (index - x) / width
        visit(x + 1, y)
        visit(x - 1, y)
        visit(x, y + 1)
        visit(x, y - 1)
      }
      const alpha = new Uint8ClampedArray(pixels)
      for (let index = 0; index < pixels; index += 1) {
        alpha[index] = background[index] ? 0 : rgba[index * 4 + 3]
      }
      return alpha
    }

    function slideMax(values, width, height, radius, useMax) {
      const horizontal = new Uint8ClampedArray(values.length)
      const out = new Uint8ClampedArray(values.length)
      const deque = new Int32Array(Math.max(width, height))
      for (let y = 0; y < height; y += 1) {
        let head = 0
        let tail = 0
        for (let x = 0; x < width + radius; x += 1) {
          if (x < width) {
            const value = values[y * width + x]
            while (tail > head && (useMax ? values[y * width + deque[tail - 1]] <= value : values[y * width + deque[tail - 1]] >= value)) tail -= 1
            deque[tail] = x
            tail += 1
          }
          const left = x - radius
          if (left >= 0) {
            while (tail > head && deque[head] < left) head += 1
            horizontal[y * width + left] = values[y * width + deque[head]]
          }
        }
      }
      for (let x = 0; x < width; x += 1) {
        let head = 0
        let tail = 0
        for (let y = 0; y < height + radius; y += 1) {
          if (y < height) {
            const value = horizontal[y * width + x]
            while (tail > head && (useMax ? horizontal[deque[tail - 1] * width + x] <= value : horizontal[deque[tail - 1] * width + x] >= value)) tail -= 1
            deque[tail] = y
            tail += 1
          }
          const top = y - radius
          if (top >= 0) {
            while (tail > head && deque[head] < top) head += 1
            out[top * width + x] = horizontal[deque[head] * width + x]
          }
        }
      }
      return out
    }

    function featherAlpha(values, width, height, radius) {
      if (radius < 1) return values.slice()
      const horizontal = new Float32Array(values.length)
      const out = new Uint8ClampedArray(values.length)
      const window = 2 * radius + 1
      for (let y = 0; y < height; y += 1) {
        let sum = 0
        for (let x = -radius; x <= radius; x += 1) sum += values[y * width + clamp(x, 0, width - 1)]
        for (let x = 0; x < width; x += 1) {
          horizontal[y * width + x] = sum / window
          sum += values[y * width + clamp(x + radius + 1, 0, width - 1)] - values[y * width + clamp(x - radius, 0, width - 1)]
        }
      }
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x]
        for (let y = 0; y < height; y += 1) {
          out[y * width + x] = sum / window
          sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x] - horizontal[clamp(y - radius, 0, height - 1) * width + x]
        }
      }
      return out
    }

    function MaskEditor(props) {
      const canvasRef = useRef(null)
      const stateRef = useRef({ rgba: null, width: 0, height: 0, alpha: null, image: null })
      const [tick, setTick] = useState(0)
      const [tolerance, setTolerance] = useState(32)
      const [brush, setBrush] = useState(28)
      const [mode, setMode] = useState('erase')
      const [zoom, setZoom] = useState(1)
      const [status, setStatus] = useState('')
      const [ready, setReady] = useState(false)
      const [baseWidth, setBaseWidth] = useState(360)
      const [isTransparent, setIsTransparent] = useState(false)
      const painting = useRef(false)
      const lastPoint = useRef(null)

      const applyMask = useCallback(nextAlpha => {
        stateRef.current.alpha = nextAlpha
        setTick(value => value + 1)
      }, [])

      const paint = useCallback((x, y) => {
        const state = stateRef.current
        if (!state.alpha) return
        const radius = Math.max(1, Math.round((brush * state.width) / (baseWidth * zoom)))
        const cx = Math.round(x)
        const cy = Math.round(y)
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (dx * dx + dy * dy > radius * radius) continue
            const px = cx + dx
            const py = cy + dy
            if (px < 0 || py < 0 || px >= state.width || py >= state.height) continue
            state.alpha[py * state.width + px] = mode === 'erase' ? 0 : 255
          }
        }
        setTick(value => value + 1)
      }, [brush, baseWidth, zoom, mode])

      const redraw = useCallback(() => {
        const canvas = canvasRef.current
        const state = stateRef.current
        if (!canvas || !state.image || !state.alpha) return
        const ratio = Math.min(2, window.devicePixelRatio || 1)
        const displayWidth = Math.round(baseWidth * zoom)
        const displayHeight = Math.round((displayWidth * state.height) / state.width)
        canvas.width = Math.round(displayWidth * ratio)
        canvas.height = Math.round(displayHeight * ratio)
        canvas.style.width = `${displayWidth}px`
        canvas.style.height = `${displayHeight}px`
        const ctx = canvas.getContext('2d')
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.clearRect(0, 0, displayWidth, displayHeight)
        ctx.drawImage(state.image, 0, 0, displayWidth, displayHeight)
        const overlay = document.createElement('canvas')
        overlay.width = state.width
        overlay.height = state.height
        const octx = overlay.getContext('2d')
        const imageData = octx.createImageData(state.width, state.height)
        for (let index = 0; index < state.alpha.length; index += 1) {
          const kept = state.alpha[index]
          imageData.data[index * 4] = 255
          imageData.data[index * 4 + 1] = 40
          imageData.data[index * 4 + 2] = 90
          imageData.data[index * 4 + 3] = kept > 8 ? 0 : 150
        }
        octx.putImageData(imageData, 0, 0)
        ctx.drawImage(overlay, 0, 0, displayWidth, displayHeight)
      }, [baseWidth, zoom])

      useEffect(() => {
        redraw()
      }, [tick, redraw])

      useEffect(() => {
        let cancelled = false
        const run = async () => {
          setStatus(t('working'))
          try {
            const image = await loadImage(props.src)
            if (cancelled) return
            const scale = Math.min(1, PRODUCT_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
            const width = Math.max(2, Math.round(image.naturalWidth * scale))
            const height = Math.max(2, Math.round(image.naturalHeight * scale))
            const buffer = document.createElement('canvas')
            buffer.width = width
            buffer.height = height
            const bctx = buffer.getContext('2d')
            bctx.drawImage(image, 0, 0, width, height)
            const data = bctx.getImageData(0, 0, width, height)
            const stats = maskStats(data.data)
            stateRef.current = { rgba: data.data, width, height, image: buffer, alpha: null }
            setBaseWidth(Math.min(420, Math.max(240, Math.round(420))))
            if (stats.ratio > 0.02) {
              const alpha = new Uint8ClampedArray(width * height)
              for (let index = 0; index < alpha.length; index += 1) alpha[index] = data.data[index * 4 + 3]
              stateRef.current.alpha = alpha
              setIsTransparent(true)
            } else {
              stateRef.current.alpha = autoCutoutAlpha(data.data, width, height, tolerance)
              setIsTransparent(false)
            }
            setReady(true)
            setStatus('')
            setTick(value => value + 1)
          } catch (failure) {
            if (!cancelled) setStatus(failure.message)
          }
        }
        run()
        return () => { cancelled = true }
      }, [props.src])

      const regroup = (kind) => {
        const state = stateRef.current
        if (!state.alpha) return
        const radius = kind === 'feather' ? 3 : 2
        const alpha = kind === 'feather'
          ? featherAlpha(state.alpha, state.width, state.height, radius)
          : slideMax(state.alpha, state.width, state.height, radius, kind === 'grow')
        applyMask(kind === 'feather' ? new Uint8ClampedArray(alpha) : alpha)
        props.onMaskChange && props.onMaskChange(state.alpha)
      }

      const runAuto = () => {
        const state = stateRef.current
        if (!state.rgba) return
        state.alpha = autoCutoutAlpha(state.rgba, state.width, state.height, tolerance)
        setIsTransparent(false)
        setTick(value => value + 1)
        props.onMaskChange && props.onMaskChange(state.alpha)
      }

      const pointer = event => {
        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        const state = stateRef.current
        return {
          x: ((event.clientX - rect.left) / rect.width) * state.width,
          y: ((event.clientY - rect.top) / rect.height) * state.height,
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: ui.row },
          h(Btn, { small: true, onClick: runAuto }, t('autoCutout')),
          h(Btn, { small: true, onClick: () => regroup('grow') }, t('grow')),
          h(Btn, { small: true, onClick: () => regroup('shrink') }, t('shrink')),
          h(Btn, { small: true, onClick: () => regroup('feather') }, t('feather')),
          isTransparent ? h(Badge, { tone: 'ok' }, t('transparentDirect')) : null,
          status ? h('span', { style: { fontSize: 12, color: C.dim } }, status) : null),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
          h(Field, { label: t('tolerance') }, h(Range, { min: 5, max: 90, value: tolerance, onChange: setTolerance })),
          h(Field, { label: t('brushSize') }, h(Range, { min: 6, max: 90, value: brush, onChange: setBrush })),
          h(Field, { label: t('brush') },
            h(Select, {
              value: mode,
              options: [{ value: 'erase', label: t('eraseMode') }, { value: 'add', label: t('addMode') }],
              onChange: setMode,
            })),
          h(Field, { label: t('zoom') }, h(Range, { min: 1, max: 2.5, step: 0.1, value: zoom, onChange: setZoom, display: `${zoom.toFixed(1)}×` }))),
        h('div', { style: { display: 'flex', justifyContent: 'center', background: C.layer2, borderRadius: 12, padding: 10 } },
          h('canvas', {
            ref: canvasRef,
            onPointerDown: event => {
              if (!ready) return
              event.currentTarget.setPointerCapture(event.pointerId)
              painting.current = true
              const point = pointer(event)
              lastPoint.current = point
              paint(point.x, point.y)
            },
            onPointerMove: event => {
              if (!painting.current) return
              const point = pointer(event)
              if (lastPoint.current) {
                const steps = Math.ceil(Math.hypot(point.x - lastPoint.current.x, point.y - lastPoint.current.y) / 2)
                for (let step = 1; step <= steps; step += 1) {
                  paint(
                    lastPoint.current.x + ((point.x - lastPoint.current.x) * step) / Math.max(1, steps),
                    lastPoint.current.y + ((point.y - lastPoint.current.y) * step) / Math.max(1, steps),
                  )
                }
              }
              lastPoint.current = point
            },
            onPointerUp: () => {
              painting.current = false
              lastPoint.current = null
              if (stateRef.current.alpha) props.onMaskChange && props.onMaskChange(stateRef.current.alpha)
            },
            style: { maxWidth: '100%', cursor: 'crosshair', borderRadius: 10, touchAction: 'none', background: '#ffffff' },
          })))
    }

    function MaskStage(props) {
      const { snapshot } = props
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [draft, setDraft] = useState(null)
      const [mode, setMode] = useState('auto')

      const save = async () => {
        const state = draft
        if (!state || !state.alpha) {
          setError(t('cutoutFailed'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const width = state.width
          const height = state.height
          const productCanvas = document.createElement('canvas')
          productCanvas.width = width
          productCanvas.height = height
          const pctx = productCanvas.getContext('2d')
          const productImage = pctx.createImageData(width, height)
          for (let index = 0; index < width * height; index += 1) {
            productImage.data[index * 4] = state.rgba[index * 4]
            productImage.data[index * 4 + 1] = state.rgba[index * 4 + 1]
            productImage.data[index * 4 + 2] = state.rgba[index * 4 + 2]
            productImage.data[index * 4 + 3] = state.alpha[index]
          }
          pctx.putImageData(productImage, 0, 0)
          const maskCanvas = document.createElement('canvas')
          maskCanvas.width = width
          maskCanvas.height = height
          const mctx = maskCanvas.getContext('2d')
          const maskImage = mctx.createImageData(width, height)
          for (let index = 0; index < width * height; index += 1) {
            maskImage.data[index * 4] = 255
            maskImage.data[index * 4 + 1] = 255
            maskImage.data[index * 4 + 2] = 255
            maskImage.data[index * 4 + 3] = state.alpha[index]
          }
          mctx.putImageData(maskImage, 0, 0)
          await api(`/tasks/${snapshot.task.id}/cutout`, {
            method: 'POST',
            body: {
              mode: mode === 'transparent' ? 'transparent' : 'auto',
              product_png: canvasToPngDataUrl(productCanvas),
              mask_png: canvasToPngDataUrl(maskCanvas),
            },
          })
          const data = await api(`/tasks/${snapshot.task.id}/mask`, { method: 'PUT', body: { confirm: true } })
          props.onChanged(data)
          props.notify('ok', t('maskSaved'))
        } catch (failure) {
          setError(`${t('errorPrefix')}${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: ui.card },
          h('h3', { style: ui.h3 }, t('maskTitle')),
          h('p', { style: ui.p }, t('maskIntro')),
          error ? h('div', { style: { marginTop: 10 } }, h(Notice, { tone: 'bad' }, error)) : null,
          h('div', { style: { marginTop: 12 } },
            h(MaskEditor, {
              src: snapshot.urls.product,
              onMaskChange: state => {
                setDraft(state)
                setMode('auto')
              },
            }))),
        h('div', { style: Object.assign({}, ui.cardTight, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }) },
          h('span', { style: { fontSize: 12, color: C.dim } }, t('maskGate')),
          h(Btn, { variant: 'primary', disabled: busy, onClick: save }, busy ? t('working') : t('confirmMask'))))
    }
