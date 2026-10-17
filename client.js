/**
 * Client half of the Personal Workbench bundle.
 *
 * Registers a sidebar panel icon ("工作台") and the matching main-panel page.
 * The page has three tabs: overview dashboard, e-commerce model image studio,
 * and settings (API endpoint / key / output folder / accent color).
 *
 * The studio sends the model reference sheet (four-view turnaround) and an
 * optional product photo to the Host, which forwards them to an
 * OpenAI-compatible /images/edits endpoint. The API key never enters the browser.
 */
window.__ModuleLoader__.load({
  id: '@local/personal-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const API = '/api/personal-workbench'
    // How many generation jobs may run against the image API at the same time.
    // Further clicks stay in the queue and start as soon as a slot frees up.
    const MAX_CONCURRENT_JOBS = 3
    const LS_FORM = 'pbw.form.v1'
    const LS_PROMPTS = 'pbw.prompts.v1'
    const LS_POSES = 'pbw.poses.v1'
    const LS_ACCENT = 'pbw.accent.v1'
    const LS_FIDELITY = 'pbw.fidelity.v1'
    const LS_TEMPLATES = 'pbw.templates.v1'
    const LS_SIZETABLE = 'pbw.sizetable.v1'
    const LS_SIZEPOSTER = 'pbw.sizeposter.v1'

    // ---------------------------------------------------------------- locale
    const STR = {
      zh: {
        title: '我的工作台',
        subtitle: '专属首页 · 电商模特图工作间',
        tabHome: '概览',
        tabStudio: '生图',
        tabSize: '尺码表',
        tabSettings: '设置',
        sizeTitle: '尺码表计算与转换',
        sizeHint: '按档差自动计算各尺码，并支持厘米 / 英寸互相转换',
        sizeAddRow: '＋ 添加尺码',
        sizeRemoveRow: '删除',
        sizeGenerated: '已载入示例尺码数据',
        sizeNewLabel: '新尺码',
        sizeSizeHeader: '尺码',
        sizeUploadTitle: '尺码表图片',
        sizeUploadHint: '上传现有的尺码表截图，自动识别尺码与各部位数据；识别后可手动修正',
        sizeUploadNote: '支持 PNG / JPG / WebP，单张最大 8MB',
        sizeUploadPick: '上传尺码表图片',
        sizeUploadReplace: '更换图片',
        sizeExtract: '识别表格',
        sizeExtracting: '识别中…',
        sizeExtractNeed: '请先上传尺码表图片',
        sizeExtractDone: '已识别尺码，可手动修正',
        sizeDataTitle: '尺码数据',
        sizeDataHint: '数值可直接修改；建议身高 / 体重会按腰围自动推算',
        sizeSample: '示例数据',
        sizeLogoTitle: '品牌 Logo',
        sizeLogoHint: '上传后会一直保存在本机，不替换就一直使用；生成海报时显示在顶部',
        sizeLogoPick: '上传 Logo',
        sizeLogoReplace: '更换 Logo',
        sizeWeightUnit: '建议体重单位',
        sizeWeightHint: '公斤（kg）与斤之间切换，只影响显示与海报',
        sizeDownload: '下载 PNG',
        sizePreviewTitle: '海报预览',
        sizePreviewHint: '表格与 Logo 变化后自动更新，下载保存的就是当前预览',
        sizeNotesTitle: '说明',
        sizeNotesBody: '建议身高 / 体重由原尺码表的围度数据推算，仅供参考；生成的海报可直接用于商品详情页。',
        sizeDownloaded: '图片已开始下载',
        morning: '早上好',
        afternoon: '下午好',
        evening: '晚上好',
        welcome: '，欢迎回来',
        homeLead: '今天想做什么？从这里开始你的工作。',
        newSession: '开始新会话',
        enterStudio: '进入生图工作间',
        openConversation: '会话',
        plugins: '插件管理',
        schedules: '定时任务',
        statTotal: '已生成图片',
        statTotalSub: '累计生成',
        statModel: '当前模型',
        statOutput: '输出目录',
        unknown: '未配置',
        recentTitle: '最近生成',
        recentEmpty: '还没有生成过图片，去「生图」里试一张。',
        refresh: '刷新',
        shortcuts: '快捷入口',
        quickStudioHint: '描述模特与背景，上传商品图出图',
        quickSizeHint: '上传尺码表，自动生成海报',
        quickConversationHint: '回到当前对话',
        quickPluginsHint: '启停与配置插件',
        quickSchedulesHint: '查看自动化任务',
        studioTitle: '电商模特图工作间',
        studioHint: '用文字描述模特与背景，上传商品参考图，选好画幅与分辨率，一键出图。',
        studioRefsTitle: '参考图',
        studioRefsHint: '上传商品参考图，生成时作为商品参考发送',
        studioModelTitle: '模特与动作',
        studioCanvasTitle: '画面',
        studioPromptGroupTitle: '描述与提示词',
        presets: '快速模板',
        saveTemplate: '＋ 保存为模板',
        templateName: '模板名称',
        templateNamePh: '例：白底主图',
        templatesEmpty: '还没有自定义模板。填好商品描述、画幅等后点「＋ 保存为模板」。',
        templateManage: '管理模板',
        templatePageTitle: '模板库',
        templatePageHint: '在这里编辑或删除模板。模板保存商品描述、提示词、画幅与分辨率，不包含参考图。',
        templateEditTitle: '编辑模板',
        templateDeleteConfirm: '确认删除？',
        templateApply: '应用',
        templatePageEmpty: '还没有模板，回到生图页填好信息后点「＋ 保存为模板」。',
        templateSaved: '模板已保存',
        templateUpdated: '模板已更新',
        templateApplied: '已应用模板',
        templateDesc: '商品描述',
        templatePrompt: '自定义提示词',
        templateDefaultName: '模板',
        promptLibraryTitle: '提示词库',
        promptLibraryHint: '集中管理可复用提示词：风格/画面、模特、背景三类。在生图页各字段点「保存为复用提示词」即可添加。',
        promptKindStyle: '风格 / 画面',
        promptKindModel: '模特',
        promptKindScene: '背景',
        promptKindLabel: '类别',
        promptTextLabel: '提示词内容',
        promptEditTitle: '编辑提示词',
        promptNewTitle: '新建提示词',
        newPrompt: '＋ 新建提示词',
        promptLibraryEmpty: '还没有提示词。在生图页填好内容后点「保存为复用提示词」。',
        promptSaved: '提示词已保存',
        promptUpdated: '提示词已更新',
        promptManage: '提示词库',
        fModelPrompt: '模特提示词（可选）',
        fModelPromptPh: '例：25 岁亚洲女性，黑色长直发，冷白皮，身材高挑，自然淡妆',
        fBackgroundPrompt: '背景提示词（可选）',
        fBackgroundPromptPh: '例：城市街道傍晚，暖色逆光，浅景深，地面有轻微反光',
        modelPromptHint: '用文字描述模特形象（脸型、发型、肤色、身材等），会写入生成提示词',
        backgroundPromptHint: '用文字描述背景环境（场景、光线、色调等），会写入生成提示词',
        fPose: '姿态',
        fPoseCustom: '＋ 自定义动作',
        poseEmptyHint: '暂无自定义动作。点下方「＋ 自定义动作」进入动作库添加',
        poseName: '动作名称',
        poseNamePh: '例：单手插兜站姿',
        posePrompt: '动作描述（中文，会进入提示词）',
        posePromptPh: '例：单手插兜，身体微侧，重心落在一条腿上',
        poseSave: '保存动作',
        poseEdit: '编辑',
        poseListTitle: '已保存的动作',
        posePageTitle: '动作库',
        posePageHint: '在这里新增、编辑、删除自定义动作。保存后回到生图页，就能在「姿态」里选择使用。',
        poseBack: '← 返回生图',
        poseAddTitle: '新增动作',
        poseEditTitle: '编辑动作',
        poseListEmpty: '还没有自定义动作，先在上面新增一个。',
        poseDeleteConfirm: '确认删除？',
        poseSelected: '当前选中',
        poseSaved: '已保存',
        fShow: '模特展示',
        fExtraPrompt: '自定义提示词（光线 / 风格等自由填写）',
        fExtraPromptPh: '例：柔和侧逆光，暖色调，杂志高级感，film grain，35mm 质感',
        saveReusable: '＋ 保存为可复用提示词',
        builtinPromptName: '男裤严格保真 V2.2（内置）',
        builtinPromptsTitle: '内置提示词',
        builtinPromptsHint: '内置提示词在勾选「商品严格保真」时自动附加到生成提示词。点「编辑」可修改规则内容，修改后一直生效，也可随时恢复默认。',
        edit: '编辑',
        restoreDefault: '恢复默认',
        fidelityModified: '已自定义',
        fidelityDefault: '默认',
        strictFidelity: '商品严格保真（内置 V2.2）',
        strictFidelityHint: '自动附加内置保真规则：锁定商品颜色、面料、版型、结构与细节；商品真实性高于画面美观度',
        promptNameLabel: '提示词名称',
        promptNamePh: '例：暖调杂志风',
        saveName: '保存',
        cancel: '取消',
        fRatio: '画幅',
        fResolution: '分辨率',
        resolutionHint: '4K 需接口与模型支持对应尺寸；分辨率越高生成越慢',
        currentSize: '当前请求尺寸',
        fDesc: '商品描述（建议填，会进入提示词）',
        fDescPh: '例：白色真丝吊带连衣裙，细肩带，胸前抽褶，中长款',
        extractFromRefs: '从商品图提取',
        extracting: '提取中…',
        extractNeedRef: '请先在上方「商品参考图」上传商品图',
        extractDone: '已从商品参考图提取关键元素，可手动修改',
        extractEmpty: '没有提取到内容，请换一张更清晰的商品图',
        fProductRef: '商品参考图（可选）',
        fProductRefHint: '可上传多张（服装正反面 / 细节图），生成时作为商品参考',
        fProductRefAdd: '上传商品图',
        productCount: '已上传',
        refsSavedHint: '已自动保存，删除后清除',
        refsCount: '张参考图',
        remove: '移除',
        modeEdit: '图生图模式',
        modeText: '文生图模式',
        fNeg: '负面词',
        fNegPh: '模糊、低清晰度、噪点、压缩痕迹、水印、文字、多余手指、变形的手、多手多脚、五官扭曲、严重畸变、背景错乱、背景杂乱、人物与背景融合、穿模、画面透灰不清晰、雾面、过曝、欠曝、色彩失真、偏色、材质错误、商品变形、过度锐化、塑料感',
        fNegInclude: '把负面词以「严禁出现」拼进提示词',
        promptTitle: '提示词预览（可直接编辑）',
        promptReset: '还原',
        copy: '复制提示词',
        copied: '已复制',
        generate: '生成图片',
        queueTitle: '生成队列',
        queueHint: '可以连续点击生成：任务会并行处理，互不等待',
        queueAdded: '已加入生成队列',
        queueFull: '排队任务过多，请等当前任务完成后再试。',
        queueQueued: '排队中',
        queueRunning: '生成中',
        queueDone: '完成',
        queueError: '失败',
        queueRunningCount: '并行生成',
        queueClearFinished: '清除已完成',
        needKey: '请先在「设置」里填写 API Key 和接口地址。',
        needPrompt: '请先填写提示词或选择一个模板。',
        resultTitle: '生成结果',
        resultEmpty: '生成结果会显示在这里。',
        historyTitle: '历史图片',
        saveDir: '打开输出目录',
        profilesTitle: '接口配置',
        profilesHint: '可添加多个接口并备注名称，点一下即切换；生图时使用标着「当前」的那个接口。',
        addProfile: '＋ 新增配置',
        deleteProfile: '删除此配置',
        profileName: '备注名称',
        profileNamePh: '例：豆包 Seedream / OpenAI 官方',
        newProfileName: '新配置',
        currentTag: '当前',
        activeNow: '当前接口已切换到',
        lastProfileWarn: '至少保留一个接口配置',
        activeInterface: '当前接口',
        sBaseUrl: '接口地址（OpenAI 兼容，以 /v1 结尾）',
        sModel: '模型名',
        sFetchModels: '拉取模型',
        sFetching: '拉取中…',
        sModelHint: '按当前接口地址与 Key（含未保存的填写）拉取可选模型',
        sModelsFound: '个可用模型，点击选用',
        sKey: 'API Key',
        sKeyPhSet: '已保存，留空则不修改',
        sKeyPhEmpty: 'sk-…',
        sClearKey: '清除 Key',
        sSize: '尺寸写法（x 或 *）',
        sSizeHint: '只决定请求里尺寸的分隔符：填 2048*2048 就用 *，填 2048x2048 就用 x；实际分辨率由「画幅 + 分辨率」决定',
        sQuality: '画质参数（留空则不发）',
        sOutput: '输出目录',
        pick: '选择目录',
        save: '保存设置',
        saved: '已保存',
        test: '测试连接',
        testing: '测试中…',
        testOk: '连接正常',
        testFail: '连接失败',
        appearance: '外观',
        accentHint: '强调色会立刻应用到整个 Harness 界面并记住选择。',
        aboutTitle: '关于',
        aboutBody: '这是专属工作台插件：Host 侧在本机代理图片接口（Key 只保存在本机配置文件），Client 侧提供工作台页面。模特四视图、商品图与场景图会按顺序作为 /images/edits 的多张参考图发送（最多 6 张：1 模特四视图 + 4 商品图 + 1 场景图）；未上传任何参考图时走文生图 /images/generations。',
        close: '关闭',
      },
      en: {
        title: 'My Workbench',
        subtitle: 'Personal home · e-commerce model image studio',
        tabHome: 'Overview',
        tabStudio: 'Studio',
        tabSize: 'Size chart',
        tabSettings: 'Settings',
        sizeTitle: 'Size chart calculator & converter',
        sizeHint: 'Grade every size from a base size and convert between centimetres and inches',
        sizeAddRow: '+ Add size',
        sizeRemoveRow: 'Remove',
        sizeGenerated: 'Sample size data loaded',
        sizeNewLabel: 'New',
        sizeSizeHeader: 'Size',
        sizeUploadTitle: 'Size chart photo',
        sizeUploadHint: 'Upload an existing size-chart screenshot; sizes and measurements are recognised automatically and stay editable',
        sizeUploadNote: 'PNG / JPG / WebP, up to 8MB',
        sizeUploadPick: 'Upload size chart',
        sizeUploadReplace: 'Change photo',
        sizeExtract: 'Recognise table',
        sizeExtracting: 'Recognising…',
        sizeExtractNeed: 'Upload a size chart photo first',
        sizeExtractDone: 'Sizes recognised; edit them if needed',
        sizeDataTitle: 'Size data',
        sizeDataHint: 'Values are editable; suggested height/weight are derived from the waist',
        sizeSample: 'Sample data',
        sizeLogoTitle: 'Brand logo',
        sizeLogoHint: 'Saved locally and kept until replaced; it is placed at the top of the poster',
        sizeLogoPick: 'Upload logo',
        sizeLogoReplace: 'Change logo',
        sizeWeightUnit: 'Weight unit',
        sizeWeightHint: 'Switch between kg and jin (1 kg = 2 jin); affects the display and poster only',
        sizeDownload: 'Download PNG',
        sizePreviewTitle: 'Poster preview',
        sizePreviewHint: 'Updates automatically with the table and logo; the download saves this exact preview',
        sizeNotesTitle: 'Notes',
        sizeNotesBody: 'Suggested height/weight are estimated from the original chart measurements and are for reference only. The poster is ready for a product page.',
        sizeDownloaded: 'Download started',
        morning: 'Good morning',
        afternoon: 'Good afternoon',
        evening: 'Good evening',
        welcome: ', welcome back',
        homeLead: 'What are we making today? Start here.',
        newSession: 'New session',
        enterStudio: 'Open image studio',
        openConversation: 'Chat',
        plugins: 'Plugins',
        schedules: 'Schedules',
        statTotal: 'Images generated',
        statTotalSub: 'Total generated',
        statModel: 'Current model',
        statOutput: 'Output folder',
        unknown: 'Not configured',
        recentTitle: 'Recent images',
        recentEmpty: 'Nothing generated yet — try the Studio tab.',
        refresh: 'Refresh',
        shortcuts: 'Shortcuts',
        quickStudioHint: 'Describe the model & background and generate',
        quickSizeHint: 'Upload a size chart and generate a poster',
        quickConversationHint: 'Back to the current conversation',
        quickPluginsHint: 'Enable and configure plugins',
        quickSchedulesHint: 'Automated tasks and reminders',
        studioTitle: 'E-commerce model image studio',
        studioHint: 'Describe the model and background in text, upload product photos, then pick aspect and resolution to generate.',
        studioRefsTitle: 'References',
        studioRefsHint: 'Upload product photos; they are sent as product references',
        studioModelTitle: 'Model & pose',
        studioCanvasTitle: 'Canvas',
        studioPromptGroupTitle: 'Description & prompt',
        presets: 'Presets',
        saveTemplate: '+ Save as template',
        templateName: 'Template name',
        templateNamePh: 'e.g. white-background main image',
        templatesEmpty: 'No custom templates yet. Fill in the description, aspect and so on, then press “+ Save as template”.',
        templateManage: 'Manage templates',
        templatePageTitle: 'Template library',
        templatePageHint: 'Edit or delete templates here. A template stores the description, prompt, aspect and resolution — not reference images.',
        templateEditTitle: 'Edit template',
        templateDeleteConfirm: 'Confirm delete?',
        templateApply: 'Apply',
        templatePageEmpty: 'No templates yet. Go back to the studio, fill in the form, then press “+ Save as template”.',
        templateSaved: 'Template saved',
        templateUpdated: 'Template updated',
        templateApplied: 'Template applied',
        templateDesc: 'Product description',
        templatePrompt: 'Custom prompt',
        templateDefaultName: 'Template',
        promptLibraryTitle: 'Prompt library',
        promptLibraryHint: 'All reusable prompts in one place: style/framing, model and background. Add them from the studio with “Save as reusable prompt”.',
        promptKindStyle: 'Style / framing',
        promptKindModel: 'Model',
        promptKindScene: 'Background',
        promptKindLabel: 'Category',
        promptTextLabel: 'Prompt text',
        promptEditTitle: 'Edit prompt',
        promptNewTitle: 'New prompt',
        newPrompt: '+ New prompt',
        promptLibraryEmpty: 'No prompts yet. Fill a field in the studio, then press “Save as reusable prompt”.',
        promptSaved: 'Prompt saved',
        promptUpdated: 'Prompt updated',
        promptManage: 'Prompt library',
        fModelPrompt: 'Model prompt (optional)',
        fModelPromptPh: 'e.g. 25-year-old Asian woman, long straight black hair, fair skin, tall, natural makeup',
        fBackgroundPrompt: 'Background prompt (optional)',
        fBackgroundPromptPh: 'e.g. city street at dusk, warm backlight, shallow depth of field, slight ground reflection',
        modelPromptHint: 'Describe the model in text (face, hair, skin tone, build); it is written into the prompt.',
        backgroundPromptHint: 'Describe the background in text (scene, light, mood); it is written into the prompt.',
        fPose: 'Pose',
        fPoseCustom: '+ Custom pose',
        poseEmptyHint: 'No custom actions yet. Use “+ Custom pose” below to open the action library.',
        poseName: 'Action name',
        poseNamePh: 'e.g. hand-in-pocket stance',
        posePrompt: 'Action description (Chinese, used in prompt)',
        posePromptPh: 'e.g. one hand in pocket, body slightly turned, weight on one leg',
        poseSave: 'Save action',
        poseEdit: 'Edit',
        poseListTitle: 'Saved actions',
        posePageTitle: 'Action library',
        posePageHint: 'Add, edit and delete custom actions here. Saved actions are available under “Pose” on the studio page.',
        poseBack: '← Back to studio',
        poseAddTitle: 'New action',
        poseEditTitle: 'Edit action',
        poseListEmpty: 'No custom actions yet. Add one above.',
        poseDeleteConfirm: 'Confirm delete?',
        poseSelected: 'Selected',
        poseSaved: 'Saved',
        fShow: 'Model framing',
        fExtraPrompt: 'Custom prompt (lighting, style, anything)',
        fExtraPromptPh: 'e.g. soft rim light, warm tones, editorial mood, film grain',
        saveReusable: '+ Save as reusable prompt',
        builtinPromptName: 'Strict product fidelity V2.2 (built-in)',
        builtinPromptsTitle: 'Built-in prompts',
        builtinPromptsHint: 'Built-in prompts are appended automatically while “Strict product fidelity” is on. Edit the rules here; changes stay in effect and can be restored to default at any time.',
        edit: 'Edit',
        restoreDefault: 'Restore default',
        fidelityModified: 'Customized',
        fidelityDefault: 'Default',
        strictFidelity: 'Strict product fidelity (built-in V2.2)',
        strictFidelityHint: 'Appends built-in fidelity rules locking color, fabric, cut, structure and details; product accuracy beats visual polish',
        promptNameLabel: 'Prompt name',
        promptNamePh: 'e.g. warm editorial',
        saveName: 'Save',
        cancel: 'Cancel',
        fRatio: 'Aspect',
        fResolution: 'Resolution',
        resolutionHint: '4K requires API/model support for that size; higher resolution is slower',
        currentSize: 'Requested size',
        fDesc: 'Product description (recommended)',
        fDescPh: 'e.g. white silk slip dress with thin straps and pleated bodice',
        extractFromRefs: 'Extract from photos',
        extracting: 'Extracting…',
        extractNeedRef: 'Upload product photos first',
        extractDone: 'Key elements extracted from the product photos; edit as needed',
        extractEmpty: 'Nothing extracted; try a clearer product photo',
        fProductRef: 'Product reference (optional)',
        fProductRefHint: 'Multiple photos allowed (front/back/detail); sent as product references',
        fProductRefAdd: 'Upload product',
        productCount: 'uploaded',
        refsSavedHint: 'Saved automatically; cleared when removed',
        refsCount: 'references',
        remove: 'Remove',
        modeEdit: 'Image-to-image',
        modeText: 'Text-to-image',
        fNeg: 'Negative prompt',
        fNegPh: 'blurry, low clarity, noise, compression artifacts, watermark, text, extra fingers, deformed hands, extra limbs, distorted face, severe distortion, chaotic background, cluttered background, subject blending into background, clipping artifacts, hazy washed-out image, foggy, overexposed, underexposed, color distortion, color cast, wrong material, distorted product, oversharpened, plastic look',
        fNegInclude: 'Append negative prompt as “strictly forbidden”',
        promptTitle: 'Prompt preview (editable)',
        promptReset: 'Restore',
        copy: 'Copy prompt',
        copied: 'Copied',
        generate: 'Generate',
        queueTitle: 'Generation queue',
        queueHint: 'Keep clicking Generate: jobs run in parallel and do not block each other',
        queueAdded: 'Added to the generation queue',
        queueFull: 'Too many queued jobs; wait for the current ones to finish.',
        queueQueued: 'Queued',
        queueRunning: 'Generating',
        queueDone: 'Done',
        queueError: 'Failed',
        queueRunningCount: 'running',
        queueClearFinished: 'Clear finished',
        needKey: 'Set the API endpoint and key in Settings first.',
        needPrompt: 'Write a prompt or pick a template first.',
        resultTitle: 'Results',
        resultEmpty: 'Generated images appear here.',
        historyTitle: 'History',
        saveDir: 'Open output folder',
        profilesTitle: 'API profiles',
        profilesHint: 'Add several endpoints, give each a note, and click one to switch. Generation uses the profile marked CURRENT.',
        addProfile: '+ Add profile',
        deleteProfile: 'Delete this profile',
        profileName: 'Note / name',
        profileNamePh: 'e.g. Doubao Seedream / OpenAI official',
        newProfileName: 'New profile',
        currentTag: 'Current',
        activeNow: 'Active profile switched to',
        lastProfileWarn: 'Keep at least one API profile',
        activeInterface: 'Active API',
        sBaseUrl: 'Endpoint (OpenAI compatible, ends with /v1)',
        sModel: 'Model',
        sFetchModels: 'Fetch models',
        sFetching: 'Fetching…',
        sModelHint: 'Uses the current endpoint and key (unsaved edits included)',
        sModelsFound: 'models available — click one',
        sKey: 'API key',
        sKeyPhSet: 'Saved — leave empty to keep',
        sKeyPhEmpty: 'sk-…',
        sClearKey: 'Clear key',
        sSize: 'Size format (x or *)',
        sSizeHint: 'Only the separator of the size sent to the API is taken from here: 2048*2048 uses *, 2048x2048 uses x. The actual size comes from aspect + resolution.',
        sQuality: 'Quality parameter (empty = omit)',
        sOutput: 'Output folder',
        pick: 'Browse',
        save: 'Save settings',
        saved: 'Saved',
        test: 'Test connection',
        testing: 'Testing…',
        testOk: 'Connection OK',
        testFail: 'Connection failed',
        appearance: 'Appearance',
        accentHint: 'The accent applies to the whole Harness UI immediately and is remembered.',
        aboutTitle: 'About',
        aboutBody: 'Personal workbench plugin: the Host half proxies the image API locally (the key stays in a local config file); the Client half renders this page. The model sheet, product photos and scene photo are sent in order as multiple references to /images/edits (up to 6: 1 model sheet + 4 product photos + 1 scene photo); without references it uses text-to-image /images/generations.',
        close: 'Close',
      },
    }

    // ------------------------------------------------------------- constants
    // Model framing: whether the face is visible and where the frame starts.
    const SHOW = [
      { id: 'face', zh: '露脸', en: 'show face', prompt: "the model's face is fully visible with a natural expression, looking at the camera" },
      { id: 'neck', zh: '从脖子处裁切', en: 'crop at neck', prompt: "framed from the neck down, the model's head is cropped out of the frame, no face visible" },
      { id: 'chest', zh: '从胸部处裁切', en: 'crop at chest', prompt: "framed from the chest down, the model's head and neck are cropped out of the frame, no face visible" },
    ]
    // All ratios are available at 1K / 2K / 4K; the resolution chip below the
    // aspect chips selects which size table is used for the request.
    const RATIOS = [
      {
        id: 'square', zh: '方形 1:1', en: 'Square 1:1', prompt: 'square composition',
        sizes: { '1k': '1024x1024', '2k': '2048x2048', '4k': '4096x4096' },
      },
      {
        id: 'portrait', zh: '竖版 3:4', en: 'Portrait 3:4', prompt: 'vertical fashion composition',
        sizes: { '1k': '768x1024', '2k': '1536x2048', '4k': '3072x4096' },
      },
      {
        id: 'landscape', zh: '横版 4:3', en: 'Landscape 4:3', prompt: 'horizontal composition',
        sizes: { '1k': '1024x768', '2k': '2048x1536', '4k': '4096x3072' },
      },
      {
        id: 'portrait-9-16', zh: '竖版 9:16', en: 'Portrait 9:16', prompt: 'vertical 9:16 social-media composition, full-body fashion framing',
        sizes: { '1k': '576x1024', '2k': '1152x2048', '4k': '2304x4096' },
      },
      {
        id: 'landscape-16-9', zh: '横版 16:9', en: 'Landscape 16:9', prompt: 'horizontal 16:9 widescreen composition, cinematic fashion framing',
        sizes: { '1k': '1024x576', '2k': '2048x1152', '4k': '4096x2304' },
      },
    ]
    const RESOLUTIONS = [
      { id: '1k', zh: '1K', en: '1K' },
      { id: '2k', zh: '2K', en: '2K' },
      { id: '4k', zh: '4K', en: '4K' },
    ]
    const QUALITIES = [
      { id: '', zh: '默认', en: 'default' },
      { id: 'auto', zh: 'auto', en: 'auto' },
      { id: 'low', zh: 'low（快）', en: 'low' },
      { id: 'medium', zh: 'medium', en: 'medium' },
      { id: 'high', zh: 'high（精细）', en: 'high' },
    ]

    // Poster generator defaults: a sample pants chart that can be replaced by a
    // recognised upload. Measurements are centimetres.
    const DEFAULT_SIZE_CHART = {
      columns: [
        { key: 'c0', name: '腰围' },
        { key: 'c1', name: '臀围' },
        { key: 'c2', name: '裤长' },
      ],
      rows: [
        { id: 'r0', size: 'S', values: { c0: 72, c1: 98, c2: 104 } },
        { id: 'r1', size: 'M', values: { c0: 76, c1: 102, c2: 106 } },
        { id: 'r2', size: 'L', values: { c0: 80, c1: 106, c2: 108 } },
        { id: 'r3', size: 'XL', values: { c0: 84, c1: 110, c2: 110 } },
        { id: 'r4', size: '2XL', values: { c0: 88, c1: 114, c2: 112 } },
        { id: 'r5', size: '3XL', values: { c0: 92, c1: 118, c2: 114 } },
      ],
    }

    const SIZE_COLUMN_EN = {
      腰围: 'WAIST',
      臀围: 'HIP',
      裤长: 'LENGTH',
      脾围: 'THIGH',
      脚围: 'HEM',
      大腿围: 'THIGH',
      胸围: 'CHEST',
      衣长: 'LENGTH',
      裙长: 'LENGTH',
      肩宽: 'SHOULDER',
      袖长: 'SLEEVE',
      腿围: 'THIGH',
    }

    // Suggested weight (kg) interpolation points derived from the waist. The
    // poster labels these numbers as an estimate, not a fit guarantee.
    const WEIGHT_SAMPLES = [
      { waist: 72, low: 50, high: 60 },
      { waist: 76, low: 56, high: 67 },
      { waist: 80, low: 63, high: 75 },
      { waist: 84, low: 72, high: 86 },
      { waist: 88, low: 81, high: 96 },
      { waist: 92, low: 91, high: 108 },
    ]

    function weightRangeForWaist(waist) {
      const value = Number(waist)
      if (!Number.isFinite(value)) return null
      const points = WEIGHT_SAMPLES
      for (let index = 1; index < points.length; index += 1) {
        if (value <= points[index].waist) {
          const prev = points[index - 1]
          const next = points[index]
          const ratio = (value - prev.waist) / (next.waist - prev.waist)
          return {
            low: prev.low + (next.low - prev.low) * ratio,
            high: prev.high + (next.high - prev.high) * ratio,
          }
        }
      }
      const last = points[points.length - 1]
      const prev = points[points.length - 2]
      const slopeLow = (last.low - prev.low) / (last.waist - prev.waist)
      const slopeHigh = (last.high - prev.high) / (last.waist - prev.waist)
      return {
        low: last.low + slopeLow * (value - last.waist),
        high: last.high + slopeHigh * (value - last.waist),
      }
    }


    /**
     * Built-in strict product-fidelity module (V2.2, highest priority).
     * Appended to every prompt while the studio toggle stays on, so the model is
     * forced to reproduce the exact uploaded product instead of a look-alike.
     */
    const FIDELITY_MODULE = [
      '【商品严格保真规则 V2.2 · 最高优先级】以商品参考图为唯一设计依据，必须生成同一件商品，而非相似款式或重新设计的商品；商品真实性始终高于画面美观度。',
      '商品身份：严格保持原始商品的颜色、材质、纹理、版型、尺寸比例、结构及全部可辨认的设计细节；禁止替换商品、重新设计、增加、删除或擅自修改任何原有商品特征。',
      '颜色与面料：严格保持原始色相、饱和度、配色分布、面料材质、织纹方向/粗细/密度/排列规律、厚薄视觉特征与光泽；保持原始水洗位置、褪色范围、磨白痕迹、磨损分布及颜色深浅关系；允许真实光照产生自然明暗、阴影与高光，但不得改变商品固有颜色、材质或永久设计；禁止偏色、材质替换、纹理重绘、虚构水洗磨损、过度平滑及过度锐化。',
      '版型与比例：严格保持原始腰部、臀部、裆部、大腿、膝部、小腿及裤脚之间的结构比例与宽松程度；保持裤型轮廓、裤腿宽度、裤长、裤脚开口及整体垂坠特征；禁止擅自收窄、加宽、拉长、缩短或改变原始裁剪结构；允许真实穿着产生合理形变，但不得改变原始设计版型。',
      '结构拓扑：严格保持腰头、腰带袢、纽扣、门襟、口袋、拼接布片、缝线、金属五金等原有结构的数量、形状、连接关系与相对位置；复杂几何拼接必须保持原始线条走向、拐角形状与结构比例；禁止新增、删除、移动、合并、复制、镜像或简化商品结构。',
      '特殊设计：仅还原参考图中真实存在的破洞、刺绣、印花、拼布、条纹、铆钉等特殊设计，并严格保持其数量、位置、尺寸比例、轮廓形状、颜色与相互对应关系；破洞必须保持原始边缘磨损、内部可见材质与轮廓特征；禁止重新设计、复制、移动、镜像、遗漏或虚构特殊装饰。',
      '相对位置：以原始商品整体结构为依据，保持各设计细节与腰头、口袋、裆部、膝部及裤脚之间的相对位置关系；允许真实穿着造成合理透视变化与面料弯曲，但不得主动改变永久设计的位置、比例与连接关系。',
      '多参考图协同：正面图定义正面设计，侧面图补充侧面结构，背面图定义背面设计；完整商品图确定整体版型与结构比例，局部特写补充可辨认细节；不同视角的商品结构不得错误镜像、交换或混合，背面专属设计不得出现在正面，正面专属设计不得出现在背面；参考图与文字描述冲突时以真实商品参考图为准；缺少关键视角信息时不得自行虚构不可见的商品设计。',
      '真实穿着约束：裤子必须自然穿着于人体，符合人体支撑、面料重量、重力及真实服装物理规律；允许自然褶皱、局部张力、合理垂坠及符合原始裤型的裤脚堆积；严格区分原始水洗、破洞、拼接等永久设计与穿着产生的临时褶皱；禁止用异常褶皱遮挡、移动、扭曲或改变商品关键结构；禁止面料悬浮、穿模、异常拉伸、结构错位及不符合重力规律的变形。',
      '商品完整展示：裤腰最顶部至裤脚最底部必须完整入镜；腰头、纽扣、腰带袢、门襟、口袋及主要设计结构清晰可辨；禁止上衣、手部、配饰或其他物体遮挡商品关键结构；不得为构图美观而裁切、隐藏或修改商品主要设计。',
      '最终执行要求：商品真实性高于模特动作、服装搭配、摄影光影及画面美观度；所有可辨认的原始设计细节必须尽可能准确还原；不得通过改变商品结构来满足其他视觉要求；最终呈现真实商品自然穿着于人体的效果，而非重新设计的相似商品。',
    ].join('\n')

    const ACCENTS = [
      { id: 'default', zh: '跟随主题', en: 'Theme default', light: '', dark: '' },
      { id: 'blue', zh: '深海蓝', en: 'Deep blue', light: '#2563eb', dark: '#60a5fa' },
      { id: 'green', zh: '薄荷绿', en: 'Mint', light: '#059669', dark: '#34d399' },
      { id: 'violet', zh: '紫罗兰', en: 'Violet', light: '#7c3aed', dark: '#a78bfa' },
      { id: 'orange', zh: '落日橙', en: 'Sunset orange', light: '#ea580c', dark: '#fb923c' },
      { id: 'rose', zh: '玫瑰粉', en: 'Rose', light: '#e11d48', dark: '#fb7185' },
    ]

    const DEFAULT_FORM = {
      pose: '',
      show: 'face',
      ratio: 'square',
      resolution: '2k',
      desc: '',
      modelPrompt: '',
      backgroundPrompt: '',
      extraPrompt: '',
      strictFidelity: true,
      negative: '模糊、低清晰度、噪点、压缩痕迹、水印、文字、多余手指、变形的手、多手多脚、五官扭曲、严重畸变、背景错乱、背景杂乱、人物与背景融合、穿模、画面透灰不清晰、雾面、过曝、欠曝、色彩失真、偏色、材质错误、商品变形、过度锐化、塑料感',
      includeNegative: false,
    }

    // --------------------------------------------------------------- helpers
    function findOption(list, id) {
      for (let i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i]
      return list[0]
    }

    function optionLabel(option, lang) {
      return lang === 'zh' ? option.zh : option.en
    }

    function loadJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : fallback
      } catch {
        return fallback
      }
    }

    function saveJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // storage unavailable; preference is session-only
      }
    }

    // ------------------------------------------------------ reference tuning
    // Reference photos are downscaled and re-encoded in the browser before they
    // reach the Host: smaller uploads make the provider-side /images/edits call
    // faster, while a 2048px long edge keeps product detail for 2K generation.
    // Opaque images become JPEG; images with alpha stay PNG.
    const REFERENCE_MAX_EDGE = 2048
    const REFERENCE_SKIP_BYTES = 1.2 * 1024 * 1024

    function readBlobAsDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('read failed'))
        reader.readAsDataURL(blob)
      })
    }

    /**
     * Downscale/re-encode one reference image when that actually saves bytes.
     * Returns null when the original should be used unchanged (small image, no
     * canvas support, decode failure), so this can never make an upload worse.
     */
    async function optimizeReferenceImage(file) {
      if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
      let bitmap = null
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch {
        try {
          bitmap = await createImageBitmap(file)
        } catch {
          return null
        }
      }
      try {
        const width = bitmap.width
        const height = bitmap.height
        if (!width || !height) return null
        const longEdge = Math.max(width, height)
        if (longEdge <= REFERENCE_MAX_EDGE && file.size <= REFERENCE_SKIP_BYTES) return null
        const scale = Math.min(1, REFERENCE_MAX_EDGE / longEdge)
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (!context) return null
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
        // Keep transparency when present (product cut-outs); encode everything
        // else as JPEG, which every OpenAI-compatible relay accepts.
        let hasAlpha = true
        try {
          const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data
          hasAlpha = false
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] < 255) {
              hasAlpha = true
              break
            }
          }
        } catch {
          hasAlpha = true
        }
        const mime = hasAlpha ? 'image/png' : 'image/jpeg'
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, hasAlpha ? undefined : 0.9))
        if (!blob || blob.size === 0) return null
        if (scale === 1 && blob.size >= file.size) return null
        return {
          dataUrl: await readBlobAsDataUrl(blob),
          mediaType: mime,
          bytes: blob.size,
          width: targetWidth,
          height: targetHeight,
        }
      } catch {
        return null
      } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close()
      }
    }

    const LEGACY_NEGATIVE = 'blurry, low quality, watermark, text, extra fingers, deformed hands'
    const LEGACY_NEGATIVE_ZH_V1 = '模糊、低质量、水印、文字、多余手指、变形的手、严重畸变'
    const LEGACY_POSES = ['front', 'side', 'walk', 'sit', 'close']

    function loadForm() {
      const saved = loadJson(LS_FORM, {})
      const merged = { ...DEFAULT_FORM, ...saved }
      // Upgrade an untouched old negative prompt to the expanded Chinese one
      // unless the user has customised it.
      if (merged.negative === LEGACY_NEGATIVE || merged.negative === LEGACY_NEGATIVE_ZH_V1) {
        merged.negative = DEFAULT_FORM.negative
      }
      // Built-in poses were removed; an old built-in id no longer has a chip.
      if (LEGACY_POSES.indexOf(merged.pose) >= 0) merged.pose = ''
      return merged
    }

    function settingsToDraft(value) {
      if (!value) return null
      return {
        activeId: value.activeId,
        outputDir: value.outputDir || '',
        profiles: (value.profiles || []).map(profile => ({ ...profile, apiKey: '', clearKey: false })),
      }
    }

    // Chinese prompt fragments for the option chips (the generated prompt is Chinese).
    const ZH_SHOW = {
      face: '模特面部完整可见，自然表情，看向镜头',
      neck: '画面从颈部以下取景，头部裁出画面，不露脸',
      chest: '画面从胸部以下取景，头颈均裁出画面，不露脸',
    }
    const ZH_RATIO = {
      square: '方形构图',
      portrait: '竖版时装构图',
      landscape: '横版构图',
      'portrait-9-16': '竖版 9:16 社媒构图，全身时装取景',
      'landscape-16-9': '横版 16:9 宽银幕构图，电影感时装取景',
    }

    /** The strict-fidelity module can be customised from Settings; fall back to
     *  the built-in V2.2 text when the user has not edited it. */
    function loadFidelityText() {
      const saved = loadJson(LS_FIDELITY, null)
      if (saved && typeof saved.text === 'string' && saved.text.trim()) return saved.text
      return FIDELITY_MODULE
    }

    /**
     * Builds the Chinese prompt sent to the image API.
     * @param form studio selections
     * @param hasModelSheet whether a four-view model reference was uploaded
     * @param hasProductRef whether a product reference was uploaded
     * @param hasSceneRef whether a scene reference was uploaded
     * @param customPoses user-defined poses (id, name, prompt)
     * @param fidelityText strict-product-fidelity module (editable in Settings)
     */
    function buildPrompt(form, hasModelSheet, hasProductRef, hasSceneRef, customPoses, fidelityText) {
      const description = form.desc && form.desc.trim() ? form.desc.trim() : ''
      const modelPrompt = form.modelPrompt && form.modelPrompt.trim() ? form.modelPrompt.trim() : ''
      const backgroundPrompt = form.backgroundPrompt && form.backgroundPrompt.trim() ? form.backgroundPrompt.trim() : ''
      // A model appears when a model sheet is uploaded or described by text.
      const hasModel = Boolean(hasModelSheet) || Boolean(modelPrompt)
      const customPose = (customPoses || []).find(item => item && item.id === form.pose)
      const poseText = customPose && customPose.prompt ? customPose.prompt.trim() : ''

      const parts = []
      if (hasModelSheet) {
        parts.push('专业电商服装摄影，以模特参考图中的同一模特为原型，严格保持其面部、发型与身形一致')
        if (modelPrompt) parts.push(modelPrompt)
      } else if (modelPrompt) {
        parts.push(`专业电商服装摄影，模特：${modelPrompt}`)
      } else {
        parts.push('专业电商商品摄影')
      }

      if (hasProductRef) {
        parts.push(
          hasModel
            ? `穿着商品参考图中的商品${description ? `，${description}` : ''}`
            : `展示商品参考图中的商品${description ? `，${description}` : ''}`,
        )
      } else if (description) {
        parts.push(hasModel ? `穿着${description}` : `展示${description}`)
      } else if (hasModel) {
        parts.push('展示服装')
      }

      if (poseText) parts.push(poseText)
      if (hasModel) parts.push(ZH_SHOW[form.show] || ZH_SHOW.face)
      let background = ''
      if (hasSceneRef) background = '背景采用场景参考图中的环境，保持其背景、道具与氛围'
      if (backgroundPrompt) background = background ? `${background}，${backgroundPrompt}` : `背景：${backgroundPrompt}`
      parts.push(background || '干净的纯色影棚背景')
      if (form.extraPrompt && form.extraPrompt.trim()) parts.push(form.extraPrompt.trim())
      if (ZH_RATIO[form.ratio]) parts.push(ZH_RATIO[form.ratio])
      parts.push('85mm 镜头拍摄，f/2.8 大光圈，画面清晰锐利，面料纹理与缝线细节清晰；专业修图，商业级品质，真实摄影质感，高分辨率')
      parts.push('商品颜色、材质、版型与结构以商品参考图为准')

      let text = `${parts.filter(Boolean).join('，')}。`
      if (form.strictFidelity) text += `\n\n${fidelityText || FIDELITY_MODULE}`
      if (form.includeNegative && form.negative && form.negative.trim()) {
        text += `\n【严禁出现】${form.negative.trim()}。`
      }
      return text
    }

    async function api(pathname, options) {
      let response
      try {
        response = await fetch(`${API}${pathname}`, options)
      } catch (error) {
        throw new Error(`无法连接工作台本地服务（${error && error.message ? error.message : error}），请确认 Harness 已加载本插件。`)
      }
      let json = null
      try {
        json = await response.json()
      } catch {
        // non-JSON response
      }
      if (!response.ok) {
        throw new Error((json && json.error) || `HTTP ${response.status}`)
      }
      if (json && json.ok === false) throw new Error(json.error || '请求失败')
      return json || {}
    }

    function formatTime(date) {
      const pad = n => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function formatDuration(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return ''
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`
    }

    function formatDate(date, lang) {
      if (lang === 'zh') {
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
        return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${week}`
      }
      return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    }

    function greetingKey(date) {
      const hour = date.getHours()
      if (hour < 12) return 'morning'
      if (hour < 18) return 'afternoon'
      return 'evening'
    }

    let appCtx = null
    let accentDisposer = null

    function useLanguage() {
      const [, setVersion] = useState(0)
      useEffect(() => {
        if (!appCtx || !appCtx.locale) return undefined
        try {
          return appCtx.locale.subscribe(() => setVersion(value => value + 1))
        } catch {
          return undefined
        }
      }, [])
      let raw = ''
      try {
        const snapshot = appCtx && appCtx.locale ? appCtx.locale.getLocale() : null
        raw = snapshot ? String(snapshot.id || snapshot.locale || snapshot.language || '') : ''
      } catch {
        raw = ''
      }
      // Chinese is the product language of this personal workbench; English is
      // only used when the Harness locale is explicitly English.
      return raw.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh'
    }

    function applyAccent(ctx, accentId) {
      const accent = findOption(ACCENTS, accentId)
      try {
        if (accentDisposer) {
          accentDisposer()
          accentDisposer = null
        }
      } catch {
        accentDisposer = null
      }
      if (!accent || !accent.light) return
      try {
        accentDisposer = ctx.theme.overrideTokens('@local/personal-workbench/accent', {
          '--dsw-alias-brand-primary': { light: accent.light, dark: accent.dark },
        })
      } catch {
        accentDisposer = null
      }
    }

    // ------------------------------------------------------------ primitives
    function Card(props) {
      const style = {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 16,
        padding: 20,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }
      return h('div', { style: props.style ? { ...style, ...props.style } : style }, props.children)
    }

    function SectionTitle(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '22px 0 10px' } },
        h('div', { style: { fontSize: 13.5, fontWeight: 600, letterSpacing: 0 } }, props.title),
        props.extra || null,
      )
    }

    function SectionHead(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 } },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: -0.1 } }, props.title),
          props.hint
            ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.55 } }, props.hint)
            : null,
        ),
        props.extra || null,
      )
    }

    function Hairline() {
      return h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1)', opacity: 0.8 } })
    }

    function ChipGroup(props) {
      const lang = props.lang
      return h(
        'div',
        { style: { marginBottom: 16 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 } },
          h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, props.label),
          props.extra || null,
        ),
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          props.options.map(option => {
            const active = option.id === props.value
            return h(
              'button',
              {
                key: option.id,
                type: 'button',
                onClick: () => props.onChange(option.id),
                style: {
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 120ms ease, color 120ms ease',
                  border: active ? '1px solid transparent' : '1px solid var(--dsw-alias-border-l1)',
                  background: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
                  color: active ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                  boxShadow: active ? '0 1px 2px rgba(0, 0, 0, 0.12)' : 'none',
                },
              },
              optionLabel(option, lang),
            )
          }),
        ),
      )
    }

    function Segmented(props) {
      const lang = props.lang
      return h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 2,
            padding: 3,
            borderRadius: 11,
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '1px solid var(--dsw-alias-border-l1)',
          },
        },
        props.options.map(option => {
          const active = option.id === props.value
          return h(
            'button',
            {
              key: option.id,
              type: 'button',
              onClick: () => props.onChange(option.id),
              style: {
                flex: 1,
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'background 120ms ease, color 120ms ease',
                background: active ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                boxShadow: active ? '0 1px 2px rgba(0, 0, 0, 0.12)' : 'none',
              },
            },
            optionLabel(option, lang),
          )
        }),
      )
    }

    function Toggle(props) {
      const checked = props.checked === true
      const knobStyle = {
        position: 'absolute',
        top: 2,
        left: checked ? 20 : 2,
        width: 22,
        height: 22,
        borderRadius: 999,
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
        transition: 'left 160ms ease',
      }
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16, padding: props.style && props.style.padding !== undefined ? props.style.padding : '12px 0' } },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 13, fontWeight: 500 } }, props.label),
          props.hint
            ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.55 } }, props.hint)
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': props.label,
            onClick: () => props.onChange(!checked),
            style: {
              width: 44,
              height: 26,
              borderRadius: 999,
              border: 'none',
              padding: 0,
              flex: 'none',
              position: 'relative',
              cursor: 'pointer',
              background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
              transition: 'background 160ms ease',
            },
          },
          h('span', { style: knobStyle }),
        ),
      )
    }

    const INPUT_STYLE = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '9px 12px',
      borderRadius: 10,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 13,
      lineHeight: 1.5,
      fontFamily: 'inherit',
      outline: 'none',
    }

    const PRIMARY_BUTTON = {
      padding: '10px 18px',
      borderRadius: 12,
      border: '1px solid transparent',
      background: 'var(--dsw-alias-brand-primary)',
      color: '#ffffff',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    }

    function ghostButton(extra) {
      return {
        padding: '8px 14px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        cursor: 'pointer',
        ...(extra || {}),
      }
    }

    function textButton(extra) {
      return {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-brand-primary)',
        fontSize: 12.5,
        fontWeight: 500,
        cursor: 'pointer',
        padding: '4px 2px',
        ...(extra || {}),
      }
    }

    // Tinted action button (upload / extract / save-as ...): reads as a button
    // without competing with the single primary CTA.
    function tintButton(extra) {
      return {
        padding: '5px 12px',
        borderRadius: 999,
        border: '1px solid transparent',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)',
        color: 'var(--dsw-alias-brand-primary)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        ...(extra || {}),
      }
    }

    // Neutral filled button for secondary actions (manage / change / remove).
    function softButton(extra) {
      return {
        padding: '5px 12px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        ...(extra || {}),
      }
    }

    function Field(props) {
      return h(
        'div',
        { style: props.style || { marginBottom: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 } },
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, props.label),
          props.extra || null,
        ),
        props.children,
        props.hint ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, props.hint) : null,
      )
    }

    function Thumb(props) {
      return h(
        'button',
        {
          type: 'button',
          onClick: props.onOpen,
          title: props.name,
          style: {
            padding: 0,
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--dsw-alias-bg-layer-2)',
            cursor: 'zoom-in',
            display: 'block',
            aspectRatio: '1 / 1',
          },
        },
        h('img', {
          src: props.src,
          alt: props.name || '',
          loading: 'lazy',
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        }),
      )
    }

    // One inset row inside a reference card: thumbnail (or a quiet plus tile),
    // label/hint, then the action as a plain text button (Apple-style grouped
    // form row instead of a dashed drop zone).
    // ------------------------------------------------------------- icon
    function WorkbenchIcon(props) {
      const size = props.size || 18
      const active = props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.85 },
        },
        h('rect', { x: 3, y: 3, width: 7.5, height: 7.5, rx: 1.6 }),
        h('rect', { x: 13.5, y: 3, width: 7.5, height: 7.5, rx: 1.6 }),
        h('rect', { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 1.6 }),
        h('path', { d: 'M17.25 13.2l1.05 2.5 2.5 1.05-2.5 1.05-1.05 2.5-1.05-2.5-2.5-1.05 2.5-1.05z' }),
      )
    }

    // -------------------------------------------------------------- page
    function Page() {
      const lang = useLanguage()
      const t = useCallback(key => (STR[lang] && STR[lang][key]) || (STR.zh[key] || key), [lang])
      const [tab, setTab] = useState('home')
      const [posePage, setPosePage] = useState(false)
      const [templatePage, setTemplatePage] = useState(false)
      const [settings, setSettings] = useState(null)
      const [history, setHistory] = useState({ items: [], total: 0, outputDir: '' })
      const [results, setResults] = useState([])
      const [lastTiming, setLastTiming] = useState(null)
      const [notice, setNotice] = useState(null)
      const [jobs, setJobs] = useState([])
      const [, setQueueTick] = useState(0)
      const queueRef = useRef([])
      const activeJobsRef = useRef(0)
      const [form, setForm] = useState(loadForm)
      const [customPrompt, setCustomPrompt] = useState(null)
      const [accentId, setAccentId] = useState(() => {
        const saved = loadJson(LS_ACCENT, { id: 'default' })
        return saved.id || 'default'
      })
      const [preview, setPreview] = useState(null)
      const [now, setNow] = useState(() => new Date())
      const [testState, setTestState] = useState(null)
      const [saving, setSaving] = useState(false)
      const [draft, setDraft] = useState(null)
      const [productRefs, setProductRefs] = useState([])
      const [customPoses, setCustomPoses] = useState(() => {
        const value = loadJson(LS_POSES, [])
        return Array.isArray(value) ? value : []
      })
      const [fidelityText, setFidelityText] = useState(loadFidelityText)
      const [templates, setTemplates] = useState(() => {
        const value = loadJson(LS_TEMPLATES, [])
        return Array.isArray(value) ? value : []
      })
      const [reusablePrompts, setReusablePrompts] = useState(() => {
        const value = loadJson(LS_PROMPTS, [])
        return (Array.isArray(value) ? value : []).map(item => ({ ...item, kind: item.kind || 'style' }))
      })
      const [promptPage, setPromptPage] = useState(false)
      const [extracting, setExtracting] = useState(false)

      const persistPoses = useCallback(next => {
        setCustomPoses(next)
        saveJson(LS_POSES, next)
      }, [])

      const refreshHistory = useCallback(async () => {
        try {
          const json = await api('/history?limit=48')
          setHistory({ items: json.items || [], total: json.total || 0, outputDir: json.outputDir || '' })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }, [])

      const refreshSettings = useCallback(async () => {
        try {
          const json = await api('/settings')
          const value = json.settings || null
          setSettings(value)
          setDraft(prev => prev || settingsToDraft(value))
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }, [])

      useEffect(() => {
        refreshSettings()
        refreshHistory()
      }, [refreshSettings, refreshHistory])

      useEffect(() => {
        saveJson(LS_FORM, form)
      }, [form])

      useEffect(() => {
        const handle = window.setInterval(() => setNow(new Date()), 20000)
        return () => window.clearInterval(handle)
      }, [])

      useEffect(() => {
        if (tab === 'studio' || tab === 'home') refreshHistory()
      }, [tab, refreshHistory])

      // Restore persisted product reference photos (kept until the user removes them).
      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const json = await api('/ref/products')
            const items = Array.isArray(json.items) ? json.items : []
            if (items.length === 0 || cancelled) return
            const restored = []
            for (const item of items) {
              try {
                const response = await fetch(item.url, { cache: 'no-store' })
                if (!response.ok) continue
                const blob = await response.blob()
                const dataUrl = await readBlobAsDataUrl(blob)
                const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
                if (!match) continue
                restored.push({
                  dataBase64: match[2],
                  mediaType: item.mediaType || match[1],
                  name: item.name,
                  preview: dataUrl,
                })
              } catch {
                // skip an unreadable file; the rest still restore
              }
            }
            // Never overwrite photos the user added while restoring.
            if (!cancelled && restored.length > 0) {
              setProductRefs(prev => (prev.length > 0 ? prev : restored))
            }
          } catch {
            // no persisted products
          }
        })()
        return () => {
          cancelled = true
        }
      }, [])

      const prompt = useMemo(
        () => buildPrompt(form, false, productRefs.length > 0, false, customPoses, fidelityText),
        [form, productRefs, customPoses, fidelityText],
      )
      const promptValue = customPrompt === null ? prompt : customPrompt
      const referenceCount = productRefs.length

      const saveFidelityText = useCallback(text => {
        const value = String(text || '').trim()
        if (!value) return
        setFidelityText(value)
        saveJson(LS_FIDELITY, { text: value })
        setNotice({ kind: 'ok', text: t('saved') })
      }, [t])

      const resetFidelityText = useCallback(() => {
        setFidelityText(FIDELITY_MODULE)
        try {
          window.localStorage.removeItem(LS_FIDELITY)
        } catch {
          // storage unavailable; the in-memory default still applies
        }
        setNotice({ kind: 'ok', text: t('saved') })
      }, [t])

      const update = useCallback(patch => {
        setCustomPrompt(null)
        setForm(prev => ({ ...prev, ...patch }))
      }, [])

      // ------------------------------------------------------------ templates
      // A template snapshots the text/canvas settings (never the reference
      // images) so a full look can be re-applied with one click.
      const templateSnapshot = useCallback(source => ({
        ratio: source.ratio,
        resolution: source.resolution,
        show: source.show,
        pose: source.pose,
        desc: source.desc,
        modelPrompt: source.modelPrompt,
        backgroundPrompt: source.backgroundPrompt,
        extraPrompt: source.extraPrompt,
      }), [])

      const saveTemplate = useCallback(name => {
        const cleanName = String(name || '').trim() || `${t('templateDefaultName')} ${templates.length + 1}`
        const template = {
          id: `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          name: cleanName,
          form: templateSnapshot(form),
          createdAt: Date.now(),
        }
        const next = [template, ...templates]
        setTemplates(next)
        saveJson(LS_TEMPLATES, next)
        setNotice({ kind: 'ok', text: t('templateSaved') })
      }, [form, templates, templateSnapshot, t])

      const applyTemplate = useCallback(template => {
        if (!template || !template.form) return
        const next = { ...template.form }
        if (next.pose && !customPoses.some(item => item.id === next.pose)) next.pose = ''
        if (!RATIOS.some(item => item.id === next.ratio)) next.ratio = DEFAULT_FORM.ratio
        if (!RESOLUTIONS.some(item => item.id === next.resolution)) next.resolution = DEFAULT_FORM.resolution
        update(next)
        setTemplatePage(false)
        setPosePage(false)
        setNotice({ kind: 'ok', text: t('templateApplied') })
      }, [update, customPoses, t])

      const updateTemplate = useCallback((id, patch) => {
        const next = templates.map(template => (
          template.id === id ? { ...template, ...patch, updatedAt: Date.now() } : template
        ))
        setTemplates(next)
        saveJson(LS_TEMPLATES, next)
        setNotice({ kind: 'ok', text: t('templateUpdated') })
      }, [templates, t])

      const deleteTemplate = useCallback(id => {
        const next = templates.filter(template => template.id !== id)
        setTemplates(next)
        saveJson(LS_TEMPLATES, next)
      }, [templates])

      // ------------------------------------------------------ reusable prompts
      const persistReusablePrompts = useCallback(next => {
        setReusablePrompts(next)
        saveJson(LS_PROMPTS, next)
      }, [])

      const saveReusablePrompt = useCallback((kind, name, text) => {
        const cleanText = String(text || '').trim()
        if (!cleanText) return
        const cleanKind = ['style', 'model', 'scene'].indexOf(kind) >= 0 ? kind : 'style'
        const entry = {
          id: `pr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          kind: cleanKind,
          name: String(name || '').trim() || cleanText.slice(0, 16),
          text: cleanText,
        }
        persistReusablePrompts([...reusablePrompts, entry])
        setNotice({ kind: 'ok', text: t('promptSaved') })
      }, [reusablePrompts, persistReusablePrompts, t])

      const updateReusablePrompt = useCallback((id, patch) => {
        const next = reusablePrompts.map(item => (item.id === id ? { ...item, ...patch } : item))
        persistReusablePrompts(next)
        setNotice({ kind: 'ok', text: t('promptUpdated') })
      }, [reusablePrompts, persistReusablePrompts, t])

      const deleteReusablePrompt = useCallback(id => {
        persistReusablePrompts(reusablePrompts.filter(item => item.id !== id))
      }, [reusablePrompts, persistReusablePrompts])

      const loadReferenceFile = useCallback(async file => {
        if (!file) return null
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          throw new Error('请选择 PNG / JPG / WebP 图片')
        }
        if (file.size > 8 * 1024 * 1024) throw new Error('参考图需小于 8MB')
        const optimized = await optimizeReferenceImage(file).catch(() => null)
        const dataUrl = optimized ? optimized.dataUrl : await readBlobAsDataUrl(file)
        const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/i.exec(dataUrl)
        if (!match) throw new Error('不支持的图片格式')
        return {
          dataBase64: match[2],
          mediaType: optimized ? optimized.mediaType : match[1],
          name: file.name,
          preview: dataUrl,
        }
      }, [])

      const saveCustomPose = useCallback(pose => {
        const exists = customPoses.some(item => item.id === pose.id)
        const next = exists
          ? customPoses.map(item => (item.id === pose.id ? pose : item))
          : [...customPoses, pose]
        persistPoses(next)
        // A freshly created action becomes the current selection, so returning to
        // the studio shows it picked; editing the selected one keeps the selection.
        if (!exists) update({ pose: pose.id })
      }, [customPoses, persistPoses, update])

      const deleteCustomPose = useCallback(id => {
        persistPoses(customPoses.filter(item => item.id !== id))
        if (form.pose === id) update({ pose: '' })
      }, [customPoses, form.pose, persistPoses, update])

      const persistProductRefs = useCallback(async refs => {
        try {
          await api('/ref/products', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              references: refs.map(item => ({
                dataBase64: item.dataBase64,
                mediaType: item.mediaType,
                name: item.name,
              })),
            }),
          })
        } catch (error) {
          setNotice({ kind: 'error', text: `商品图本次可用，但未能持久保存：${error.message}` })
        }
      }, [])

      const handleProductFiles = useCallback(async files => {
        const list = Array.from(files || [])
        if (list.length === 0) return
        try {
          const loaded = []
          for (const file of list) {
            loaded.push(await loadReferenceFile(file))
          }
          const merged = [...productRefs, ...loaded]
          if (merged.length > 4) {
            setNotice({ kind: 'error', text: '商品参考图最多 4 张' })
          } else {
            setNotice(null)
          }
          const next = merged.slice(0, 4)
          setProductRefs(next)
          persistProductRefs(next)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        }
      }, [loadReferenceFile, productRefs, persistProductRefs])

      const handleRemoveProduct = useCallback(index => {
        const next = productRefs.filter((_, position) => position !== index)
        setProductRefs(next)
        persistProductRefs(next)
      }, [productRefs, persistProductRefs])

      // One-click product analysis: send the uploaded product photos to the
      // workbench Host, which asks the harness LLM for the structured key
      // elements (colour, fabric, cut, trims, ...) used by the description.
      const handleExtractDescription = useCallback(async () => {
        if (extracting) return
        if (productRefs.length === 0) {
          setNotice({ kind: 'error', text: t('extractNeedRef') })
          return
        }
        setExtracting(true)
        setNotice(null)
        try {
          const json = await api('/extract', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              references: productRefs.map(item => ({
                dataBase64: item.dataBase64,
                mediaType: item.mediaType,
                name: item.name,
              })),
            }),
          })
          const text = String(json.text || '').trim()
          if (!text) throw new Error(t('extractEmpty'))
          update({ desc: text })
          setNotice({ kind: 'ok', text: t('extractDone') })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        } finally {
          setExtracting(false)
        }
      }, [extracting, productRefs, update, t])

      const updateJob = (id, patch) => {
        setJobs(prev => prev.map(job => (job.id === id ? { ...job, ...patch } : job)))
      }

      async function runJob(job) {
        activeJobsRef.current += 1
        updateJob(job.id, { status: 'running', startedAt: Date.now() })
        try {
          const json = await api('/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(job.payload),
          })
          const created = (json.items || []).map(item => ({ ...item, prompt: job.payload.prompt }))
          if (created.length > 0) {
            setResults(prev => [...created, ...prev].slice(0, 24))
            // Fold new files into the gallery immediately so a job does not need
            // an extra round-trip / directory scan just to refresh history.
            setHistory(prev => {
              const known = new Set((prev.items || []).map(item => item.name))
              const fresh = created.filter(item => !known.has(item.name))
              return {
                ...prev,
                items: [...fresh, ...(prev.items || [])].slice(0, 48),
                total: (prev.total || 0) + fresh.length,
              }
            })
          }
          setLastTiming(json.timings || null)
          updateJob(job.id, {
            status: 'done',
            finishedAt: Date.now(),
            items: created,
            timings: json.timings || null,
            // The request payload holds base64 reference photos; drop it once the
            // job has finished so the job list does not pin image data in memory.
            payload: undefined,
          })
        } catch (error) {
          updateJob(job.id, {
            status: 'error',
            finishedAt: Date.now(),
            error: String(error && error.message ? error.message : error),
            payload: undefined,
          })
        } finally {
          activeJobsRef.current = Math.max(0, activeJobsRef.current - 1)
          startQueuedJobs()
        }
      }

      function startQueuedJobs() {
        while (activeJobsRef.current < MAX_CONCURRENT_JOBS && queueRef.current.length > 0) {
          runJob(queueRef.current.shift())
        }
      }

      function handleEnqueue() {
        const text = promptValue.trim()
        if (!text) {
          setNotice({ kind: 'error', text: t('needPrompt') })
          return
        }
        if (settings ? !settings.hasApiKey : true) {
          setNotice({ kind: 'error', text: t('needKey') })
          return
        }
        const pendingCount = jobs.filter(job => job.status === 'queued' || job.status === 'running').length
        if (pendingCount >= 12) {
          setNotice({ kind: 'error', text: t('queueFull') })
          return
        }
        const references = productRefs
          .filter(Boolean)
          .map(item => ({ dataBase64: item.dataBase64, mediaType: item.mediaType, name: item.name }))
        // Follow the separator style configured on this profile ("2048*2048" vs
        // "2048x2048"), since some OpenAI-compatible relays accept only one form.
        const separator = settings && typeof settings.size === 'string' && settings.size.indexOf('*') >= 0 ? '*' : 'x'
        const ratioOption = findOption(RATIOS, form.ratio)
        const resolutionOption = findOption(RESOLUTIONS, form.resolution)
        const sizeSource = (ratioOption.sizes && ratioOption.sizes[resolutionOption.id]) || ratioOption.sizes['2k'] || '2048x2048'
        const size = String(sizeSource).replace('x', separator)
        const job = {
          id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          status: 'queued',
          createdAt: Date.now(),
          prompt: text,
          ratioLabel: `${optionLabel(ratioOption, lang)} · ${optionLabel(resolutionOption, lang)}`,
          referenceCount: references.length,
          payload: {
            prompt: text,
            size,
            references,
            profileId: settings ? settings.activeId : undefined,
            model: settings && settings.model ? settings.model : undefined,
          },
        }
        setJobs(prev => [job, ...prev].slice(0, 24))
        queueRef.current.push(job)
        setNotice({ kind: 'ok', text: t('queueAdded') })
        startQueuedJobs()
      }

      const handleClearFinishedJobs = useCallback(() => {
        setJobs(prev => prev.filter(job => job.status === 'running' || job.status === 'queued'))
      }, [])

      const activeJobCount = jobs.reduce(
        (count, job) => count + (job.status === 'running' || job.status === 'queued' ? 1 : 0),
        0,
      )

      useEffect(() => {
        if (activeJobCount === 0) return undefined
        const handle = window.setInterval(() => setQueueTick(value => value + 1), 1000)
        return () => window.clearInterval(handle)
      }, [activeJobCount])

      const handleCopy = useCallback(async () => {
        const text = promptValue
        try {
          await navigator.clipboard.writeText(text)
          setNotice({ kind: 'ok', text: t('copied') })
        } catch {
          const area = document.createElement('textarea')
          area.value = text
          document.body.appendChild(area)
          area.select()
          try {
            document.execCommand('copy')
            setNotice({ kind: 'ok', text: t('copied') })
          } catch {
            setNotice({ kind: 'error', text: 'copy failed' })
          }
          document.body.removeChild(area)
        }
      }, [promptValue, t])

      const handleAccent = useCallback(id => {
        setAccentId(id)
        saveJson(LS_ACCENT, { id })
        if (appCtx) applyAccent(appCtx, id)
      }, [])

      const handleSaveSettings = useCallback(async payload => {
        if (!draft || saving) return
        setSaving(true)
        setNotice(null)
        try {
          const body = payload || {
            activeId: draft.activeId,
            outputDir: draft.outputDir,
            profiles: draft.profiles.map(profile => ({
              id: profile.id,
              name: profile.name,
              baseUrl: profile.baseUrl,
              model: profile.model,
              size: profile.size,
              quality: profile.quality,
              apiKey: profile.apiKey || undefined,
              clearApiKey: profile.clearKey === true,
            })),
          }
          const json = await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          setSettings(json.settings || null)
          setDraft(settingsToDraft(json.settings))
          setNotice({ kind: 'ok', text: t('saved') })
          refreshHistory()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setSaving(false)
        }
      }, [draft, saving, refreshHistory, t])

      const handleActivateProfile = useCallback(async id => {
        if (!id) return
        setDraft(prev => (prev ? { ...prev, activeId: id } : prev))
        // A probe result belongs to the previously selected endpoint.
        setTestState(null)
        try {
          const json = await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ activeId: id }),
          })
          setSettings(json.settings || null)
          const name = json.settings && json.settings.name ? json.settings.name : ''
          setNotice({ kind: 'ok', text: name ? `${t('activeNow')}：${name}` : t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }, [t])

      const handleTest = useCallback(async override => {
        setTestState({ state: 'testing' })
        try {
          const json = await api('/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(override || {}),
          })
          setTestState({ state: json.ok ? 'ok' : 'fail', message: json.message || json.error || '' })
        } catch (error) {
          setTestState({ state: 'fail', message: error.message })
        }
      }, [])

      const openPanel = useCallback(key => {
        try {
          if (key === 'conversation') appCtx.layout.selectPanel(null)
          else appCtx.layout.selectPanel(key)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        }
      }, [])

      const startSession = useCallback(() => {
        try {
          appCtx.uiWorkspace.startSession()
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        }
      }, [])

      const handleReveal = useCallback(async () => {
        try {
          const json = await api('/reveal', { method: 'POST' })
          if (!json.ok) setNotice({ kind: 'error', text: '无法打开目录' })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }, [])

      const tabButton = (id, label) => {
        const active = tab === id
        return h(
          'button',
          {
            key: id,
            type: 'button',
            onClick: () => {
              setPosePage(false)
              setTemplatePage(false)
              setPromptPage(false)
              setTab(id)
            },
            style: {
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              background: active ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
              color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            },
          },
          label,
        )
      }

      const header = h(
        'div',
        { style: { padding: '18px 28px 0', flex: 'none' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 21, fontWeight: 700, letterSpacing: -0.2 } }, t('title')),
            h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 } }, t('subtitle')),
          ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 2,
                padding: 3,
                borderRadius: 10,
                background: 'var(--dsw-alias-bg-layer-2)',
                border: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            tabButton('home', t('tabHome')),
            tabButton('studio', t('tabStudio')),
            tabButton('size', t('tabSize')),
            tabButton('settings', t('tabSettings')),
          ),
        ),
        h('div', { style: { height: 14 } }),
      )

      let body = null
      if (tab === 'home') {
        body = h(HomeTab, {
          lang, t, now, settings, history, results,
          onStartSession: startSession,
          onOpenPanel: openPanel,
          onOpenStudio: () => setTab('studio'),
          onOpenSize: () => setTab('size'),
          onReveal: handleReveal,
          onPreview: setPreview,
          onRefresh: refreshHistory,
        })
      } else if (tab === 'studio') {
        if (posePage) {
          body = h(PoseLibrary, {
            t,
            customPoses,
            onSavePose: saveCustomPose,
            onDeletePose: deleteCustomPose,
            onBack: () => setPosePage(false),
            selectedPose: form.pose,
          })
        } else if (templatePage) {
          body = h(TemplateLibrary, {
            lang, t,
            templates,
            onBack: () => setTemplatePage(false),
            onApply: applyTemplate,
            onUpdate: updateTemplate,
            onDelete: deleteTemplate,
          })
        } else if (promptPage) {
          body = h(PromptLibrary, {
            lang, t,
            prompts: reusablePrompts,
            onBack: () => setPromptPage(false),
            onSave: saveReusablePrompt,
            onUpdate: updateReusablePrompt,
            onDelete: deleteReusablePrompt,
          })
        } else {
          body = h(StudioTab, {
            lang, t, form, update, promptValue, setCustomPrompt,
            onCopy: handleCopy,
            onGenerate: handleEnqueue,
            results, history, lastTiming,
            jobs, onClearFinishedJobs: handleClearFinishedJobs,
            onPreview: setPreview,
            onOpenStudioHistory: refreshHistory,
            needKey: settings ? !settings.hasApiKey : true,
            onOpenSettings: () => setTab('settings'),
            productRefs,
            onProductFiles: handleProductFiles,
            onRemoveProduct: handleRemoveProduct,
            customPoses,
            onOpenPoseLibrary: () => setPosePage(true),
            extracting,
            onExtractDescription: handleExtractDescription,
            templates,
            onSaveTemplate: saveTemplate,
            onApplyTemplate: applyTemplate,
            onOpenTemplateLibrary: () => setTemplatePage(true),
            prompts: reusablePrompts,
            onSavePrompt: saveReusablePrompt,
            onOpenPromptLibrary: () => setPromptPage(true),
            referenceCount,
            activeName: settings && settings.name ? settings.name : '',
            activeModel: settings && settings.model ? settings.model : '',
          })
        }
      } else if (tab === 'size') {
        body = h(SizeChartTab, { lang, t })
      } else {
        body = h(SettingsTab, {
          lang, t, settings, draft, setDraft, saving,
          onSave: handleSaveSettings, onActivate: handleActivateProfile,
          onTest: handleTest, testState,
          accentId, onAccent: handleAccent,
          fidelityText,
          fidelityDefault: FIDELITY_MODULE,
          onSaveFidelity: saveFidelityText,
          onResetFidelity: resetFidelityText,
          onReveal: handleReveal,
        })
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: '100%',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          },
        },
        header,
        notice
          ? h(
              'div',
              { style: { padding: '0 28px 8px', flex: 'none' } },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 10,
                    fontSize: 12.5,
                    border: '1px solid var(--dsw-alias-border-l1)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: notice.kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
                  },
                },
                h('span', null, notice.text),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setNotice(null),
                    style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
                  },
                  t('close'),
                ),
              ),
            )
          : null,
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 28px 40px' } }, body),
        preview
          ? h(
              'div',
              {
                onClick: () => setPreview(null),
                style: {
                  position: 'fixed', inset: 0, zIndex: 60,
                  background: 'rgba(0,0,0,0.74)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'zoom-out',
                },
              },
              h('img', { src: preview, alt: '', style: { maxWidth: '90vw', maxHeight: '86vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } }),
            )
          : null,
      )
    }

    // -------------------------------------------------------------- home tab
    function HomeIcon(props) {
      const size = props.size || 20
      const common = {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      }
      if (props.name === 'studio') {
        return h('svg', common,
          h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3 }),
          h('circle', { cx: 8.5, cy: 9.5, r: 1.4 }),
          h('path', { d: 'M4.5 16.5l4.6-4.2 3.3 3 2.4-2.2 4.7 4.1' }))
      }
      if (props.name === 'size') {
        return h('svg', common,
          h('path', { d: 'M4 8.5h16M4 15.5h16' }),
          h('path', { d: 'M7.5 6.5v4M12 6.5v4M16.5 6.5v4' }),
          h('path', { d: 'M7.5 13.5v4M12 13.5v4M16.5 13.5v4' }))
      }
      if (props.name === 'plugins') {
        return h('svg', common,
          h('rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 2 }),
          h('rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 2 }),
          h('rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 2 }),
          h('path', { d: 'M17 13.5v7M13.5 17h7' }))
      }
      if (props.name === 'schedules') {
        return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8.2 }), h('path', { d: 'M12 7.6V12l3 2' }))
      }
      return h('svg', common, h('path', { d: 'M4.5 6.5A3 3 0 017.5 3.5h9a3 3 0 013 3v7a3 3 0 01-3 3H10l-4.5 3v-3a3 3 0 01-1-2.2z' }))
    }

    function HomeTab(props) {
      const { lang, t, settings, history, onPreview } = props
      const date = props.now || new Date()
      const items = history.items || []
      const recent = items.slice(0, 8)
      const total = typeof history.total === 'number' ? history.total : items.length
      const outDir = settings && settings.outputDir ? settings.outputDir : ''
      const shortDir = outDir ? outDir.replace(/^.*[\\/]/, '') : t('unknown')

      const statCard = (label, value, sub) =>
        h(
          Card,
          { style: { flex: '1 1 210px', minWidth: 180, padding: 18 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, label),
          h('div', { style: { fontSize: 22, fontWeight: 680, letterSpacing: -0.2, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value),
          sub
            ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, sub)
            : null,
        )

      const quick = (icon, label, hint, onClick) =>
        h(
          'button',
          {
            key: label,
            type: 'button',
            onClick,
            style: {
              flex: '1 1 190px',
              minWidth: 170,
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              borderRadius: 14,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
            },
          },
          h(
            'div',
            {
              style: {
                width: 40, height: 40, borderRadius: 12, flex: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent)',
                color: 'var(--dsw-alias-brand-primary)',
              },
            },
            h(HomeIcon, { name: icon, size: 20 }),
          ),
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.5 } }, hint),
          ),
        )

      const emptyRecent = h(
        Card,
        { style: { padding: '30px 20px', textAlign: 'center' } },
        h('div', { style: { display: 'flex', justifyContent: 'center', color: 'var(--dsw-alias-label-secondary)', opacity: 0.8 } }, h(HomeIcon, { name: 'studio', size: 30 })),
        h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 10 } }, t('recentEmpty')),
        h('button', { type: 'button', onClick: props.onOpenStudio, style: { ...PRIMARY_BUTTON, marginTop: 14, padding: '8px 16px', fontSize: 12.5 } }, t('enterStudio')),
      )

      return h(
        'div',
        { style: { maxWidth: 1180, margin: '0 auto' } },
        h(
          Card,
          {
            style: {
              marginTop: 8,
              padding: '24px 26px',
              borderRadius: 20,
              border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, var(--dsw-alias-border-l1))',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1)) 0%, var(--dsw-alias-bg-layer-1) 62%)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { minWidth: 260, flex: 1 } },
              h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, formatDate(date, lang)),
              h('div', { style: { fontSize: 27, fontWeight: 700, letterSpacing: -0.4, margin: '10px 0 4px' } }, `${t(greetingKey(date))}${t('welcome')}`),
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginBottom: 18, lineHeight: 1.6 } }, t('homeLead')),
              h(
                'div',
                { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                h('button', { type: 'button', onClick: props.onStartSession, style: { ...PRIMARY_BUTTON, padding: '10px 18px', fontSize: 13.5 } }, `＋ ${t('newSession')}`),
                h('button', { type: 'button', onClick: props.onOpenStudio, style: softButton({ padding: '10px 18px', fontSize: 13.5 }) }, t('enterStudio')),
              ),
            ),
            h('div', { style: { textAlign: 'right', flex: 'none' } },
              h('div', { style: { fontSize: 36, fontWeight: 300, letterSpacing: 1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 } }, formatTime(date))),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' } },
          statCard(t('statTotal'), String(total), t('statTotalSub')),
          statCard(t('statModel'), settings && settings.model ? settings.model : t('unknown'), settings && settings.name ? settings.name : ''),
          statCard(t('statOutput'), shortDir, outDir),
        ),
        h(SectionTitle, {
          title: t('recentTitle'),
          extra: h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', onClick: props.onRefresh, style: softButton() }, t('refresh')),
            h('button', { type: 'button', onClick: props.onReveal, style: softButton() }, t('saveDir')),
          ),
        }),
        recent.length === 0
          ? emptyRecent
          : h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 10 } },
              recent.map(item => h(Thumb, { key: item.name, src: item.url, name: item.name, onOpen: () => onPreview(item.url) })),
            ),
        h(SectionTitle, { title: t('shortcuts') }),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 } },
          quick('studio', t('tabStudio'), t('quickStudioHint'), () => props.onOpenStudio()),
          quick('size', t('tabSize'), t('quickSizeHint'), () => props.onOpenSize()),
          quick('chat', t('openConversation'), t('quickConversationHint'), () => props.onOpenPanel('conversation')),
          quick('plugins', t('plugins'), t('quickPluginsHint'), () => props.onOpenPanel('plugins')),
          quick('schedules', t('schedules'), t('quickSchedulesHint'), () => props.onOpenPanel('schedules')),
        ),
      )
    }


    // ------------------------------------------------------------ size chart
    // Upload an existing size chart, let the harness vision model read it, then
    // render a branded size-spec poster (with suggested height/weight) that can
    // be downloaded as a PNG. The logo is persisted on the host.
    function SizeChartTab(props) {
      const { lang, t } = props
      const [chart, setChart] = useState(() => {
        const saved = loadJson(LS_SIZEPOSTER, null)
        if (saved && Array.isArray(saved.columns) && saved.columns.length && Array.isArray(saved.rows) && saved.rows.length) {
          return { columns: saved.columns, rows: saved.rows }
        }
        return {
          columns: DEFAULT_SIZE_CHART.columns.map(column => ({ ...column })),
          rows: DEFAULT_SIZE_CHART.rows.map(row => ({ ...row, values: { ...row.values } })),
        }
      })
      const [weightUnit, setWeightUnit] = useState(() => {
        const saved = loadJson(LS_SIZEPOSTER, null)
        return saved && saved.weightUnit === 'jin' ? 'jin' : 'kg'
      })
      const [chartImage, setChartImage] = useState(null)
      const [extracting, setExtracting] = useState(false)
      const [logo, setLogo] = useState(null)
      const [logoImage, setLogoImage] = useState(null)
      const [notice, setNotice] = useState(null)
      const canvasRef = useRef(null)

      const weightUnitLabel = weightUnit === 'jin' ? '斤' : 'kg'
      const convertWeight = kg => (weightUnit === 'jin' ? kg * 2 : kg)
      const sizeRank = label => {
        const normalized = String(label || '').trim().toUpperCase()
        if (normalized === 'XS') return -1
        if (normalized === 'S') return 0
        if (normalized === 'M') return 1
        if (normalized === 'L') return 2
        if (normalized === 'XL') return 3
        if (normalized === 'XXL') return 4
        if (normalized === 'XXXL') return 5
        const numeric = normalized.match(/^(\d+)XL$/)
        if (numeric) return Number(numeric[1]) + 2
        return null
      }
      const waistColumn = chart.columns.find(column => /腰围|waist/i.test(column.name))
      const suggestions = chart.rows.map((row, index) => {
        const rank = sizeRank(row.size)
        const heightMid = 165 + 5 * (rank === null ? index : rank)
        const waist = waistColumn && row.values ? Number(row.values[waistColumn.key]) : NaN
        const weight = weightRangeForWaist(waist)
        return {
          heightLow: heightMid - 5,
          heightHigh: heightMid + 5,
          heightMid,
          waist: Number.isFinite(waist) ? waist : null,
          weightLow: weight ? weight.low : null,
          weightHigh: weight ? weight.high : null,
        }
      })

      useEffect(() => {
        saveJson(LS_SIZEPOSTER, { columns: chart.columns, rows: chart.rows, weightUnit })
      }, [chart, weightUnit])

      // Restore the persisted brand logo (kept until the user replaces it).
      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const json = await api('/ref/logo')
            if (!json.item || cancelled) return
            const response = await fetch(json.item.url, { cache: 'no-store' })
            if (!response.ok) return
            const blob = await response.blob()
            const dataUrl = await readBlobAsDataUrl(blob)
            if (!cancelled) setLogo({ dataUrl, name: json.item.name })
          } catch {
            // no persisted logo yet
          }
        })()
        return () => {
          cancelled = true
        }
      }, [])

      useEffect(() => {
        if (!logo || !logo.dataUrl) {
          setLogoImage(null)
          return undefined
        }
        let cancelled = false
        const image = new Image()
        image.onload = () => {
          if (!cancelled) setLogoImage(image)
        }
        image.onerror = () => {
          if (!cancelled) setLogoImage(null)
        }
        image.src = logo.dataUrl
        return () => {
          cancelled = true
        }
      }, [logo])

      function drawPoster() {
        const canvas = canvasRef.current
        if (!canvas || typeof canvas.getContext !== 'function') return
        const width = 1800
        const marginX = 140
        const topPad = 70
        const logoBoxHeight = 380
        const headerHeight = 120
        const rowHeight = 112
        const footerLineHeight = 46
        const footerLines = 5
        const height = topPad + logoBoxHeight + 50 + headerHeight + chart.rows.length * rowHeight + 70 + footerLines * footerLineHeight + 70
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return
        context.fillStyle = '#f7f8f8'
        context.fillRect(0, 0, width, height)

        if (logoImage) {
          const maxWidth = width * 0.62
          const maxHeight = logoBoxHeight - 70
          const ratio = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height)
          const logoWidth = logoImage.width * ratio
          const logoHeight = logoImage.height * ratio
          context.drawImage(logoImage, (width - logoWidth) / 2, topPad + (maxHeight - logoHeight) / 2, logoWidth, logoHeight)
        } else {
          context.fillStyle = '#161616'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.font = '700 84px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText('SIZE SPEC', width / 2, topPad + 110)
          context.font = '600 64px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText('尺码表', width / 2, topPad + 210)
        }

        const tableTop = topPad + logoBoxHeight + 50
        const tableWidth = width - marginX * 2
        const fixedColumns = [
          { width: 200, zh: '尺码', en: 'SIZE' },
          { width: 280, zh: '建议身高', en: 'HEIGHT (cm)' },
          { width: 280, zh: '建议体重', en: `WEIGHT (${weightUnitLabel})` },
        ]
        const measureCount = chart.columns.length
        const fixedWidth = fixedColumns.reduce((sum, column) => sum + column.width, 0)
        const measureWidth = measureCount > 0 ? (tableWidth - fixedWidth) / measureCount : 0
        const columns = [
          ...fixedColumns,
          ...chart.columns.map(column => ({
            width: measureWidth,
            zh: column.name,
            en: `${SIZE_COLUMN_EN[column.name] || column.name.toUpperCase()} (cm)`,
          })),
        ]

        context.strokeStyle = '#161616'
        context.lineWidth = 5
        context.beginPath()
        context.moveTo(marginX, tableTop)
        context.lineTo(marginX + tableWidth, tableTop)
        context.stroke()
        context.lineWidth = 4
        context.beginPath()
        context.moveTo(marginX, tableTop + headerHeight)
        context.lineTo(marginX + tableWidth, tableTop + headerHeight)
        context.stroke()

        let cellX = marginX
        for (const column of columns) {
          const centerX = cellX + column.width / 2
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillStyle = '#161616'
          context.font = '700 34px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText(column.zh, centerX, tableTop + 44, column.width - 14)
          context.fillStyle = '#6b6f73'
          context.font = '600 20px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText(column.en, centerX, tableTop + 84, column.width - 14)
          cellX += column.width
        }

        let rowY = tableTop + headerHeight
        chart.rows.forEach((row, index) => {
          if (index % 2 === 1) {
            context.fillStyle = '#edf1f2'
            context.fillRect(marginX, rowY, tableWidth, rowHeight)
          }
          const suggestion = suggestions[index] || {}
          let x = marginX
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillStyle = '#161616'
          context.font = '700 46px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText(row.size || '', x + columns[0].width / 2, rowY + rowHeight / 2 - (suggestion.waist ? 16 : 0))
          if (suggestion.waist) {
            context.fillStyle = '#8a8f94'
            context.font = '500 24px "Microsoft YaHei","PingFang SC",sans-serif'
            context.fillText(
              `${Math.round(suggestion.heightMid)}/${Math.round(suggestion.waist)}A`,
              x + columns[0].width / 2,
              rowY + rowHeight / 2 + 26,
            )
          }
          x += columns[0].width

          context.fillStyle = '#161616'
          context.font = '600 42px "Microsoft YaHei","PingFang SC",sans-serif'
          context.fillText(
            suggestion.heightLow && suggestion.heightHigh ? `${suggestion.heightLow}-${suggestion.heightHigh}` : '—',
            x + columns[1].width / 2,
            rowY + rowHeight / 2,
          )
          x += columns[1].width

          const weightLow = suggestion.weightLow !== null ? convertWeight(suggestion.weightLow) : null
          const weightHigh = suggestion.weightHigh !== null ? convertWeight(suggestion.weightHigh) : null
          context.fillText(
            weightLow !== null ? `${Math.round(weightLow)}-${Math.round(weightHigh)}` : '—',
            x + columns[2].width / 2,
            rowY + rowHeight / 2,
          )
          x += columns[2].width

          for (let i = 0; i < chart.columns.length; i += 1) {
            const column = chart.columns[i]
            const raw = row.values ? row.values[column.key] : null
            const value = Number.isFinite(Number(raw)) ? Math.round(Number(raw) * 10) / 10 : null
            context.fillStyle = '#161616'
            context.font = '500 42px "Microsoft YaHei","PingFang SC",sans-serif'
            context.fillText(value === null ? '—' : String(value), x + columns[3 + i].width / 2, rowY + rowHeight / 2)
            x += columns[3 + i].width
          }
          rowY += rowHeight
        })

        context.strokeStyle = '#161616'
        context.lineWidth = 4
        context.beginPath()
        context.moveTo(marginX, rowY)
        context.lineTo(marginX + tableWidth, rowY)
        context.stroke()

        const sample = suggestions.find(item => item && item.waist) || null
        const sampleLabel = sample ? `${Math.round(sample.heightMid)}/${Math.round(sample.waist)}A` : ''
        const notes = [
          `* 推荐身高 / 体重由原尺码表的${chart.columns.map(column => column.name).slice(0, 3).join('、')}推算，仅供参考`,
          sampleLabel
            ? `* 尺码下方的 ${sampleLabel} 为参考国标号型（身高 / 腰围），可直接对照日常穿着尺码`
            : '* 尺码下方的数字为参考号型（身高 / 腰围），可直接对照日常穿着尺码',
          '* 身高与体重同时落在推荐区间时最准确；仅命中其中一项时，以体重（腰围）为准',
          '* 介于两档尺码之间、或腰臀围偏大者，建议选大一码',
          '* 原尺寸为手工测量，存在 1~3CM 误差属正常',
        ]
        let noteY = rowY + 70
        context.textAlign = 'left'
        context.textBaseline = 'middle'
        context.fillStyle = '#7b8085'
        context.font = '400 25px "Microsoft YaHei","PingFang SC",sans-serif'
        for (const note of notes) {
          context.fillText(note, marginX, noteY)
          noteY += footerLineHeight
        }
      }

      useEffect(() => {
        drawPoster()
      }, [chart, logoImage, weightUnit])

      const handleChartImage = async file => {
        if (!file) return
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          setNotice({ kind: 'error', text: '请选择 PNG / JPG / WebP 图片' })
          return
        }
        if (file.size > 8 * 1024 * 1024) {
          setNotice({ kind: 'error', text: '尺码表图片需小于 8MB' })
          return
        }
        try {
          const dataUrl = await readBlobAsDataUrl(file)
          setChartImage({ dataUrl, name: file.name })
          setNotice(null)
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        }
      }

      const extractChart = async () => {
        if (extracting) return
        if (!chartImage) {
          setNotice({ kind: 'error', text: t('sizeExtractNeed') })
          return
        }
        setExtracting(true)
        setNotice(null)
        try {
          const match = /^data:([^;]+);base64,(.*)$/.exec(chartImage.dataUrl)
          if (!match) throw new Error('图片格式无法识别')
          const json = await api('/extract-size', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              references: [{ dataBase64: match[2], mediaType: match[1], name: chartImage.name }],
            }),
          })
          if (!json.columns || !json.rows || json.columns.length === 0 || json.rows.length === 0) {
            throw new Error('未能识别出尺码表，请换一张更清晰的截图')
          }
          const columns = json.columns.map((column, index) => ({
            key: column.key || `c${index}`,
            name: column.name,
          }))
          const rows = json.rows.map((row, index) => ({
            id: `row-${Date.now().toString(36)}-${index}`,
            size: row.size,
            values: Object.fromEntries(columns.map(column => [
              column.key,
              row.values && row.values[column.key] !== undefined ? row.values[column.key] : null,
            ])),
          }))
          setChart({ columns, rows })
          setNotice({ kind: 'ok', text: `${t('sizeExtractDone')} · ${rows.length} ${t('sizeSizeHeader')}` })
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        } finally {
          setExtracting(false)
        }
      }

      const handleLogoFile = async file => {
        if (!file) return
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          setNotice({ kind: 'error', text: '请选择 PNG / JPG / WebP 图片' })
          return
        }
        if (file.size > 5 * 1024 * 1024) {
          setNotice({ kind: 'error', text: 'Logo 需小于 5MB' })
          return
        }
        try {
          const dataUrl = await readBlobAsDataUrl(file)
          const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
          if (!match) throw new Error('不支持的图片格式')
          setLogo({ dataUrl, name: file.name })
          try {
            await api('/ref/logo', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataBase64: match[2], mediaType: match[1], name: file.name }),
            })
          } catch (error) {
            setNotice({ kind: 'error', text: `Logo 本次可用，但未能持久保存：${error.message}` })
          }
        } catch (error) {
          setNotice({ kind: 'error', text: String(error && error.message ? error.message : error) })
        }
      }

      const clearLogo = async () => {
        setLogo(null)
        try {
          await api('/ref/logo', { method: 'DELETE' })
        } catch {
          // clearing the in-memory logo is enough for this session
        }
      }

      const updateSizeLabel = (id, label) => {
        setChart(prev => ({ ...prev, rows: prev.rows.map(row => (row.id === id ? { ...row, size: label } : row)) }))
      }
      const updateCell = (id, key, text) => {
        const normalized = String(text).replace(',', '.').trim()
        const value = normalized === '' ? null : Number(normalized)
        setChart(prev => ({
          ...prev,
          rows: prev.rows.map(row => (
            row.id === id ? { ...row, values: { ...(row.values || {}), [key]: Number.isFinite(value) ? value : null } } : row
          )),
        }))
      }
      const addRow = () => {
        setChart(prev => ({
          ...prev,
          rows: [...prev.rows, { id: `row-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`, size: t('sizeNewLabel'), values: {} }],
        }))
      }
      const removeRow = id => {
        setChart(prev => (prev.rows.length <= 1 ? prev : { ...prev, rows: prev.rows.filter(row => row.id !== id) }))
      }
      const resetSample = () => {
        setChart({
          columns: DEFAULT_SIZE_CHART.columns.map(column => ({ ...column })),
          rows: DEFAULT_SIZE_CHART.rows.map(row => ({ ...row, values: { ...row.values } })),
        })
        setNotice({ kind: 'ok', text: t('sizeGenerated') })
      }

      const downloadPoster = () => {
        const canvas = canvasRef.current
        if (!canvas || typeof canvas.toBlob !== 'function') return
        canvas.toBlob(blob => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `size-chart-${new Date().toISOString().slice(0, 10)}.png`
          link.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 2000)
          setNotice({ kind: 'ok', text: t('sizeDownloaded') })
        }, 'image/png')
      }

      const labelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 }
      const thStyle = {
        textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)',
      }
      const tdStyle = { padding: '5px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)' }

      const uploadCard = h(
        Card,
        null,
        h(SectionHead, { title: t('sizeUploadTitle'), hint: t('sizeUploadHint') }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' } },
          chartImage
            ? h('img', {
                src: chartImage.dataUrl,
                alt: '',
                style: { width: 140, height: 96, objectFit: 'contain', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)' },
              })
            : h('div', {
                style: {
                  width: 140, height: 96, borderRadius: 10, flex: 'none',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  border: '1px dashed var(--dsw-alias-border-l2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 30, fontWeight: 300, color: 'var(--dsw-alias-label-secondary)',
                },
              }, '＋'),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
              chartImage ? chartImage.name : t('sizeUploadNote')),
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 } },
              h(
                'label',
                { style: { display: 'inline-flex', cursor: 'pointer' } },
                h('span', { style: tintButton() }, chartImage ? t('sizeUploadReplace') : t('sizeUploadPick')),
                h('input', {
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp',
                  style: { display: 'none' },
                  onChange: event => {
                    const file = event.target.files && event.target.files[0]
                    if (file) handleChartImage(file)
                    event.target.value = ''
                  },
                }),
              ),
              h(
                'button',
                { type: 'button', onClick: extractChart, disabled: extracting, style: { ...PRIMARY_BUTTON, padding: '6px 14px', fontSize: 12.5, opacity: extracting ? 0.7 : 1, cursor: extracting ? 'progress' : 'pointer' } },
                extracting ? t('sizeExtracting') : `✦ ${t('sizeExtract')}`,
              ),
            ),
          ),
        ),
      )

      const dataCard = h(
        Card,
        null,
        h(SectionHead, {
          title: t('sizeDataTitle'),
          hint: t('sizeDataHint'),
          extra: h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', onClick: resetSample, style: softButton() }, t('sizeSample')),
            h('button', { type: 'button', onClick: addRow, style: tintButton() }, t('sizeAddRow')),
          ),
        }),
        h(
          'div',
          { style: { overflowX: 'auto' } },
          h(
            'table',
            { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 } },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { style: thStyle }, t('sizeSizeHeader')),
                chart.columns.map(column => h('th', { key: column.key, style: thStyle }, `${column.name}（cm）`)),
                h('th', { style: thStyle }, ''),
              ),
            ),
            h(
              'tbody',
              null,
              chart.rows.map(row =>
                h(
                  'tr',
                  { key: row.id },
                  h('td', { style: tdStyle }, h('input', {
                    value: row.size || '',
                    onChange: event => updateSizeLabel(row.id, event.target.value),
                    style: { ...INPUT_STYLE, padding: '6px 8px', fontSize: 12, width: 92 },
                  })),
                  chart.columns.map(column =>
                    h('td', { key: column.key, style: tdStyle }, h('input', {
                      value: row.values && row.values[column.key] !== null && row.values[column.key] !== undefined ? String(row.values[column.key]) : '',
                      onChange: event => updateCell(row.id, column.key, event.target.value),
                      style: { ...INPUT_STYLE, padding: '6px 8px', fontSize: 12, textAlign: 'center', width: 92 },
                    })),
                  ),
                  h('td', { style: tdStyle }, h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => removeRow(row.id),
                      disabled: chart.rows.length <= 1,
                      style: softButton({ padding: '3px 9px', fontSize: 11, opacity: chart.rows.length <= 1 ? 0.5 : 1 }),
                    },
                    t('sizeRemoveRow'),
                  )),
                ),
              ),
            ),
          ),
        ),
      )

      const logoCard = h(
        Card,
        null,
        h(SectionHead, { title: t('sizeLogoTitle'), hint: t('sizeLogoHint') }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
          logo
            ? h('img', {
                src: logo.dataUrl,
                alt: '',
                style: { maxWidth: 180, maxHeight: 110, objectFit: 'contain', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: 8 },
              })
            : h('div', {
                style: {
                  width: 140, height: 84, borderRadius: 10,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  border: '1px dashed var(--dsw-alias-border-l2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, fontWeight: 300, color: 'var(--dsw-alias-label-secondary)',
                },
              }, 'LOGO'),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(
              'label',
              { style: { display: 'inline-flex', cursor: 'pointer' } },
              h('span', { style: tintButton() }, logo ? t('sizeLogoReplace') : t('sizeLogoPick')),
              h('input', {
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp',
                style: { display: 'none' },
                onChange: event => {
                  const file = event.target.files && event.target.files[0]
                  if (file) handleLogoFile(file)
                  event.target.value = ''
                },
              }),
            ),
            logo ? h('button', { type: 'button', onClick: clearLogo, style: softButton({ color: 'var(--dsw-alias-state-error-primary)' }) }, t('remove')) : null,
          ),
        ),
      )

      const settingsCard = h(
        Card,
        null,
        h(SectionHead, { title: t('sizeWeightUnit'), hint: t('sizeWeightHint') }),
        h(Segmented, {
          options: [{ id: 'kg', zh: '公斤 kg', en: 'kg' }, { id: 'jin', zh: '斤', en: 'jin' }],
          value: weightUnit,
          lang,
          onChange: setWeightUnit,
        }),
        h(
          'button',
          {
            type: 'button',
            onClick: downloadPoster,
            style: { ...PRIMARY_BUTTON, width: '100%', marginTop: 14, padding: '10px 18px', fontSize: 14 },
          },
          `⬇ ${t('sizeDownload')}`,
        ),
      )

      const previewCard = h(
        Card,
        null,
        h(SectionHead, { title: t('sizePreviewTitle'), hint: t('sizePreviewHint') }),
        h(
          'div',
          { style: { background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 12, padding: 10, border: '1px solid var(--dsw-alias-border-l1)' } },
          h('canvas', {
            ref: canvasRef,
            style: { width: '100%', height: 'auto', display: 'block', borderRadius: 8, background: '#f7f8f8' },
          }),
        ),
      )

      const notesCard = h(
        Card,
        null,
        h(SectionHead, { title: t('sizeNotesTitle') }),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 } }, t('sizeNotesBody')),
      )

      return h(
        'div',
        { style: { maxWidth: 1280, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 8 } },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 19, fontWeight: 680, letterSpacing: -0.2 } }, t('sizeTitle')),
            h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, t('sizeHint')),
          ),
        ),
        notice
          ? h(
              'div',
              {
                style: {
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: 10,
                  fontSize: 12.5,
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: notice.kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
                },
              },
              notice.text,
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 16 } },
          h(
            'div',
            { style: { flex: '1 1 680px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 } },
            uploadCard,
            dataCard,
            previewCard,
          ),
          h(
            'div',
            { style: { flex: '0 1 360px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 } },
            logoCard,
            settingsCard,
            notesCard,
          ),
        ),
      )
    }

    // ------------------------------------------------------------ studio tab
    function StudioTab(props) {
      const {
        lang, t, form, update, promptValue, setCustomPrompt,
        onCopy, onGenerate, results, history, lastTiming, onPreview, needKey, onOpenSettings,
        jobs, onClearFinishedJobs,
        productRefs,
        onProductFiles, onRemoveProduct,
        referenceCount,
        customPoses, onOpenPoseLibrary,
        extracting, onExtractDescription,
        templates, onSaveTemplate, onApplyTemplate, onOpenTemplateLibrary,
        prompts, onSavePrompt, onOpenPromptLibrary,
        activeName, activeModel,
      } = props

      const [templateNaming, setTemplateNaming] = useState(false)
      const [templateName, setTemplateName] = useState('')
      const [promptNaming, setPromptNaming] = useState(null)

      const jobList = jobs || []
      const runningJobCount = jobList.filter(job => job.status === 'running').length
      const finishedJobCount = jobList.filter(job => job.status === 'done' || job.status === 'error').length
      const jobElapsedSeconds = job => {
        const start = job.startedAt || job.createdAt
        if (!start) return 0
        return Math.max(0, Math.floor(((job.finishedAt || Date.now()) - start) / 1000))
      }
      const jobStatusText = job => {
        if (job.status === 'queued') return t('queueQueued')
        if (job.status === 'running') return `${t('queueRunning')} ${jobElapsedSeconds(job)}s`
        if (job.status === 'done') return t('queueDone')
        return t('queueError')
      }

      const promptsFor = kind => (prompts || []).filter(item => (item.kind || 'style') === kind)

      const applyPromptToField = (kind, item) => {
        if (kind === 'style') {
          const current = (form.extraPrompt || '').trim()
          update({ extraPrompt: current ? `${current}，${item.text}` : item.text })
        } else if (kind === 'model') {
          update({ modelPrompt: item.text })
        } else {
          update({ backgroundPrompt: item.text })
        }
      }

      const chip = (key, labelKey, options) =>
        h(ChipGroup, {
          key,
          lang,
          label: t(labelKey),
          options,
          value: form[key],
          onChange: value => update({ [key]: value }),
        })

      const managePoseButton = h(
        'button',
        { type: 'button', onClick: onOpenPoseLibrary, style: tintButton() },
        t('fPoseCustom'),
      )

      const quietChip = {
        padding: '5px 11px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }

      const promptTagRow = kind => {
        const list = promptsFor(kind)
        return list.length
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
              list.map(item =>
                h(
                  'button',
                  { key: item.id, type: 'button', title: item.text, style: quietChip, onClick: () => applyPromptToField(kind, item) },
                  item.name,
                ),
              ),
            )
          : null
      }

      const promptField = options => {
        const { label, kind, valueKey, placeholder, rows, hint } = options
        const naming = promptNaming && promptNaming.kind === kind
        const value = form[valueKey] || ''
        return h(
          'div',
          { style: { marginBottom: 16 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
            h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, label),
            naming
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setPromptNaming({ kind, name: '' }),
                    style: tintButton(),
                  },
                  t('saveReusable'),
                ),
          ),
          h('textarea', {
            value,
            placeholder,
            onChange: event => update({ [valueKey]: event.target.value }),
            rows: rows || 2,
            style: { ...INPUT_STYLE, resize: 'vertical' },
          }),
          hint
            ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6, lineHeight: 1.55 } }, hint)
            : null,
          naming
            ? h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 } },
                h('input', {
                  value: promptNaming.name,
                  placeholder: t('promptNamePh'),
                  onChange: event => setPromptNaming(prev => ({ ...prev, name: event.target.value })),
                  style: { ...INPUT_STYLE, width: 190, padding: '6px 9px', fontSize: 12 },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !String(value).trim(),
                    onClick: () => {
                      onSavePrompt(kind, promptNaming.name, value)
                      setPromptNaming(null)
                    },
                    style: {
                      ...PRIMARY_BUTTON,
                      padding: '6px 12px',
                      fontSize: 12,
                      borderRadius: 10,
                      opacity: String(value).trim() ? 1 : 0.55,
                    },
                  },
                  t('saveName'),
                ),
                h(
                  'button',
                  { type: 'button', onClick: () => setPromptNaming(null), style: softButton() },
                  t('cancel'),
                ),
              )
            : null,
          promptTagRow(kind),
        )
      }

      const templateList = templates || []
      const templateRow = h(
        'div',
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 18, marginBottom: templateNaming ? 10 : 16 } },
          h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginRight: 2 } }, t('presets')),
          templateList.length
            ? templateList.map(template =>
                h(
                  'button',
                  {
                    key: template.id,
                    type: 'button',
                    onClick: () => onApplyTemplate(template),
                    title: `${template.name}${template.form && template.form.desc ? `\n${template.form.desc}` : ''}`,
                    style: quietChip,
                  },
                  template.name,
                ),
              )
            : h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, t('templatesEmpty')),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                setTemplateNaming(true)
                setTemplateName('')
              },
              style: tintButton({ marginLeft: 4 }),
            },
            t('saveTemplate'),
          ),
          templateList.length
            ? h(
                'button',
                { type: 'button', onClick: onOpenTemplateLibrary, style: softButton() },
                t('templateManage'),
              )
            : null,
        ),
        templateNaming
          ? h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 } },
              h('input', {
                value: templateName,
                placeholder: t('templateNamePh'),
                onChange: event => setTemplateName(event.target.value),
                style: { ...INPUT_STYLE, width: 190, padding: '6px 9px', fontSize: 12 },
              }),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    onSaveTemplate(templateName)
                    setTemplateNaming(false)
                    setTemplateName('')
                  },
                  style: { ...PRIMARY_BUTTON, padding: '6px 12px', fontSize: 12, borderRadius: 10 },
                },
                t('saveName'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    setTemplateNaming(false)
                    setTemplateName('')
                  },
                  style: textButton({ color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }),
                },
                t('cancel'),
              ),
            )
          : null,
      )

      const productUpload = h(
        'label',
        { style: { display: 'inline-flex', cursor: 'pointer', flex: 'none' } },
        h('span', { style: tintButton() }, t('fProductRefAdd')),
        h('input', {
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp',
          multiple: true,
          style: { display: 'none' },
          onChange: event => {
            const files = event.target.files
            if (files && files.length) onProductFiles(files)
            event.target.value = ''
          },
        }),
      )

      const productThumbs = productRefs.length
        ? h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, paddingBottom: 4 } },
            productRefs.map((item, index) =>
              h(
                'div',
                { key: `${item.name}-${index}`, style: { position: 'relative', width: 60, height: 60 } },
                h('img', {
                  src: item.preview,
                  alt: item.name,
                  title: item.name,
                  onClick: () => onPreview(item.preview),
                  style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)', cursor: 'zoom-in', display: 'block' },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('remove'),
                    onClick: () => onRemoveProduct(index),
                    style: {
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999,
                      border: '1px solid var(--dsw-alias-border-l1)',
                      background: 'var(--dsw-alias-bg-layer-1)',
                      color: 'var(--dsw-alias-label-secondary)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      cursor: 'pointer', fontSize: 11, lineHeight: '18px', padding: 0,
                    },
                  },
                  '×',
                ),
              ),
            ),
          )
        : null

      const referencesCard = h(
        Card,
        null,
        h(SectionHead, { title: t('studioRefsTitle'), hint: t('studioRefsHint') }),
        h(
          'div',
          {
            style: {
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 12,
              background: 'var(--dsw-alias-bg-layer-2)',
              border: '1px solid var(--dsw-alias-border-l1)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            h(
              'div',
              {
                style: {
                  width: 56, height: 56, borderRadius: 12, flex: 'none',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px dashed var(--dsw-alias-border-l2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 300, color: 'var(--dsw-alias-label-secondary)',
                },
              },
              '＋',
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('fProductRef')),
              h(
                'div',
                { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.55 } },
                `${t('fProductRefHint')}${productRefs.length ? ` · ${t('productCount')} ${productRefs.length} / 4 · ${t('refsSavedHint')}` : ''}`,
              ),
            ),
            productUpload,
          ),
          productThumbs ? h('div', { style: { paddingLeft: 68, marginTop: 6 } }, productThumbs) : null,
        ),
      )

      const poseLabelRow = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 } },
        h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, t('fPose')),
        managePoseButton,
      )

      const poseSection = customPoses.length
        ? h(
            'div',
            { style: { marginBottom: 16 } },
            poseLabelRow,
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              customPoses.map(item => {
                const active = item.id === form.pose
                return h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    onClick: () => update({ pose: item.id }),
                    title: item.prompt,
                    style: {
                      padding: '6px 12px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 500,
                      cursor: 'pointer',
                      border: '1px solid transparent',
                      background: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
                      color: active ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                    },
                  },
                  item.name,
                )
              }),
            ),
          )
        : h(
            'div',
            { style: { marginBottom: 16 } },
            poseLabelRow,
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, t('poseEmptyHint')),
          )

      const modelCard = h(
        Card,
        null,
        h(SectionHead, { title: t('studioModelTitle') }),
        poseSection,
        form.modelPrompt && String(form.modelPrompt).trim() ? chip('show', 'fShow', SHOW) : null,
      )

      const ratioOption = findOption(RATIOS, form.ratio)
      const resolutionOption = findOption(RESOLUTIONS, form.resolution)
      const requestedSize = (ratioOption.sizes && ratioOption.sizes[resolutionOption.id]) || ratioOption.sizes['2k'] || ''

      const canvasCard = h(
        Card,
        null,
        h(SectionHead, { title: t('studioCanvasTitle') }),
        h(
          'div',
          { style: { marginBottom: 16 } },
          h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } }, t('fRatio')),
          h(Segmented, { options: RATIOS, value: form.ratio, lang, onChange: value => update({ ratio: value }) }),
        ),
        h(
          'div',
          { style: { marginBottom: 16 } },
          h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } }, t('fResolution')),
          h(Segmented, { options: RESOLUTIONS, value: form.resolution, lang, onChange: value => update({ resolution: value }) }),
          h(
            'div',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 7, lineHeight: 1.55 } },
            `${t('currentSize')}　${requestedSize.replace('x', ' × ')}`,
          ),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, lineHeight: 1.55 } }, t('resolutionHint')),
        ),
        h(Hairline),
        h(Toggle, {
          label: t('strictFidelity'),
          hint: t('strictFidelityHint'),
          checked: form.strictFidelity !== false,
          onChange: value => update({ strictFidelity: value }),
        }),
      )

      const descriptionCard = h(
        Card,
        null,
        h(SectionHead, {
          title: t('studioPromptGroupTitle'),
          extra: h('button', { type: 'button', onClick: onOpenPromptLibrary, style: softButton() }, t('promptManage')),
        }),
        h(
          Field,
          {
            label: t('fDesc'),
            extra: h(
              'button',
              {
                type: 'button',
                onClick: onExtractDescription,
                disabled: extracting,
                style: tintButton({ opacity: extracting ? 0.55 : 1, cursor: extracting ? 'progress' : 'pointer' }),
              },
              extracting ? t('extracting') : `✦ ${t('extractFromRefs')}`,
            ),
          },
          h('textarea', {
            value: form.desc,
            placeholder: t('fDescPh'),
            onChange: event => update({ desc: event.target.value }),
            rows: Math.min(14, Math.max(2, String(form.desc || '').split('\n').length + 1)),
            style: { ...INPUT_STYLE, resize: 'vertical' },
          }),
        ),
        h(Hairline),
        h(
          'div',
          { style: { paddingTop: 14 } },
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 16px' } },
            promptField({
              label: t('fModelPrompt'),
              kind: 'model',
              valueKey: 'modelPrompt',
              placeholder: t('fModelPromptPh'),
              rows: 2,
              hint: t('modelPromptHint'),
            }),
            promptField({
              label: t('fBackgroundPrompt'),
              kind: 'scene',
              valueKey: 'backgroundPrompt',
              placeholder: t('fBackgroundPromptPh'),
              rows: 2,
              hint: t('backgroundPromptHint'),
            }),
          ),
          promptField({
            label: t('fExtraPrompt'),
            kind: 'style',
            valueKey: 'extraPrompt',
            placeholder: t('fExtraPromptPh'),
            rows: 3,
          }),
        ),
        h(Hairline),
        h(
          'div',
          { style: { paddingTop: 14 } },
          h(
            Field,
            { label: t('fNeg') },
            h('textarea', {
              value: form.negative,
              placeholder: t('fNegPh'),
              onChange: event => update({ negative: event.target.value }),
              rows: 2,
              style: { ...INPUT_STYLE, resize: 'vertical' },
            }),
          ),
          h(Toggle, {
            label: t('fNegInclude'),
            checked: form.includeNegative === true,
            onChange: value => update({ includeNegative: value }),
            style: { padding: '2px 0 0' },
          }),
        ),
      )

      const promptCard = h(
        Card,
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: -0.1 } }, t('promptTitle')),
          h(
            'div',
            { style: { display: 'flex', gap: 12 } },
            h('button', { type: 'button', onClick: onCopy, style: textButton({ fontSize: 12 }) }, t('copy')),
            h('button', { type: 'button', onClick: () => setCustomPrompt(null), style: textButton({ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) }, t('promptReset')),
          ),
        ),
        h('textarea', {
          value: promptValue,
          onChange: event => setCustomPrompt(event.target.value),
          rows: 11,
          spellCheck: false,
          style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
        }),
        h(
          'button',
          {
            type: 'button',
            onClick: onGenerate,
            style: { ...PRIMARY_BUTTON, width: '100%', marginTop: 12, padding: '11px 18px', fontSize: 14, borderRadius: 12, cursor: 'pointer' },
          },
          `✦ ${t('generate')}`,
        ),
        h(
          'div',
          { style: { marginTop: 10, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', lineHeight: 1.6 } },
          needKey
            ? h(
                'button',
                { type: 'button', onClick: onOpenSettings, style: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-state-warn-primary)', cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: 0 } },
                t('needKey'),
              )
            : `${referenceCount > 0 ? `${t('modeEdit')}${referenceCount > 1 ? ` · ${referenceCount} ${t('refsCount')}` : ''}` : t('modeText')} · ${optionLabel(ratioOption, lang)} · ${optionLabel(resolutionOption, lang)}${runningJobCount > 0 ? ` · ${t('queueRunningCount')} ${runningJobCount}/${MAX_CONCURRENT_JOBS}` : ''}`,
        ),
      )

      const jobRow = job =>
        h(
          'div',
          { key: job.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' } },
          job.status === 'done' && job.items && job.items[0]
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: () => onPreview(job.items[0].url),
                  title: job.prompt,
                  style: {
                    padding: 0, width: 38, height: 38, flex: 'none',
                    border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8,
                    overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2)', cursor: 'zoom-in',
                  },
                },
                h('img', { src: job.items[0].url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
              )
            : h(
                'div',
                {
                  style: {
                    width: 38, height: 38, borderRadius: 8, flex: 'none',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14,
                    color: job.status === 'error'
                      ? 'var(--dsw-alias-state-error-primary)'
                      : job.status === 'done'
                        ? 'var(--dsw-alias-state-success-primary)'
                        : 'var(--dsw-alias-label-secondary)',
                  },
                },
                job.status === 'error' ? '!' : job.status === 'done' ? '✓' : '…',
              ),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(
              'div',
              { style: { fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              job.prompt,
            ),
            h(
              'div',
              { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              `${job.ratioLabel}${job.referenceCount ? ` · ${job.referenceCount} ${t('refsCount')}` : ''} · ${jobStatusText(job)}${job.status === 'queued' ? ` · ${jobElapsedSeconds(job)}s` : ''}${job.timings && job.timings.totalMs ? ` · ${formatDuration(job.timings.totalMs)}` : ''}`,
            ),
            job.status === 'error' && job.error
              ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', marginTop: 2, lineHeight: 1.4 } }, job.error)
              : null,
          ),
        )

      const queueCard = jobList.length === 0 ? null : h(
        Card,
        { style: { padding: '14px 20px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: -0.1 } }, t('queueTitle')),
            runningJobCount > 0
              ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${t('queueRunningCount')} ${runningJobCount}/${MAX_CONCURRENT_JOBS}`)
              : null,
          ),
          finishedJobCount > 0
            ? h(
                'button',
                { type: 'button', onClick: onClearFinishedJobs, style: textButton({ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) },
                t('queueClearFinished'),
              )
            : null,
        ),
        h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, t('queueHint')),
        h('div', null, jobList.slice(0, 6).map(jobRow)),
        jobList.length > 6
          ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', paddingTop: 4 } }, `+${jobList.length - 6}`)
          : null,
      )

      const grid = items =>
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 } },
          items.map(item => h(Thumb, { key: item.name || item.url, src: item.url, name: item.name, onOpen: () => onPreview(item.url) })),
        )

      const emptyRow = h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '12px 0', textAlign: 'center' } }, t('resultEmpty'))

      const resultsCard = h(
        Card,
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: -0.1 } }, t('resultTitle')),
          results.length > 0
            ? h(
                'span',
                { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                `${results.length}${lastTiming && lastTiming.totalMs ? ` · ${formatDuration(lastTiming.totalMs)}` : ''}`,
              )
            : null,
        ),
        results.length === 0 ? emptyRow : grid(results),
      )

      const historyCard = h(
        Card,
        null,
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: -0.1 } }, t('historyTitle')),
          h('button', { type: 'button', onClick: props.onOpenStudioHistory, style: textButton({ fontSize: 12 }) }, t('refresh')),
        ),
        (history.items || []).length === 0 ? emptyRow : grid((history.items || []).slice(0, 9)),
      )

      return h(
        'div',
        { style: { maxWidth: 1280, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 8 } },
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { style: { fontSize: 19, fontWeight: 680, letterSpacing: -0.2 } }, t('studioTitle')),
            h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4, lineHeight: 1.5 } }, t('studioHint')),
          ),
          activeName
            ? h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 11.5, flexWrap: 'wrap' } },
                h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('activeInterface')),
                h('span', { style: { fontWeight: 600 } }, activeName),
                activeModel ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `· ${activeModel}`) : null,
              )
            : null,
        ),
        templateRow,
        h(
          'div',
          { style: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' } },
          h(
            'div',
            { style: { flex: '1 1 560px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 } },
            referencesCard,
            modelCard,
            canvasCard,
            descriptionCard,
          ),
          h(
            'div',
            { style: { flex: '0 1 420px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 } },
            promptCard,
            queueCard,
            resultsCard,
            historyCard,
          ),
        ),
      )
    }

    // -------------------------------------------------------- prompt library
    // One management page for every reusable prompt: style/framing, model and
    // background. The studio fields add entries; this page edits/deletes them.
    function PromptLibrary(props) {
      const { lang, t, prompts, onBack, onSave, onUpdate, onDelete } = props
      const [editor, setEditor] = useState(null)
      const [confirmId, setConfirmId] = useState(null)

      const kinds = [
        { id: 'style', labelKey: 'promptKindStyle' },
        { id: 'model', labelKey: 'promptKindModel' },
        { id: 'scene', labelKey: 'promptKindScene' },
      ]
      const kindLabel = kind => {
        const entry = kinds.find(item => item.id === kind)
        return t(entry ? entry.labelKey : 'promptKindStyle')
      }
      const kindOptions = kinds.map(item => ({ id: item.id, zh: t(item.labelKey), en: t(item.labelKey) }))
      const promptList = Array.isArray(prompts) ? prompts : []

      const startNew = () => setEditor({ id: null, kind: 'style', name: '', text: '' })
      const startEdit = prompt => setEditor({
        id: prompt.id,
        kind: prompt.kind || 'style',
        name: prompt.name || '',
        text: prompt.text || '',
      })
      const changeEditor = patch => setEditor(prev => ({ ...prev, ...patch }))
      const saveEditor = () => {
        if (!editor) return
        const text = String(editor.text || '').trim()
        if (!text) return
        const name = String(editor.name || '').trim() || text.slice(0, 16)
        if (editor.id) onUpdate(editor.id, { kind: editor.kind, name, text })
        else onSave(editor.kind, name, text)
        setEditor(null)
      }
      const remove = prompt => {
        if (confirmId !== prompt.id) {
          setConfirmId(prompt.id)
          window.setTimeout(() => {
            setConfirmId(current => (current === prompt.id ? null : current))
          }, 4000)
          return
        }
        setConfirmId(null)
        onDelete(prompt.id)
        if (editor && editor.id === prompt.id) setEditor(null)
      }

      const editorCard = editor
        ? h(
            Card,
            { style: { marginBottom: 16 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 } },
              h('div', { style: { fontSize: 13, fontWeight: 650 } }, editor.id ? t('promptEditTitle') : t('promptNewTitle')),
              h('button', { type: 'button', onClick: () => setEditor(null), style: softButton() }, t('cancel')),
            ),
            h(
              Field,
              { label: t('promptNameLabel') },
              h('input', {
                value: editor.name,
                placeholder: t('promptNamePh'),
                onChange: event => changeEditor({ name: event.target.value }),
                style: INPUT_STYLE,
              }),
            ),
            h(
              Field,
              { label: t('promptKindLabel') },
              h(Segmented, { options: kindOptions, value: editor.kind, lang, onChange: value => changeEditor({ kind: value }) }),
            ),
            h(
              Field,
              { label: t('promptTextLabel') },
              h('textarea', {
                value: editor.text,
                onChange: event => changeEditor({ text: event.target.value }),
                rows: 5,
                style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
              }),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: saveEditor,
                disabled: !String(editor.text || '').trim(),
                style: { ...PRIMARY_BUTTON, padding: '7px 16px', fontSize: 12.5, opacity: String(editor.text || '').trim() ? 1 : 0.55 },
              },
              t('saveName'),
            ),
          )
        : null

      const row = prompt =>
        h(
          Card,
          { key: prompt.id, style: { padding: '12px 14px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 13.5, fontWeight: 650 } }, prompt.name),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                      color: 'var(--dsw-alias-label-secondary)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                    },
                  },
                  kindLabel(prompt.kind || 'style'),
                ),
              ),
              h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4, lineHeight: 1.6, wordBreak: 'break-word' } }, prompt.text),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('button', { type: 'button', onClick: () => startEdit(prompt), style: softButton() }, t('poseEdit')),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => remove(prompt),
                  style: softButton({
                    color: confirmId === prompt.id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)',
                  }),
                },
                confirmId === prompt.id ? t('templateDeleteConfirm') : t('remove'),
              ),
            ),
          ),
        )

      const groups = kinds.map(kind => {
        const entries = promptList.filter(prompt => (prompt.kind || 'style') === kind.id)
        if (entries.length === 0) return null
        return h(
          'div',
          { key: kind.id },
          h(SectionTitle, { title: kindLabel(kind.id) }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, entries.map(row)),
        )
      })

      return h(
        'div',
        { style: { maxWidth: 820, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: onBack, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseBack')),
          h('div', { style: { fontSize: 16, fontWeight: 680 } }, t('promptLibraryTitle')),
          h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', onClick: startNew, style: tintButton() }, t('newPrompt')),
        ),
        h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 14px', lineHeight: 1.65 } }, t('promptLibraryHint')),
        editorCard,
        promptList.length === 0
          ? h(Card, { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', padding: '14px 16px' } }, t('promptLibraryEmpty'))
          : groups,
      )
    }

    // ------------------------------------------------------ template library
    // Editable library for the user's own quick templates. Creating happens in
    // the studio ("+ 保存为模板"); this page renames/edits/deletes them.
    function TemplateLibrary(props) {
      const { lang, t, templates, onBack, onApply, onUpdate, onDelete } = props
      const [editor, setEditor] = useState(null)
      const [confirmId, setConfirmId] = useState(null)

      const startEdit = template => {
        setConfirmId(null)
        const form = template.form || {}
        setEditor({
          id: template.id,
          name: template.name || '',
          ratio: form.ratio || DEFAULT_FORM.ratio,
          resolution: form.resolution || DEFAULT_FORM.resolution,
          desc: form.desc || '',
          modelPrompt: form.modelPrompt || '',
          backgroundPrompt: form.backgroundPrompt || '',
          extraPrompt: form.extraPrompt || '',
        })
      }

      const changeEditor = patch => setEditor(prev => ({ ...prev, ...patch }))

      const saveEditor = () => {
        if (!editor) return
        const name = editor.name.trim()
        if (!name) return
        const template = templates.find(item => item.id === editor.id)
        if (!template) {
          setEditor(null)
          return
        }
        onUpdate(editor.id, {
          name,
          form: {
            ...(template.form || {}),
            ratio: editor.ratio,
            resolution: editor.resolution,
            desc: editor.desc,
            modelPrompt: editor.modelPrompt,
            backgroundPrompt: editor.backgroundPrompt,
            extraPrompt: editor.extraPrompt,
          },
        })
        setEditor(null)
      }

      const remove = template => {
        if (confirmId !== template.id) {
          setConfirmId(template.id)
          window.setTimeout(() => {
            setConfirmId(current => (current === template.id ? null : current))
          }, 4000)
          return
        }
        setConfirmId(null)
        onDelete(template.id)
        if (editor && editor.id === template.id) setEditor(null)
      }

      const summary = template => {
        const form = template.form || {}
        const ratio = optionLabel(findOption(RATIOS, form.ratio || DEFAULT_FORM.ratio), lang)
        const resolution = optionLabel(findOption(RESOLUTIONS, form.resolution || DEFAULT_FORM.resolution), lang)
        const desc = String(form.desc || '').trim()
        return `${ratio} · ${resolution}${desc ? ` · ${desc.length > 42 ? `${desc.slice(0, 42)}…` : desc}` : ''}`
      }

      const editorCard = editor
        ? h(
            Card,
            { style: { marginBottom: 16 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 } },
              h('div', { style: { fontSize: 13, fontWeight: 650 } }, t('templateEditTitle')),
              h(
                'button',
                { type: 'button', onClick: () => setEditor(null), style: textButton({ color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) },
                t('cancel'),
              ),
            ),
            h(
              Field,
              { label: t('templateName') },
              h('input', {
                value: editor.name,
                placeholder: t('templateNamePh'),
                onChange: event => changeEditor({ name: event.target.value }),
                style: INPUT_STYLE,
              }),
            ),
            h(
              Field,
              { label: t('fRatio') },
              h(Segmented, { options: RATIOS, value: editor.ratio, lang, onChange: value => changeEditor({ ratio: value }) }),
            ),
            h(
              Field,
              { label: t('fResolution') },
              h(Segmented, { options: RESOLUTIONS, value: editor.resolution, lang, onChange: value => changeEditor({ resolution: value }) }),
            ),
            h(
              Field,
              { label: t('templateDesc') },
              h('textarea', {
                value: editor.desc,
                onChange: event => changeEditor({ desc: event.target.value }),
                rows: 4,
                style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
              }),
            ),
            h(
              Field,
              { label: t('fModelPrompt') },
              h('textarea', {
                value: editor.modelPrompt,
                onChange: event => changeEditor({ modelPrompt: event.target.value }),
                rows: 2,
                style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
              }),
            ),
            h(
              Field,
              { label: t('fBackgroundPrompt') },
              h('textarea', {
                value: editor.backgroundPrompt,
                onChange: event => changeEditor({ backgroundPrompt: event.target.value }),
                rows: 2,
                style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
              }),
            ),
            h(
              Field,
              { label: t('templatePrompt') },
              h('textarea', {
                value: editor.extraPrompt,
                onChange: event => changeEditor({ extraPrompt: event.target.value }),
                rows: 3,
                style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
              }),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: saveEditor,
                disabled: !editor.name.trim(),
                style: { ...PRIMARY_BUTTON, padding: '7px 16px', fontSize: 12.5, opacity: editor.name.trim() ? 1 : 0.55 },
              },
              t('saveName'),
            ),
          )
        : null

      const list = templates.length === 0
        ? h(Card, { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', padding: '14px 16px' } }, t('templatePageEmpty'))
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            templates.map(template =>
              h(
                Card,
                { key: template.id, style: { padding: '12px 14px' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 } },
                  h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: 13.5, fontWeight: 650 } }, template.name)),
                    h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4, lineHeight: 1.6, wordBreak: 'break-word' } }, summary(template)),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } },
                    h('button', { type: 'button', onClick: () => onApply(template), style: textButton({ fontSize: 12 }) }, t('templateApply')),
                    h('button', { type: 'button', onClick: () => startEdit(template), style: ghostButton({ padding: '4px 10px', fontSize: 12 }) }, t('poseEdit')),
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => remove(template),
                        style: ghostButton({
                          padding: '4px 10px',
                          fontSize: 12,
                          color: confirmId === template.id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)',
                        }),
                      },
                      confirmId === template.id ? t('templateDeleteConfirm') : t('remove'),
                    ),
                  ),
                ),
              ),
            ),
          )

      return h(
        'div',
        { style: { maxWidth: 820, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: onBack, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseBack')),
          h('div', { style: { fontSize: 16, fontWeight: 680 } }, t('templatePageTitle')),
        ),
        h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 14px', lineHeight: 1.65 } }, t('templatePageHint')),
        editorCard,
        list,
      )
    }

    // ---------------------------------------------------------- pose library
    // Dedicated page for reusable custom actions. The studio's "＋ 自定义动作"
    // button opens it; creating, editing and deleting all happen here, while the
    // studio keeps only the selection chips.
    function PoseLibrary(props) {
      const { t, customPoses, onSavePose, onDeletePose, onBack, selectedPose } = props
      const [editor, setEditor] = useState({ id: null, name: '', prompt: '' })
      const [flash, setFlash] = useState('')
      const [confirmId, setConfirmId] = useState(null)

      const isEditing = Boolean(editor.id)
      const canSave = Boolean(editor.name.trim() && editor.prompt.trim())

      const change = patch => {
        setFlash('')
        setConfirmId(null)
        setEditor(prev => ({ ...prev, ...patch }))
      }

      const reset = () => {
        setFlash('')
        setConfirmId(null)
        setEditor({ id: null, name: '', prompt: '' })
      }

      const save = () => {
        const name = editor.name.trim()
        const prompt = editor.prompt.trim()
        if (!name || !prompt) return
        const id = editor.id || `pose-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        onSavePose({ id, name, prompt })
        setEditor({ id: null, name: '', prompt: '' })
        setConfirmId(null)
        setFlash(t('poseSaved'))
      }

      // Two-step inline delete: the first click arms the row, the second one
      // deletes. This avoids a native confirm dialog, which embedding shells may
      // suppress, and still prevents a single misclick from removing an action.
      const remove = item => {
        if (confirmId !== item.id) {
          setConfirmId(item.id)
          window.setTimeout(() => {
            setConfirmId(current => (current === item.id ? null : current))
          }, 4000)
          return
        }
        setConfirmId(null)
        onDeletePose(item.id)
        if (editor.id === item.id) reset()
      }

      const list = customPoses.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            customPoses.map(item =>
              h(
                Card,
                {
                  key: item.id,
                  style: {
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 14,
                    padding: '12px 14px',
                    borderColor: item.id === editor.id ? 'var(--dsw-alias-brand-primary)' : undefined,
                  },
                },
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontSize: 13.5, fontWeight: 650 } }, item.name),
                    item.id === selectedPose
                      ? h(
                          'span',
                          {
                            style: {
                              fontSize: 10.5,
                              padding: '2px 8px',
                              borderRadius: 999,
                              color: 'var(--dsw-alias-brand-primary)',
                              background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent)',
                            },
                          },
                          t('poseSelected'),
                        )
                      : null,
                  ),
                  h(
                    'div',
                    { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 5, lineHeight: 1.6, wordBreak: 'break-word' } },
                    item.prompt,
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, flexShrink: 0 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        setFlash('')
                        setConfirmId(null)
                        setEditor({ id: item.id, name: item.name, prompt: item.prompt })
                      },
                      style: ghostButton({ padding: '4px 10px', fontSize: 12 }),
                    },
                    t('poseEdit'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => remove(item),
                      style: ghostButton({
                        padding: '4px 10px',
                        fontSize: 12,
                        color: 'var(--dsw-alias-state-error-primary)',
                        borderColor: confirmId === item.id ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)',
                        background: confirmId === item.id ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)' : 'transparent',
                      }),
                    },
                    confirmId === item.id ? t('poseDeleteConfirm') : t('remove'),
                  ),
                ),
              ),
            ),
          )
        : h(
            Card,
            { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', padding: '14px 16px' } },
            t('poseListEmpty'),
          )

      return h(
        'div',
        { style: { maxWidth: 820, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: onBack, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseBack')),
          h('div', { style: { fontSize: 16, fontWeight: 680 } }, t('posePageTitle')),
        ),
        h(
          'div',
          { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 14px', lineHeight: 1.65 } },
          t('posePageHint'),
        ),
        h(
          Card,
          { style: { marginBottom: 16 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 } },
            h('div', { style: { fontSize: 13, fontWeight: 650 } }, isEditing ? t('poseEditTitle') : t('poseAddTitle')),
            flash ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, flash) : null,
          ),
          h(
            Field,
            { label: t('poseName') },
            h('input', {
              value: editor.name,
              placeholder: t('poseNamePh'),
              onChange: event => change({ name: event.target.value }),
              style: INPUT_STYLE,
            }),
          ),
          h(
            Field,
            { label: t('posePrompt') },
            h('textarea', {
              value: editor.prompt,
              placeholder: t('posePromptPh'),
              onChange: event => change({ prompt: event.target.value }),
              rows: 3,
              style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(
              'button',
              {
                type: 'button',
                onClick: save,
                disabled: !canSave,
                style: {
                  ...PRIMARY_BUTTON,
                  padding: '7px 16px',
                  fontSize: 12.5,
                  opacity: canSave ? 1 : 0.55,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                },
              },
              `${isEditing ? '' : '＋ '}${t('poseSave')}`,
            ),
            isEditing
              ? h('button', { type: 'button', onClick: reset, style: ghostButton({ padding: '7px 14px', fontSize: 12.5 }) }, t('cancel'))
              : null,
          ),
        ),
        h(SectionTitle, { title: t('poseListTitle') }),
        list,
      )
    }

    // ---------------------------------------------------------- settings tab
    function SettingsTab(props) {
      const {
        lang, t, settings, draft, setDraft, saving, onSave, onActivate, onTest, testState,
        accentId, onAccent, fidelityText, fidelityDefault, onSaveFidelity, onResetFidelity,
      } = props
      const [models, setModels] = useState(null)
      const [modelState, setModelState] = useState(null)
      const [fidelityEditing, setFidelityEditing] = useState(false)
      const [fidelityDraft, setFidelityDraft] = useState('')
      const profiles = draft ? draft.profiles : []
      const active = draft ? profiles.find(profile => profile.id === draft.activeId) || profiles[0] || null : null
      const fidelityEdited = typeof fidelityText === 'string' && fidelityText !== fidelityDefault

      const updateProfile = useCallback(patch => {
        setDraft(prev => {
          if (!prev) return prev
          const current = prev.profiles.find(profile => profile.id === prev.activeId) || prev.profiles[0]
          if (!current) return prev
          return {
            ...prev,
            profiles: prev.profiles.map(profile => (profile.id === current.id ? { ...profile, ...patch } : profile)),
          }
        })
      }, [setDraft])

      const selectProfile = useCallback(id => {
        setDraft(prev => (prev ? { ...prev, activeId: id } : prev))
        setModels(null)
        setModelState(null)
        const saved = settings && Array.isArray(settings.profiles) && settings.profiles.some(profile => profile.id === id)
        if (saved) onActivate(id)
      }, [settings, onActivate, setDraft])

      const addProfile = useCallback(() => {
        if (!draft) return
        const current = draft.profiles.find(profile => profile.id === draft.activeId) || draft.profiles[0]
        const profile = {
          id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: t('newProfileName'),
          baseUrl: current ? current.baseUrl : 'https://api.openai.com/v1',
          model: current ? current.model : 'gpt-image-1',
          size: current ? current.size : '1024x1024',
          quality: current ? current.quality : '',
          apiKey: '',
          hasApiKey: false,
          apiKeyTail: '',
          clearKey: false,
        }
        setModels(null)
        setModelState(null)
        setDraft({ ...draft, activeId: profile.id, profiles: [...draft.profiles, profile] })
      }, [draft, t, setDraft])

      const removeProfile = useCallback(() => {
        if (!draft || !active || draft.profiles.length <= 1) return
        const remaining = draft.profiles.filter(profile => profile.id !== active.id)
        const nextActive = remaining.some(profile => profile.id === draft.activeId) ? draft.activeId : remaining[0].id
        setModels(null)
        setModelState(null)
        setDraft({ ...draft, activeId: nextActive, profiles: remaining })
      }, [draft, active, setDraft])

      const fetchModels = useCallback(async () => {
        if (!active) return
        setModelState({ state: 'loading' })
        try {
          const json = await api('/models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ profileId: active.id, baseUrl: active.baseUrl, apiKey: active.apiKey || undefined }),
          })
          const ids = json.ids || []
          setModels(ids)
          setModelState({ state: 'ok', count: ids.length })
          if (ids.length > 0 && ids.indexOf(active.model) < 0) updateProfile({ model: ids[0] })
        } catch (error) {
          setModels(null)
          setModelState({ state: 'fail', message: String(error && error.message ? error.message : error) })
        }
      }, [active, updateProfile])

      const runTest = useCallback(() => {
        if (!active) return
        onTest({ profileId: active.id, baseUrl: active.baseUrl, apiKey: active.apiKey || undefined })
      }, [active, onTest])

      const saveAll = useCallback(() => {
        if (!draft) return
        onSave({
          activeId: draft.activeId,
          outputDir: draft.outputDir,
          profiles: draft.profiles.map(profile => ({
            id: profile.id,
            name: profile.name,
            baseUrl: profile.baseUrl,
            model: profile.model,
            size: profile.size,
            quality: profile.quality,
            apiKey: profile.apiKey || undefined,
            clearApiKey: profile.clearKey === true,
          })),
        })
      }, [draft, onSave])

      if (!draft || !active) {
        return h(
          'div',
          { style: { maxWidth: 860, margin: '0 auto', paddingTop: 20 } },
          h(Card, null, h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '…')),
        )
      }

      return h(
        'div',
        { style: { maxWidth: 860, margin: '0 auto' } },
        h(SectionTitle, { title: t('profilesTitle') }),
        h(
          Card,
          null,
          h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10, lineHeight: 1.6 } }, t('profilesHint')),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 } },
            profiles.map(profile => {
              const isActive = profile.id === active.id
              return h(
                'button',
                {
                  key: profile.id,
                  type: 'button',
                  onClick: () => selectProfile(profile.id),
                  title: profile.baseUrl,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    border: isActive ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                    background: isActive ? 'var(--dsw-alias-brand-primary)' : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                  },
                },
                profile.name,
                isActive ? h('span', { style: { fontSize: 10.5, opacity: 0.85 } }, `✓ ${t('currentTag')}`) : null,
              )
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: addProfile,
                style: {
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: '1px dashed var(--dsw-alias-border-l2)',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              t('addProfile'),
            ),
          ),
          h(
            Field,
            { label: t('profileName') },
            h('input', {
              value: active.name || '',
              placeholder: t('profileNamePh'),
              onChange: e => updateProfile({ name: e.target.value }),
              style: INPUT_STYLE,
            }),
          ),
          h(Field, { label: t('sBaseUrl') }, h('input', { value: active.baseUrl || '', onChange: e => updateProfile({ baseUrl: e.target.value }), style: INPUT_STYLE })),
          h(
            'div',
            { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { flex: '1 1 220px' } },
              h(
                Field,
                {
                  label: t('sModel'),
                  hint: t('sModelHint'),
                  extra: h(
                    'button',
                    {
                      type: 'button',
                      onClick: fetchModels,
                      disabled: modelState && modelState.state === 'loading',
                      style: ghostButton({ padding: '3px 9px', fontSize: 11.5 }),
                    },
                    modelState && modelState.state === 'loading' ? t('sFetching') : `⟳ ${t('sFetchModels')}`,
                  ),
                },
                h('input', { value: active.model || '', onChange: e => updateProfile({ model: e.target.value }), style: INPUT_STYLE }),
                modelState
                  ? h(
                      'div',
                      {
                        style: {
                          fontSize: 11,
                          marginTop: 5,
                          wordBreak: 'break-word',
                          color: modelState.state === 'fail' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
                        },
                      },
                      modelState.state === 'ok'
                        ? `${modelState.count} ${t('sModelsFound')}`
                        : modelState.state === 'fail'
                          ? modelState.message
                          : '',
                    )
                  : null,
                models
                  ? h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxHeight: 112, overflowY: 'auto' } },
                      models.map(id =>
                        h(
                          'button',
                          {
                            key: id,
                            type: 'button',
                            title: id,
                            onClick: () => updateProfile({ model: id }),
                            style: {
                              padding: '4px 9px',
                              borderRadius: 8,
                              fontSize: 11.5,
                              cursor: 'pointer',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              border: active.model === id ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                              background: active.model === id ? 'var(--dsw-alias-brand-primary)' : 'transparent',
                              color: active.model === id ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                            },
                          },
                          id,
                        ),
                      ),
                    )
                  : null,
              ),
            ),
            h('div', { style: { flex: '1 1 220px' } }, h(Field, { label: t('sSize'), hint: t('sSizeHint') }, h('input', { value: active.size || '', onChange: e => updateProfile({ size: e.target.value }), style: INPUT_STYLE }))),
          ),
          h(
            Field,
            {
              label: t('sKey'),
              hint: active.hasApiKey ? `${t('sKeyPhSet')}${active.apiKeyTail ? `（••••${active.apiKeyTail}）` : ''}` : undefined,
            },
            h('input', {
              type: 'password',
              value: active.apiKey || '',
              placeholder: active.hasApiKey ? t('sKeyPhSet') : t('sKeyPhEmpty'),
              onChange: e => updateProfile({ apiKey: e.target.value }),
              style: INPUT_STYLE,
              autoComplete: 'off',
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 } },
              h(
                'label',
                { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: active.clearKey === true, onChange: e => updateProfile({ clearKey: e.target.checked }) }),
                t('sClearKey'),
              ),
              h('button', { type: 'button', onClick: runTest, disabled: testState && testState.state === 'testing', style: ghostButton({ padding: '6px 12px', fontSize: 12 }) },
                testState && testState.state === 'testing' ? t('testing') : t('test')),
              testState
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 12,
                        color: testState.state === 'ok' ? 'var(--dsw-alias-state-success-primary)' : testState.state === 'fail' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 320,
                      },
                    },
                    testState.state === 'ok' ? `${t('testOk')}${testState.message ? ` · ${testState.message}` : ''}` : testState.state === 'fail' ? `${t('testFail')}${testState.message ? ` · ${testState.message}` : ''}` : '',
                  )
                : null,
            ),
          ),
          h(Field, { label: t('sQuality') },
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              QUALITIES.map(option =>
                h(
                  'button',
                  {
                    key: option.id || 'default',
                    type: 'button',
                    onClick: () => updateProfile({ quality: option.id }),
                    style: {
                      padding: '5px 11px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      cursor: 'pointer',
                      border: active.quality === option.id ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                      background: active.quality === option.id ? 'var(--dsw-alias-brand-primary)' : 'transparent',
                      color: active.quality === option.id ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                    },
                  },
                  optionLabel(option, lang),
                ),
              ),
            ),
          ),
          h(
            Field,
            { label: t('sOutput') },
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('input', {
                value: draft.outputDir || '',
                onChange: e => setDraft(prev => (prev ? { ...prev, outputDir: e.target.value } : prev)),
                style: { ...INPUT_STYLE, flex: '1 1 320px' },
              }),
              h(
                'button',
                {
                  type: 'button',
                  onClick: async () => {
                    try {
                      const picked = await appCtx.uiWorkspace.pickDirectory()
                      if (picked) setDraft(prev => (prev ? { ...prev, outputDir: picked } : prev))
                    } catch (error) {
                      // picker unavailable; the text field still works
                    }
                  },
                  style: ghostButton({ padding: '8px 12px', fontSize: 12.5 }),
                },
                t('pick'),
              ),
              h('button', { type: 'button', onClick: props.onReveal, style: ghostButton({ padding: '8px 12px', fontSize: 12.5 }) }, t('saveDir')),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 10, marginTop: 4 } },
            h(
              'div',
              { style: { display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' } },
              h('button', { type: 'button', onClick: saveAll, disabled: saving, style: { ...PRIMARY_BUTTON, opacity: saving ? 0.7 : 1 } }, saving ? '…' : t('save')),
              h(
                'button',
                {
                  type: 'button',
                  onClick: removeProfile,
                  disabled: profiles.length <= 1,
                  style: ghostButton({
                    padding: '8px 12px',
                    fontSize: 12.5,
                    color: profiles.length <= 1 ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)',
                    borderColor: 'var(--dsw-alias-border-l1)',
                    opacity: profiles.length <= 1 ? 0.5 : 1,
                    cursor: profiles.length <= 1 ? 'not-allowed' : 'pointer',
                  }),
                },
                t('deleteProfile'),
              ),
              profiles.length <= 1
                ? h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, t('lastProfileWarn'))
                : null,
            ),
          ),
        ),
        h(SectionTitle, { title: t('builtinPromptsTitle') }),
        h(
          Card,
          { style: { marginBottom: 20 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('builtinPromptName')),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10.5,
                      padding: '2px 8px',
                      borderRadius: 999,
                      color: fidelityEdited ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
                      background: fidelityEdited
                        ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent)'
                        : 'var(--dsw-alias-bg-layer-2)',
                    },
                  },
                  fidelityEdited ? t('fidelityModified') : t('fidelityDefault'),
                ),
              ),
              h(
                'div',
                { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 5, lineHeight: 1.65 } },
                t('builtinPromptsHint'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 12, flexShrink: 0 } },
              fidelityEditing
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        setFidelityDraft(fidelityText)
                        setFidelityEditing(true)
                      },
                      style: textButton(),
                    },
                    t('edit'),
                  ),
              fidelityEdited && !fidelityEditing
                ? h(
                    'button',
                    { type: 'button', onClick: onResetFidelity, style: textButton({ color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) },
                    t('restoreDefault'),
                  )
                : null,
            ),
          ),
          fidelityEditing
            ? h(
                'div',
                { style: { marginTop: 14 } },
                h('textarea', {
                  value: fidelityDraft,
                  onChange: event => setFidelityDraft(event.target.value),
                  rows: 14,
                  spellCheck: false,
                  style: {
                    ...INPUT_STYLE,
                    resize: 'vertical',
                    lineHeight: 1.65,
                    fontSize: 12.5,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  },
                }),
                h(
                  'div',
                  { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        if (!fidelityDraft.trim()) return
                        onSaveFidelity(fidelityDraft)
                        setFidelityEditing(false)
                      },
                      style: { ...PRIMARY_BUTTON, padding: '7px 16px', fontSize: 12.5, opacity: fidelityDraft.trim() ? 1 : 0.55 },
                    },
                    t('save'),
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => setFidelityEditing(false), style: ghostButton({ padding: '7px 14px', fontSize: 12.5 }) },
                    t('cancel'),
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => setFidelityDraft(fidelityDefault), style: textButton({ color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) },
                    t('restoreDefault'),
                  ),
                ),
              )
            : null,
        ),
        h(SectionTitle, { title: t('appearance') }),
        h(
          Card,
          null,
          h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 } }, t('accentHint')),
          h(
            'div',
            { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            ACCENTS.map(accent =>
              h(
                'button',
                {
                  key: accent.id,
                  type: 'button',
                  onClick: () => onAccent(accent.id),
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    border: accentId === accent.id ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                    background: accentId === accent.id ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'transparent',
                    color: 'var(--dsw-alias-label-primary)',
                  },
                },
                h('span', {
                  style: {
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: accent.light || 'linear-gradient(135deg, #2563eb, #7c3aed)',
                    display: 'inline-block',
                    border: '1px solid var(--dsw-alias-border-l2)',
                  },
                }),
                optionLabel(accent, lang),
              ),
            ),
          ),
        ),
        h(SectionTitle, { title: t('aboutTitle') }),
        h(Card, { style: { marginBottom: 20 } },
          h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } }, t('aboutBody')),
        ),
      )
    }

    // -------------------------------------------------------------- register
    const ErrorBoundaryBase = React.Component || class {
      constructor(props) {
        this.props = props
        this.state = {}
      }
      setState(next) {
        this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }
      }
      render() {
        return this.props.children
      }
    }

    class WorkbenchErrorBoundary extends ErrorBoundaryBase {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        try {
          console.error('[personal-workbench]', error)
        } catch {
          // console unavailable
        }
      }
      render() {
        if (!this.state.failed) return this.props.children
        return h(
          'div',
          {
            style: {
              height: '100%', minHeight: 260, padding: 40,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
              color: 'var(--dsw-alias-label-primary)',
            },
          },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '工作台渲染出错了 / Workbench failed to render'),
          h(
            'div',
            { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', maxWidth: 460, lineHeight: 1.7 } },
            '请刷新页面重试；如果反复出现，可在「插件」页暂时关闭本插件。\nRefresh the page; you can also disable this plugin if it keeps happening.',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                try {
                  window.location.reload()
                } catch {
                  // reload unavailable
                }
              },
              style: {
                padding: '8px 16px', borderRadius: 10,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-2)',
                color: 'var(--dsw-alias-label-primary)',
                cursor: 'pointer', fontSize: 12.5,
              },
            },
            '刷新 / Refresh',
          ),
        )
      }
    }

    return {
      inject: ['slots', 'locale', 'theme', 'layout', 'uiWorkspace'],
      apply(ctx) {
        appCtx = ctx
        try {
          const saved = loadJson(LS_ACCENT, { id: 'default' })
          applyAccent(ctx, saved.id || 'default')
        } catch {
          // accent is a preference; never let it block the page
        }
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'workbench' }, () => h(WorkbenchErrorBoundary, null, h(Page))),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'workbench', order: -10, label: () => {
              try {
                const snapshot = ctx.locale.getLocale()
                const id = String((snapshot && (snapshot.id || snapshot.locale)) || '')
                return id.toLowerCase().indexOf('en') === 0 ? 'Workbench' : '工作台'
              } catch {
                return '工作台'
              }
            } },
            WorkbenchIcon,
          ),
        )
      },
    }
  },
})
