
    // ---------------------------------------------------------------- i18n
    const STRINGS = {
      zh: {
        appTitle: '爆款图复刻',
        appSubtitle: 'AI 分析与无商品背景 + 本地真实商品合成，全流程在插件内完成',
        navHome: '新建复刻',
        navTask: '当前任务',
        navHistory: '历史',
        navSettings: '设置',
        refresh: '刷新',
        close: '关闭',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        retry: '重试',
        back: '返回',
        loading: '加载中…',
        empty: '暂无内容',
        confirm: '确认',
        unknown: '无法判断',
        notConfigured: '尚未配置中转站',
        goSettings: '去设置',
        errorPrefix: '出错：',

        homeTitle: '新建复刻任务',
        homeIntro: '参考图只用来提取机位、光线、承载面与留白；商品永远来自你的真实图片，不会被模型重绘。',
        referenceTitle: '参考图（必填）',
        referenceHint: '想要复刻的爆款图，用于分析场景；不会被直接合成进成品。',
        productTitle: '真实商品图（保真模式必填）',
        productHint: '你的商品原图，背景尽量干净。若已是透明 PNG 会自动直接使用。',
        pickImage: '选择图片',
        replaceImage: '更换图片',
        removeImage: '移除',
        referenceType: '参考图类型',
        mode: '复刻模式',
        modeStyle: '参考风格（只借风格与场景）',
        modeFidelity: '高度复刻（尽量还原机位与构图）',
        fidelity: '复刻程度',
        creativeMode: '创意模式（无商品图，商品一致性不保证）',
        creativeHint: '默认关闭；开启后不保证商品与实物一致，成品仅作创意参考。',
        productView: '商品图视角',
        productKind: '商品是否与参考图同品类',
        kindApparel: '同品类（服饰类）',
        kindOther: '不同品类/非服饰',
        requirement: '统一要求（会原样写进提示词）',
        requirementHint: '例如：不要出现人物；整体偏冷调；右上角留白给标题。',
        lang: '提示词语言',
        aspect: '输出比例',
        outputSize: '输出边长',
        backgroundCount: '背景生成次数上限',
        submit: '创建任务并开始',
        submitting: '创建中…',
        needReference: '请先选择参考图',
        needProduct: '保真复刻需要商品图；如需无商品图请开启创意模式',
        tipsTitle: '开工前检查',
        tip1: '商品图分辨率越高越好，合成时不会重绘 Logo 与包装。',
        tip2: '一次任务默认只允许 1 次视觉 + 1 次生图调用，避免误烧费用。',

        step1: '参数校验',
        step2: '场景理解',
        step3: '场景审核',
        step4: '抠图与蒙版',
        step5: '视角检查',
        step6: '背景准备',
        step7: 'Canvas 合成',
        step8: '导出与验收',
        st_created: '待开始',
        st_analyzing: '正在分析',
        st_scene_review: '场景审核',
        st_mask_review: '蒙版审核',
        st_background_review: '背景审核',
        st_editing: '画布编辑',
        st_exporting: '正在导出',
        st_done: '已完成',
        st_failed: '失败',
        st_cancelled: '已取消',
        st_remote_outcome_unknown: '远程结果未知',
        st_mask_rejected: '蒙版被驳回',

        analyze: '开始视觉分析',
        analyzing: '正在调用视觉模型…',
        reanalyze: '重新分析',
        costVision: '将消耗 1 次视觉请求',
        costImage: '将消耗 1 次生图请求',
        budget: '调用预算',
        budgetLine: '视觉 {v}/{vm} · 生图 {i}/{im}',
        sceneTitle: '场景审核（强制门禁）',
        sceneIntro: '模型只给语义判断；下面的每一项都要你确认。仍为“无法判断”的项必须勾选确认才能继续。',
        sceneRaw: '查看模型原始返回',
        saveReview: '保存审核并继续',
        mustConfirm: '还有无法判断的项未确认',
        confirmKeep: '确认保持“无法判断”',
        confidenceNote: 'confidence 只是模型自述的把握，不代表准确率。',
        description: '场景描述',
        palette: '配色',
        styleTags: '风格词',
        texts: '参考图文字',
        risks: '风险提示',

        maskTitle: '抠图与蒙版（强制门禁）',
        maskIntro: '系统先在本地估算蒙版；透明 PNG 直接使用。你可以用画笔修边，确认后才进入下一步。',
        autoCutout: '本地自动抠图',
        transparentDirect: '检测到透明背景，直接使用原透明通道',
        tolerance: '颜色容差',
        brush: '画笔',
        brushSize: '画笔大小',
        addMode: '补回',
        eraseMode: '擦除',
        grow: '扩张',
        shrink: '收缩',
        feather: '羽化',
        resetMask: '重置',
        zoom: '缩放',
        confirmMask: '确认蒙版并继续',
        maskGate: '未确认蒙版不能进入背景步骤',
        working: '处理中…',
        cutoutFailed: '抠图失败，请更换商品图或手动修边',

        bgTitle: '背景准备与审核（强制门禁）',
        promptTitle: '背景提示词（由审核后的场景编译）',
        promptHint: '提示词固定包含机位、光源、承载面、预留区域与禁止项；用户文案原样保留。',
        generate: '生成无商品背景',
        generating: '正在生成背景…',
        uploadBg: '上传干净背景',
        versions: '背景版本',
        selectBg: '选择这张',
        selectedBg: '已选',
        checklist1: '画面里没有多余商品或疑似商品',
        checklist2: '预留区域干净、无遮挡',
        checklist3: '台面与光线的方向可接受',
        confirmBg: '确认背景并进入画布',
        forceNew: '强制重新生成',
        noBg: '还没有背景版本',
        bgGate: '三项检查全部勾选后才能进入画布',

        wbTitle: 'Canvas 工作台',
        wbIntro: '拖动移动商品，拖动角点缩放，拖动顶部圆点旋转。预览与导出共用同一套几何参数。',
        layers: '图层',
        productLayer: '商品',
        textLayer: '文字',
        addText: '添加文字层',
        template: '版式',
        tplTitleSub: '左标题 + 副标',
        tplCenter: '居中大标题',
        tplCorner: '角落标签',
        textContent: '文字内容',
        fontSize: '字号',
        textColor: '颜色',
        align: '对齐',
        placement: '层级',
        front: '商品上层',
        behind: '商品下层',
        visible: '显示',
        remove: '删除',
        shadowTitle: '阴影',
        shadowOn: '启用阴影',
        offsetY: '垂直偏移',
        offsetX: '水平偏移',
        blurLabel: '模糊',
        opacityLabel: '不透明度',
        contact: '接触阴影',
        adjustTitle: '明度/色温（默认关闭）',
        adjustOn: '启用调整',
        brightness: '明度',
        warmth: '色温',
        rotate: '旋转',
        scale: '缩放',
        undo: '撤销',
        redo: '重做',
        saveComp: '保存参数',
        compSaved: '画布参数已保存',
        exportBtn: '导出成品',
        exporting: '正在本地合成导出…',
        exportResult: '导出结果',
        downloadPng: '下载 PNG',
        openDir: '打开输出目录',
        exportOk: '导出完成：{w}×{h}，{kb} KB',

        acceptTitle: '验收与保存',
        acceptIntro: '请按 1-5 分评估商业可用性；评分与备注会存进历史，用于后续复盘。',
        rating: '评分',
        notes: '备注',
        accept: '完成验收',
        accepted: '已验收',
        cancelTask: '取消任务',
        timeoutTitle: '远程结果未知',
        timeoutBody: '上一次请求超时，可能已经产生费用。系统没有自动重发。请先确认中转站后台，再决定是否重新分析。',

        maskSaved: '蒙版已确认',
        bgSelected: '背景已确认',
        sceneSaved: '场景已保存',

        histTitle: '历史任务',
        histEmpty: '还没有任务记录',
        open: '打开',
        deleteTask: '删除',
        deleteConfirm: '确认删除这个任务及其本地文件？',
        ratingLabel: '评分',

        setTitle: '中转站与接口设置',
        setIntro: '只有 Host 进程持有 API Key；图片与提示词都不经过浏览器直连中转站。',
        baseUrl: '中转站地址',
        apiKey: 'API Key',
        apiKeySaved: '已保存（留空表示不修改）',
        apiKeyEnv: '当前使用环境变量 REPLICA_API_KEY',
        visionModel: '视觉模型',
        imageModel: '生图模型',
        visionProtocol: '视觉接口模式',
        imageProtocol: '生图接口模式',
        chatPath: 'Chat 路径',
        imagesPath: '生图路径',
        editsPath: '图生图路径',
        timeout: '视觉超时（毫秒）',
        imageTimeout: '生图超时（毫秒）',
        imageSize: '生图尺寸',
        allowLocalhost: '允许本机中转站（127.0.0.1）',
        saveSettings: '保存设置',
        testVision: '测试视觉接口',
        testImage: '测试生图接口',
        testCost: '测试会真实消耗一次请求，是否继续？',
        testOk: '测试成功',
        enumsHint: '所有枚举取值与中文名称由 Host 下发，页面与契约永远一致。',
      },
      en: {
        appTitle: 'Replica Studio',
        appSubtitle: 'AI scene analysis and clean backdrops, composited with your real product - all inside the plugin',
        navHome: 'New',
        navTask: 'Task',
        navHistory: 'History',
        navSettings: 'Settings',
        refresh: 'Refresh',
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        retry: 'Retry',
        back: 'Back',
        loading: 'Loading…',
        empty: 'Nothing here',
        confirm: 'Confirm',
        unknown: 'unknown',
        notConfigured: 'Relay not configured',
        goSettings: 'Open settings',
        errorPrefix: 'Error: ',

        homeTitle: 'New replication task',
        homeIntro: 'The reference is used for camera, light, surface and empty space only; your real product is never redrawn by a model.',
        referenceTitle: 'Reference image (required)',
        referenceHint: 'The viral image to replicate. It is analysed, never composited directly.',
        productTitle: 'Product photo (required for fidelity mode)',
        productHint: 'Your real product, ideally on a clean background. Transparent PNG is used as-is.',
        pickImage: 'Choose image',
        replaceImage: 'Replace',
        removeImage: 'Remove',
        referenceType: 'Reference type',
        mode: 'Mode',
        modeStyle: 'Style reference',
        modeFidelity: 'High fidelity',
        fidelity: 'Fidelity',
        creativeMode: 'Creative mode (no product; consistency not guaranteed)',
        creativeHint: 'Off by default. When on, the product may not match the real item.',
        productView: 'Product view',
        productKind: 'Same category as the reference?',
        kindApparel: 'Same (apparel)',
        kindOther: 'Different / not apparel',
        requirement: 'Extra requirements (passed verbatim)',
        requirementHint: 'e.g. no people; cool tone; keep the top right empty for a headline.',
        lang: 'Prompt language',
        aspect: 'Aspect',
        outputSize: 'Output edge',
        backgroundCount: 'Background attempt limit',
        submit: 'Create task',
        submitting: 'Creating…',
        needReference: 'Choose a reference image first',
        needProduct: 'Fidelity mode needs a product photo; enable creative mode for none',
        tipsTitle: 'Before you start',
        tip1: 'Higher resolution product photos are better; logos and packaging are never redrawn.',
        tip2: 'One task allows 1 vision + 1 image call by default, so nothing burns money silently.',

        step1: 'Validate',
        step2: 'Scene',
        step3: 'Review',
        step4: 'Mask',
        step5: 'View check',
        step6: 'Background',
        step7: 'Compose',
        step8: 'Export',
        st_created: 'created',
        st_analyzing: 'analysing',
        st_scene_review: 'scene review',
        st_mask_review: 'mask review',
        st_background_review: 'background review',
        st_editing: 'editing',
        st_exporting: 'exporting',
        st_done: 'done',
        st_failed: 'failed',
        st_cancelled: 'cancelled',
        st_remote_outcome_unknown: 'remote outcome unknown',
        st_mask_rejected: 'mask rejected',

        analyze: 'Run vision analysis',
        analyzing: 'Calling the vision model…',
        reanalyze: 'Re-analyse',
        costVision: 'Uses 1 vision request',
        costImage: 'Uses 1 image request',
        budget: 'Call budget',
        budgetLine: 'vision {v}/{vm} · image {i}/{im}',
        sceneTitle: 'Scene review (mandatory gate)',
        sceneIntro: 'The model only suggests; you confirm every field. Anything still unknown must be explicitly confirmed.',
        sceneRaw: 'Raw model answer',
        saveReview: 'Save review and continue',
        mustConfirm: 'Some unknown fields are still unconfirmed',
        confirmKeep: 'Keep as unknown',
        confidenceNote: 'confidence is the model self-report, not accuracy.',
        description: 'Description',
        palette: 'Palette',
        styleTags: 'Style tags',
        texts: 'Texts in reference',
        risks: 'Risks',

        maskTitle: 'Cutout and mask (mandatory gate)',
        maskIntro: 'A local estimate is offered first; transparent PNGs are used directly. Fix the edges, then confirm.',
        autoCutout: 'Local auto cutout',
        transparentDirect: 'Transparent background detected - using the original alpha',
        tolerance: 'Colour tolerance',
        brush: 'Brush',
        brushSize: 'Brush size',
        addMode: 'Add',
        eraseMode: 'Erase',
        grow: 'Grow',
        shrink: 'Shrink',
        feather: 'Feather',
        resetMask: 'Reset',
        zoom: 'Zoom',
        confirmMask: 'Confirm mask and continue',
        maskGate: 'The mask must be confirmed before the background step',
        working: 'Working…',
        cutoutFailed: 'Cutout failed; try another photo or paint the mask manually',

        bgTitle: 'Background review (mandatory gate)',
        promptTitle: 'Background prompt (compiled from the reviewed scene)',
        promptHint: 'The prompt always includes camera, light, surface, reserved space and prohibitions.',
        generate: 'Generate clean background',
        generating: 'Generating background…',
        uploadBg: 'Upload a clean background',
        versions: 'Versions',
        selectBg: 'Select this',
        selectedBg: 'Selected',
        checklist1: 'No extra product or product-like objects',
        checklist2: 'Reserved area is clean and unobstructed',
        checklist3: 'Surface and light direction are acceptable',
        confirmBg: 'Confirm and open the canvas',
        forceNew: 'Force a new background',
        noBg: 'No background yet',
        bgGate: 'Tick all three checks to continue',

        wbTitle: 'Canvas workbench',
        wbIntro: 'Drag to move, drag the corner to scale, drag the top dot to rotate. Preview and export share the same geometry.',
        layers: 'Layers',
        productLayer: 'Product',
        textLayer: 'Text',
        addText: 'Add text layer',
        template: 'Template',
        tplTitleSub: 'Left title + sub',
        tplCenter: 'Centred hero',
        tplCorner: 'Corner tag',
        textContent: 'Text',
        fontSize: 'Size',
        textColor: 'Colour',
        align: 'Align',
        placement: 'Layer',
        front: 'Above product',
        behind: 'Below product',
        visible: 'Visible',
        remove: 'Delete',
        shadowTitle: 'Shadow',
        shadowOn: 'Shadow on',
        offsetY: 'Offset Y',
        offsetX: 'Offset X',
        blurLabel: 'Blur',
        opacityLabel: 'Opacity',
        contact: 'Contact shadow',
        adjustTitle: 'Brightness / warmth (off by default)',
        adjustOn: 'Enable adjustments',
        brightness: 'Brightness',
        warmth: 'Warmth',
        rotate: 'Rotate',
        scale: 'Scale',
        undo: 'Undo',
        redo: 'Redo',
        saveComp: 'Save parameters',
        compSaved: 'Composition saved',
        exportBtn: 'Export final image',
        exporting: 'Compositing locally…',
        exportResult: 'Exported file',
        downloadPng: 'Download PNG',
        openDir: 'Open folder',
        exportOk: 'Exported {w}×{h}, {kb} KB',

        acceptTitle: 'Accept and save',
        acceptIntro: 'Score 1-5 for commercial usability; the score and notes are stored in history.',
        rating: 'Rating',
        notes: 'Notes',
        accept: 'Finish',
        accepted: 'Accepted',
        cancelTask: 'Cancel task',
        timeoutTitle: 'Remote outcome unknown',
        timeoutBody: 'The last call timed out and may have been billed. Nothing was retried automatically. Check the relay before re-running.',

        maskSaved: 'Mask confirmed',
        bgSelected: 'Background confirmed',
        sceneSaved: 'Scene saved',

        histTitle: 'Task history',
        histEmpty: 'No tasks yet',
        open: 'Open',
        deleteTask: 'Delete',
        deleteConfirm: 'Delete this task and its local files?',
        ratingLabel: 'Rating',

        setTitle: 'Relay and provider',
        setIntro: 'Only the Host holds the API key; images and prompts never go straight from the browser.',
        baseUrl: 'Base URL',
        apiKey: 'API key',
        apiKeySaved: 'Saved (leave empty to keep it)',
        apiKeyEnv: 'Using the REPLICA_API_KEY environment variable',
        visionModel: 'Vision model',
        imageModel: 'Image model',
        visionProtocol: 'Vision protocol',
        imageProtocol: 'Image protocol',
        chatPath: 'Chat path',
        imagesPath: 'Image path',
        editsPath: 'Edit path',
        timeout: 'Vision timeout (ms)',
        imageTimeout: 'Image timeout (ms)',
        imageSize: 'Image size',
        allowLocalhost: 'Allow a local relay (127.0.0.1)',
        saveSettings: 'Save settings',
        testVision: 'Test vision',
        testImage: 'Test image',
        testCost: 'The test really uses one request. Continue?',
        testOk: 'Test passed',
        enumsHint: 'Every enum and Chinese label comes from the Host, so the page always matches the contract.',
      },
    }

    const LANG = { current: 'zh' }

    function t(key, vars) {
      const table = STRINGS[LANG.current] || STRINGS.zh
      let text = table[key] !== undefined ? table[key] : STRINGS.zh[key] !== undefined ? STRINGS.zh[key] : key
      if (vars && typeof vars === 'object') {
        for (const name of Object.keys(vars)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]))
        }
      }
      return text
    }

    function useLang(ctx) {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        if (!ctx || !ctx.locale || typeof ctx.locale.subscribe !== 'function') {
          LANG.current = 'zh'
          return undefined
        }
        const read = () => {
          try {
            const snapshot = ctx.locale.getLocale()
            const id = String((snapshot && (snapshot.id || snapshot.locale)) || '')
            LANG.current = id.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh'
          } catch {
            LANG.current = 'zh'
          }
        }
        read()
        setTick(value => value + 1)
        return ctx.locale.subscribe(() => {
          read()
          setTick(value => value + 1)
        })
      }, [ctx])
      return { lang: LANG.current, tick }
    }

    // ----------------------------------------------------------------- api
    async function api(path, options) {
      const init = Object.assign({ method: 'GET', headers: { 'content-type': 'application/json' } }, options || {})
      if (init.body !== undefined && typeof init.body !== 'string') init.body = JSON.stringify(init.body)
      let response
      try {
        response = await fetch(`${API}${path}`, init)
      } catch (error) {
        const failure = new Error('无法连接本地 Host 进程，请确认插件仍在运行')
        failure.code = 'network'
        throw failure
      }
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { ok: false, code: 'bad-response', error: text.slice(0, 300) }
      }
      if (!response.ok || data.ok === false) {
        const failure = new Error(data.error || `HTTP ${response.status}`)
        failure.code = data.code || 'http-error'
        failure.status = response.status
        failure.detail = data.detail
        throw failure
      }
      return data
    }

    // ---------------------------------------------------------------- utils
    const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
    const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

    function readStore(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // quota or privacy mode: losing a draft must not break the page
      }
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('图片无法解码'))
        image.src = src
      })
    }

    function canvasToPngDataUrl(canvas) {
      return canvas.toDataURL('image/png')
    }

    function downloadDataUrl(dataUrl, filename) {
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
    }

    function formatBytes(bytes) {
      const size = Number(bytes) || 0
      if (size < 1024) return `${size} B`
      if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / 1048576).toFixed(2)} MB`
    }

    function formatTime(value) {
      try {
        return new Date(value).toLocaleString()
      } catch {
        return String(value || '')
      }
    }

    function aspectSize(aspect, edge) {
      const base = Math.round(clamp(edge, 512, 2048))
      if (aspect === '4:5') return { width: base, height: Math.round((base * 5) / 4) }
      if (aspect === '3:4') return { width: base, height: Math.round((base * 4) / 3) }
      if (aspect === '16:9') return { width: Math.round((base * 16) / 9), height: base }
      return { width: base, height: base }
    }

    // -------------------------------------------------------------- UI kit
    const C = {
      bg: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
    }

    const ui = {
      card: {
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        background: C.layer1,
        padding: 16,
      },
      cardTight: {
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.layer1,
        padding: 12,
      },
      label: { fontSize: 12, color: C.dim, marginBottom: 6, display: 'block' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        fontSize: 13,
        borderRadius: 9,
        border: `1px solid ${C.border}`,
        background: C.layer2,
        color: C.text,
        outline: 'none',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      h2: { fontSize: 15, fontWeight: 700, margin: '0 0 6px' },
      h3: { fontSize: 13, fontWeight: 700, margin: '0 0 4px' },
      p: { fontSize: 12.5, color: C.dim, lineHeight: 1.7, margin: 0 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    }

    function Btn(props) {
      const variant = props.variant || 'default'
      const disabled = props.disabled === true
      const base = {
        padding: props.small ? '5px 10px' : '8px 14px',
        fontSize: props.small ? 12 : 13,
        borderRadius: 9,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        border: `1px solid ${C.border}`,
        background: C.layer2,
        color: C.text,
        fontWeight: variant === 'primary' ? 600 : 500,
        transition: 'background 120ms ease, border-color 120ms ease',
      }
      if (variant === 'primary') Object.assign(base, { background: C.brand, color: '#ffffff', border: `1px solid ${C.brand}` })
      if (variant === 'danger') Object.assign(base, { color: C.bad, border: `1px solid ${C.bad}` })
      if (variant === 'ghost') Object.assign(base, { background: 'transparent', border: '1px solid transparent', color: C.dim })
      return h('button', {
        type: 'button',
        disabled,
        title: props.title || '',
        onClick: disabled ? undefined : props.onClick,
        style: Object.assign(base, props.style || {}),
      }, props.children)
    }

    function Field(props) {
      return h('div', { style: Object.assign({ marginBottom: props.inline ? 0 : 12 }, props.style || {}) },
        h('label', { style: ui.label }, props.label),
        props.children,
        props.hint ? h('div', { style: { fontSize: 11.5, color: C.dim, marginTop: 5, lineHeight: 1.6 } }, props.hint) : null)
    }

    function TextInput(props) {
      return h('input', {
        type: props.type || 'text',
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        disabled: props.disabled,
        onChange: event => props.onChange && props.onChange(event.target.value),
        style: Object.assign({}, ui.input, props.style || {}),
      })
    }

    function TextArea(props) {
      return h('textarea', {
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        rows: props.rows || 3,
        onChange: event => props.onChange && props.onChange(event.target.value),
        style: Object.assign({}, ui.input, { resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }, props.style || {}),
      })
    }

    function Select(props) {
      return h('select', {
        value: props.value,
        disabled: props.disabled,
        onChange: event => props.onChange && props.onChange(event.target.value),
        style: Object.assign({}, ui.input, { height: 34, padding: '4px 8px' }, props.style || {}),
      }, (props.options || []).map(option => h('option', { key: option.value, value: option.value }, option.label)))
    }

    function Range(props) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('input', {
          type: 'range',
          min: props.min, max: props.max, step: props.step || 1,
          value: props.value,
          disabled: props.disabled,
          onChange: event => props.onChange && props.onChange(Number(event.target.value)),
          style: { flex: 1, accentColor: C.brand },
        }),
        h('output', { style: { fontSize: 12, color: C.dim, minWidth: 46, textAlign: 'right' } }, props.display != null ? props.display : String(props.value)))
    }

    function Check(props) {
      return h('label', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: C.text, cursor: 'pointer', lineHeight: 1.6 } },
        h('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled,
          onChange: event => props.onChange && props.onChange(event.target.checked),
          style: { marginTop: 2, accentColor: C.brand },
        }),
        h('span', null, props.children))
    }

    function Badge(props) {
      const tone = props.tone || 'dim'
      const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : C.dim
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 999, fontSize: 11.5,
          color, border: `1px solid ${color}`,
          background: 'transparent', whiteSpace: 'nowrap',
        },
      }, props.children)
    }

    function Notice(props) {
      const tone = props.tone || 'info'
      const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : C.dim
      return h('div', {
        style: {
          padding: '9px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.65,
          border: `1px solid ${color}`, color: C.text, background: C.layer1,
        },
      }, props.children)
    }

    function Spinner() {
      return h('span', {
        style: {
          display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
          border: `2px solid ${C.border2}`, borderTopColor: C.brand,
          animation: 'rep-spin 0.8s linear infinite',
        },
      })
    }

    function Thumb(props) {
      return h('div', {
        style: {
          width: props.size || 120, height: props.size || 120, borderRadius: 10,
          border: `1px solid ${props.active ? C.brand : C.border}`,
          background: C.layer2, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: props.onClick ? 'pointer' : 'default',
        },
        onClick: props.onClick,
      }, props.src ? h('img', { src: props.src, alt: props.alt || '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : h('span', { style: { fontSize: 11.5, color: C.dim } }, props.placeholder || '—'))
    }
