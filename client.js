/**
 * Client half of the Personal Workbench bundle.
 *
 * Registers a sidebar panel icon ("工作台") and the matching main-panel page.
 * The page has four tabs: overview dashboard, e-commerce model image studio,
 * size-chart posters, and settings (image API endpoint / key / output folder /
 * accent color / built-in prompt).
 *
 * The studio sends product reference photos (up to 4, first one is the front
 * view) to the Host, which forwards them to an OpenAI-compatible /images/edits
 * endpoint. The model and background are described in words. The API key never
 * enters the browser.
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
    // After the product reference photos change, wait this long with no further
    // change before automatically extracting the product description.
    const AUTO_EXTRACT_DELAY_MS = 5000
    const LS_FORM = 'pbw.form.v1'
    const LS_PROMPTS = 'pbw.prompts.v1'
    const LS_POSES = 'pbw.poses.v1'
    const LS_ACCENT = 'pbw.accent.v1'
    const LS_FIDELITY = 'pbw.fidelity.v1'
    const LS_TEMPLATES = 'pbw.templates.v1'
    // 早期「尺码表」功能的遗留键：现在既不读也不写。保留声明是为了让审计/迁移
    // 脚本能认出这个键属于本插件，不要把它当成脏数据删掉（旧用户的键值仍在磁盘上）。
    // 参考 docs/audit-2026-10-20.md 的 A-09。
    const LS_SIZETABLE = 'pbw.sizetable.v1'
    const LS_SIZEPOSTER = 'pbw.sizeposter.v1'
    // Folder the size-chart PNG is written to; empty means "use the browser
    // download" (the previous behaviour).
    const LS_POSTER_DIR = 'pbw.posterdir.v1'

    // A job that never settles would hold one of the MAX_CONCURRENT_JOBS slots
    // forever, so a client watchdog closes it after this long. It is far longer
    // than the Host's own provider timeout: it only catches a lost response or a
    // socket that never ends, not a genuinely slow generation.
    const JOB_WATCHDOG_MS = 10 * 60 * 1000
    // Pending (running + waiting) jobs the queue accepts before it refuses more.
    const MAX_PENDING_JOBS = 12
    // Rows kept in the queue card; running/queued rows are never dropped.
    const MAX_JOB_ROWS = 24
    // A failed row keeps its request so "retry" needs no re-upload. Reference
    // photos are base64 and can be megabytes, so only the newest few failures
    // keep one (the rest stay as plain error rows).
    const MAX_RETRY_PAYLOADS = 3
    // A provider message appended after an unmapped error code is cut here.
    const ERROR_DETAIL_MAX = 160
    // "Click again to delete" window on the library/settings pages.
    const CONFIRM_DELETE_MS = 4000

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
        sizeSaveDir: '保存目录',
        sizeSaveDirHint: '选择后「下载 PNG」会直接保存到该目录；不选则用浏览器默认下载',
        sizeSaveDirClear: '恢复默认下载',
        sizeSavedTo: '已保存到',
        sizeSaveFailed: '保存失败：',
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
        templateDefaultName: '模板',
        promptLibraryTitle: '提示词库',
        promptLibraryHint: '可复用提示词只在这里创建、编辑与删除；生图页的「模特提示词 / 背景提示词 / 自定义提示词」都从这里点选，不能再直接输入。',
        promptKindStyle: '风格 / 画面',
        promptKindModel: '模特',
        promptKindScene: '背景',
        promptKindLabel: '类别',
        promptTextLabel: '提示词内容',
        promptEditTitle: '编辑提示词',
        promptNewTitle: '新建提示词',
        promptLibraryEmpty: '还没有提示词，点右上角「＋ 新建提示词」创建。',
        promptSaved: '提示词已保存',
        promptUpdated: '提示词已更新',
        promptManage: '提示词库',
        promptSelectEmpty: '提示词库里还没有这类提示词。',
        promptClear: '清除',
        promptNewForKind: '＋ 新建提示词',
        fModelPrompt: '模特提示词（可选）',
        fModelPromptPh: '例：25 岁亚洲女性，黑色长直发，冷白皮，身材高挑，自然淡妆',
        fBackgroundPrompt: '背景提示词（可选）',
        fBackgroundPromptPh: '例：城市街道傍晚，暖色逆光，浅景深，地面有轻微反光',
        promptOnlyHint: '这些提示词只能从「提示词库」点选；新建与修改都在提示词库里完成。',
        promptOrphan: '当前提示词不在提示词库里（来自模板或旧版本），因此没有高亮按钮；可点「存入库」或「清除」。',
        promptAdopt: '存入库',
        promptArchived: '已存入提示词库',
        promptDupBlocked: '该类别下已有内容完全相同的提示词，请先改内容或删掉旧的那条。',
        promptDraftBusy: '正在编辑一条未保存的提示词，请先「保存」或「取消」。',
        promptDeleted: '提示词已删除',
        promptDeletedCleared: '提示词已删除，生图页对应字段已清空',
        promptLegacySuffix: '（旧版）',
        promptMigrated: '已把生图页里原有的提示词转入提示词库',
        promptExport: '导出',
        promptImport: '导入',
        promptIOPortHint: '「导出」把整个提示词库存成一个 JSON 文件；换电脑或另一个 Harness 时用「导入」一键加回来，同类别同内容的条目会自动跳过。',
        promptExported: '已导出提示词',
        promptCountUnit: ' 条',
        promptExportEmpty: '提示词库还是空的，没有可导出的内容',
        promptExportFailed: '导出失败：浏览器阻止了下载，请重试',
        promptImportDone: '已导入提示词',
        promptImportSkipped: '，已跳过重复或无效：',
        promptImportInvalid: '导入失败：这个文件不是有效的提示词文件（请选择导出的 JSON）',
        promptImportEmpty: '这个文件里没有可导入的提示词',
        promptImportAllDup: '文件里的提示词都已存在，没有新增',
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
        poseGroupFront: '正面',
        poseGroupSide: '侧面',
        poseGroupBack: '背面',
        poseOrient: '朝向分组',
        poseOrientationHint: '分组只影响生图页「姿态」的排列，不改变动作内容',
    poseOrientAuto: '由标题自动判断',
    poseOrientAutoHint: '标题里写了正面 / 侧面 / 背面时以标题为准；想换分组就改标题',
        poseNew: '＋ 新建动作',
        poseImport: '导入',
        poseExport: '导出',
        poseIOPortHint: '导入 / 导出一个 JSON 文件，可在其它电脑上复用动作；重复的动作会自动跳过。',
        poseExported: '已导出动作',
        poseExportEmpty: '动作库还是空的，没有可导出的内容',
        poseExportFailed: '导出失败：浏览器阻止了下载，请重试',
        poseImportDone: '已导入动作',
        poseImportSkipped: '，已跳过重复或无效：',
        poseImportInvalid: '文件不是有效的动作 JSON，请检查后重试',
        poseImportEmpty: '这个文件里没有可导入的动作',
        poseImportAllDup: '文件里的动作都已存在，没有新增',
        titleAuto: '自动生成标题',
        titleTitling: '生成中…',
        titleNeedPrompt: '先填写提示词，再生成标题',
        titleAutoHint: '标题留空时，保存会自动生成（最长 15 个汉字）',
        fShow: '模特展示',
        showHint: '选择后会以 JSON 构图约束覆盖提示词开头的构图段（只写入一次，不与中文提示词拼接）；模型仍可能轻微偏离，可勾选下方「严禁出现」后再补充。',
        fExtraPrompt: '自定义提示词（光线 / 风格等）',
        fExtraPromptPh: '例：柔和侧逆光，暖色调，杂志高级感，film grain，35mm 质感',
        builtinPromptName: '男裤严格保真 V2.4（内置 · JSON）',
        builtinPromptsTitle: '内置提示词',
        builtinPromptsHint: '内置提示词在勾选「商品严格保真」时自动附加到生成提示词。规则现在是 JSON 格式（与构图约束同一写法，去掉了重复描述），点「编辑」可修改，保存时会校验 JSON 是否合法，也可随时恢复默认。',
        fidelityJsonInvalid: '保真规则需为合法 JSON（对象格式）：请检查大括号、引号与逗号',
        edit: '编辑',
        restoreDefault: '恢复默认',
        fidelityModified: '已自定义',
        fidelityDefault: '默认',
        strictFidelity: '商品严格保真（内置 V2.4 · JSON）',
        strictFidelityHint: '上传商品参考图时自动附加内置保真 JSON 规则：锁定商品颜色、面料、版型、结构与细节；商品真实性高于画面美观度',
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
        extractDone: '已按 JSON 提取商品关键元素，可手动修改',
        extractEmpty: '没有提取到内容，请换一张更清晰的商品图',
        visionBadgeBuiltin: '识别接口：Harness 内置视觉模型',
        visionBadgeCustom: '识别接口：第三方视觉模型',
        visionConfigure: '切换识别接口',
        visionIncomplete: '识别接口：视觉接口未配置完整（缺接口地址或模型名）',
        lockHint: '识别时使用「商品细节严格锁定」12 项规则，结果以 JSON 填入商品描述并进入提示词',
        fProductRef: '商品参考图（可选）',
        fProductRefHint: '可上传多张（服装正反面 / 细节图），生成时作为商品参考',
        fProductRefAdd: '上传商品图',
        productCount: '已上传',
        refsSavedHint: '已自动保存，删除后清除',
        refsCount: '张参考图',
        remove: '移除',
        modeEdit: '图生图模式',
        modeText: '文生图模式',
        echoRetried: '接口曾返回参考图原样，已自动重试成功',
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
        errBalance: '接口账户余额不足（insufficient balance）：请到对应平台充值，或在「设置」里更换接口。',
        errAuth: '接口鉴权失败：请检查 API Key 是否正确、是否过期。',
        errRate: '接口限流或上游繁忙：稍后重试，或减少同时生成的数量。',
        errTimeout: '接口响应超时：稍后重试，或换用响应更快的接口。',
        queueStopped: '接口余额/鉴权异常，已停止剩余排队任务；处理后重新生成即可。',
        needKey: '请先在「设置」里填写 API Key 和接口地址。',
        needPrompt: '请先填写商品描述、从提示词库选择提示词，或应用一个模板。',
        resultTitle: '生成结果',
        resultEmpty: '生成结果会显示在这里。',
        historyTitle: '历史图片',
        saveDir: '打开输出目录',
        profilesTitle: '接口配置',
        profilesHint: '可添加多个接口并备注名称，点一下即切换；生图时使用标着「当前」的那个接口。',
        addProfile: '＋ 新增配置',
        deleteProfile: '删除此配置',
        confirmRemove: '再点一次确认删除',
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
        sQuality: '画质参数（留空则不发）',
        sRequestType: '请求类型',
        sRequestTypeStream: '流式响应（推荐）',
        sRequestTypeJson: '非流式响应',
        sRequestTypeHint: '流式：边生成边接收，长耗时接口更稳；接口明确不支持流式时会自动回退为非流式',
        sOutput: '输出目录',
        visionTitle: '商品图识别模型（可选）',
        visionHint: '默认使用 Harness 内置视觉模型识别商品图和尺码表；也可以添加多个第三方 OpenAI 兼容视觉接口并自由切换。识别商品图时会带上「商品细节严格锁定」的 12 项规则。',
        visionBuiltinName: 'Harness 内置视觉模型（默认）',
        visionBuiltinHint: '使用 Harness 当前模型识别，无需接口和 Key',
        visionAddProfile: '＋ 添加视觉接口',
        visionDeleteProfile: '删除这个视觉接口',
        newVisionProfileName: '视觉接口',
        visionBaseUrl: '接口地址',
        visionBaseUrlHint: 'OpenAI 兼容，需包含 /v1，例如 https://api.openai.com/v1',
        visionModel: '模型名称',
        visionModelHint: '需要支持图片输入，例如 gpt-4o-mini / qwen-vl-max / gemini-2.0-flash',
        needBaseUrl: '请先填写接口地址，再拉取模型',
        visionKey: '视觉模型 API Key',
        visionUsingCustom: '当前使用第三方视觉模型',
        visionUsingBuiltin: '当前使用 Harness 内置视觉模型',
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
        aboutBody: '这是专属工作台插件：Host 侧在本机代理图片接口（Key 只保存在本机配置文件），Client 侧提供工作台页面。商品参考图（最多 4 张）会按上传顺序作为 /images/edits 的多张参考图发送，第 1 张视为正面主图；未上传商品参考图时走文生图 /images/generations。模特与背景都只用文字描述。',
        // 上传 / 队列 / 持久化的提示语（原先散落在组件里的硬编码中文）
        pickImageFormat: '请选择 PNG / JPG / WebP 图片',
        refImageTooLarge: '参考图需小于 8MB',
        imageUnsupported: '不支持的图片格式',
        refPersistFailed: '商品图本次可用，但未能持久保存：',
        productAddBusy: '正在处理上一批图片，请稍候再选',
        productRemoveBusy: '正在处理上一批图片，请稍候再操作',
        productAlreadyAdded: '这些图片已在商品参考图里',
        productRefsLimit: '商品参考图最多 4 张，本次未添加，请减少选择数量',
        extractStale: '图片已变化，本次识别结果已丢弃，请重新提取',
        revealFailed: '无法打开目录',
        sizeChartTooLarge: '尺码表图片需小于 8MB',
        sizeChartUnreadable: '图片格式无法识别',
        sizeChartNoTable: '未能识别出尺码表，请换一张更清晰的截图',
        logoTooLarge: 'Logo 需小于 5MB',
        logoPersistFailed: 'Logo 本次可用，但未能持久保存：',
        copyFailed: '复制失败，请手动选择文本复制',
        // 错误归一：Host 返回 code 时按 code 取文案，缺失时按状态码 / 文案兜底
        errMissingKey: '接口配置缺少 API Key 或接口地址：请到「设置」里补全。',
        errBodyTooLarge: '上传内容太大，接口拒绝接收：请减少参考图数量或降低分辨率后重试。',
        errInvalidReference: '接口无法接受这张参考图：请换一张（建议 PNG / JPG，单张小于 8MB）。',
        errHostUnreachable: '无法连接工作台本地服务：请确认 Harness 已加载本插件后刷新页面。',
        errBadResponse: '接口返回的不是有效 JSON：请检查接口地址是否指向 OpenAI 兼容服务。',
        errProvider: '图片接口返回错误：稍后重试；若一直失败，请检查接口地址、模型名或更换接口。',
        errUnknown: '请求失败',
        // Host 侧的 code（index.js 里 wbError / sendError 的取值）各自的文案
        errCrossSite: '请求被判定为跨站来源而拒绝：请从 Harness 的工作台页面里操作。',
        errImageNotFound: '找不到这张图片（可能已被清理）：请刷新列表后重试。',
        errInvalidImageName: '图片文件名不合法：请重命名后重新上传。',
        errInvalidJson: '请求内容不是合法的 JSON（插件内部错误）：请刷新页面后重试。',
        errInvalidRefName: '参考图文件名不合法：请重命名后重新上传。',
        errMethodNotAllowed: '接口不支持这个请求方法（前后端版本不一致）：请更新插件后重试。',
        errMissingReference: '没有可用的参考图：请重新上传商品参考图后重试。',
        errNoImage: '接口返回成功但没有可用图片：请稍后重试，或换一个模型 / 接口。',
        errOutputDir: '输出目录不可写：请到「设置」里换一个目录，或检查该目录的写入权限。',
        errRefNotFound: '找不到这张参考图（可能已被清理）：请重新上传。',
        errReferenceCount: '参考图数量超过上限：请减少张数后重试。',
        errReferenceEchoed: '接口把参考图原样返回、没有真正生成：请重试，或换一个支持图片编辑的模型。',
        errReferenceTooLarge: '单张参考图过大：请压缩或换更小的图片后重试。',
        errReferenceTotalSize: '参考图总大小超过上限：请减少数量或压缩后重试。',
        errRevealOutside: '只能打开输出目录里的文件。',
        errSettingsCorrupt: '本机设置文件损坏，保存已暂停：请修复后重试，或恢复 .bak 备份。',
        errPromptTooLong: '提示词太长：请精简商品描述或提示词后重试（上限见设置）。',
        errOpenFailed: '无法打开输出目录：请检查该目录是否还存在，或直接手动打开。',
        errDirNotFound: '输出目录不存在或不是文件夹：请到「设置」里重新选择，或新建该目录。',
        errMissingDir: '没有指定保存目录：请先在「保存目录」里选择一个文件夹。',
        errMissingImage: '海报内容为空：请等预览生成后重试。',
        errRefOutsideDir: '参考图不在允许的参考图目录里：请重新上传这张图。',
        queueDuplicate: '同样的任务已在排队或生成中，请等它完成。',
        queueRetry: '重试',
        storeQuota: '本机存储已满，设置无法自动保存（本次修改仍然有效）：请清理浏览器存储后重试。',
        storeUnavailable: '浏览器存储不可用，设置无法自动保存（本次修改仍然有效）。',
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
        sizeSaveDir: 'Save folder',
        sizeSaveDirHint: 'When set, “Download PNG” writes straight into this folder; leave it empty to use the browser download',
        sizeSaveDirClear: 'Use browser download',
        sizeSavedTo: 'Saved to',
        sizeSaveFailed: 'Could not save:',
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
        templateDefaultName: 'Template',
        promptLibraryTitle: 'Prompt library',
        promptLibraryHint: 'Reusable prompts are created, edited and deleted only here. The studio’s model / background / custom prompt fields pick entries from this library and no longer accept typed text.',
        promptKindStyle: 'Style / framing',
        promptKindModel: 'Model',
        promptKindScene: 'Background',
        promptKindLabel: 'Category',
        promptTextLabel: 'Prompt text',
        promptEditTitle: 'Edit prompt',
        promptNewTitle: 'New prompt',
        promptLibraryEmpty: 'No prompts yet. Press “+ New prompt” above to create one.',
        promptSaved: 'Prompt saved',
        promptUpdated: 'Prompt updated',
        promptManage: 'Prompt library',
        promptSelectEmpty: 'This library has no entry of this kind yet.',
        promptClear: 'Clear',
        promptNewForKind: '+ New prompt',
        fModelPrompt: 'Model prompt (optional)',
        fModelPromptPh: 'e.g. 25-year-old Asian woman, long straight black hair, fair skin, tall, natural makeup',
        fBackgroundPrompt: 'Background prompt (optional)',
        fBackgroundPromptPh: 'e.g. city street at dusk, warm backlight, shallow depth of field, slight ground reflection',
        promptOnlyHint: 'These prompts can only be picked from the prompt library; create and edit them there.',
        promptOrphan: 'This prompt is not in the library (it came from a template or an older version), so no chip is highlighted. Save it to the library or clear it.',
        promptAdopt: 'Save to library',
        promptArchived: 'Saved to the prompt library',
        promptDupBlocked: 'This category already has an entry with exactly the same text. Edit that one or delete it first.',
        promptDraftBusy: 'An unsaved prompt is being edited — press Save or Cancel first.',
        promptDeleted: 'Prompt deleted',
        promptDeletedCleared: 'Prompt deleted; the studio field was cleared',
        promptLegacySuffix: ' (legacy)',
        promptMigrated: 'Existing studio prompts were imported into the prompt library',
        promptExport: 'Export',
        promptImport: 'Import',
        promptIOPortHint: 'Export saves the whole prompt library as one JSON file; Import adds it back on another machine or in another Harness and skips entries this library already has in the same category.',
        promptExported: 'Exported',
        promptCountUnit: ' prompts',
        promptExportEmpty: 'The prompt library is empty; nothing to export',
        promptExportFailed: 'Export failed: the browser blocked the download',
        promptImportDone: 'Imported',
        promptImportSkipped: ', skipped duplicate or invalid: ',
        promptImportInvalid: 'Import failed: this is not a valid prompt file (choose an exported JSON)',
        promptImportEmpty: 'This file contains no importable prompts',
        promptImportAllDup: 'Every prompt in the file is already in the library',
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
        poseGroupFront: 'Front',
        poseGroupSide: 'Side',
        poseGroupBack: 'Back',
        poseOrient: 'Orientation',
        poseOrientationHint: 'The group only changes how poses are listed in the studio; the action itself is unchanged',
    poseOrientAuto: 'detected from the title',
    poseOrientAutoHint: 'The title decides the group when it says front, side or back; rename it to move the action',
        poseNew: '+ New action',
        poseImport: 'Import',
        poseExport: 'Export',
        poseIOPortHint: 'Import or export actions as one JSON file so they can be reused on another machine; duplicates are skipped automatically.',
        poseExported: 'Actions exported',
        poseExportEmpty: 'The action library is empty; nothing to export',
        poseExportFailed: 'Export failed: the browser blocked the download, try again',
        poseImportDone: 'Actions imported',
        poseImportSkipped: '; skipped duplicates or invalid entries: ',
        poseImportInvalid: 'That file is not a valid actions JSON; check it and try again',
        poseImportEmpty: 'No actions in that file',
        poseImportAllDup: 'Every action in the file already exists',
        titleAuto: 'Auto-generate title',
        titleTitling: 'Generating…',
        titleNeedPrompt: 'Write the description first, then generate a title',
        titleAutoHint: 'Leave the title empty and saving generates one (max 15 characters)',
        fShow: 'Model framing',
        showHint: 'The selected framing replaces the composition segment at the start of the prompt with a single JSON block (never spliced into the text). The model may still drift slightly.',
        fExtraPrompt: 'Custom prompt (lighting / style)',
        fExtraPromptPh: 'e.g. soft rim light, warm tones, editorial mood, film grain',
        builtinPromptName: 'Strict product fidelity V2.4 (built-in · JSON)',
        builtinPromptsTitle: 'Built-in prompts',
        builtinPromptsHint: 'Built-in prompts are appended automatically while “Strict product fidelity” is on. The rules are a JSON block now (same style as the framing constraint, duplicate wording removed); edits are validated as JSON on save and can be restored to default at any time.',
        fidelityJsonInvalid: 'The fidelity rules must be a valid JSON object: check braces, quotes and commas',
        edit: 'Edit',
        restoreDefault: 'Restore default',
        fidelityModified: 'Customized',
        fidelityDefault: 'Default',
        strictFidelity: 'Strict product fidelity (built-in V2.4 · JSON)',
        strictFidelityHint: 'Appends the built-in fidelity JSON while a product reference is attached: color, fabric, cut, structure and details are locked; product accuracy beats visual polish',
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
        extractDone: 'Key elements extracted as JSON; edit as needed',
        extractEmpty: 'Nothing extracted; try a clearer product photo',
        visionBadgeBuiltin: 'Recognition: Harness built-in vision model',
        visionBadgeCustom: 'Recognition: third-party vision model',
        visionConfigure: 'Change recognition API',
        visionIncomplete: 'Recognition: the vision endpoint is incomplete (base URL or model missing)',
        lockHint: 'Recognition uses the strict 12-feature product lock; the result is written as JSON into the description and the generation prompt',
        fProductRef: 'Product reference (optional)',
        fProductRefHint: 'Multiple photos allowed (front/back/detail); sent as product references, the first one is the front view',
        fProductRefAdd: 'Upload product',
        productCount: 'uploaded',
        refsSavedHint: 'Saved automatically; cleared when removed',
        refsCount: 'references',
        remove: 'Remove',
        modeEdit: 'Image-to-image',
        modeText: 'Text-to-image',
        echoRetried: 'Gateway echoed the reference once; retried automatically and succeeded',
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
        errBalance: 'The API account is out of balance: top up on the provider side, or switch the profile in Settings.',
        errAuth: 'API authentication failed: check the API key is correct and not expired.',
        errRate: 'The API is rate-limited or the upstream is busy: retry later, or run fewer generations at once.',
        errTimeout: 'The API timed out: retry later, or switch to a faster endpoint.',
        queueStopped: 'Balance/auth error on the active API: remaining queued jobs were stopped. Fix it and generate again.',
        needKey: 'Set the API endpoint and key in Settings first.',
        needPrompt: 'Fill in the product description, pick a prompt from the library, or apply a template first.',
        resultTitle: 'Results',
        resultEmpty: 'Generated images appear here.',
        historyTitle: 'History',
        saveDir: 'Open output folder',
        profilesTitle: 'API profiles',
        profilesHint: 'Add several endpoints, give each a note, and click one to switch. Generation uses the profile marked CURRENT.',
        addProfile: '+ Add profile',
        deleteProfile: 'Delete this profile',
        confirmRemove: 'Click again to confirm',
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
        sQuality: 'Quality parameter (empty = omit)',
        sRequestType: 'Request type',
        sRequestTypeStream: 'Streaming (recommended)',
        sRequestTypeJson: 'Non-streaming',
        sRequestTypeHint: 'Streaming receives the image as it is produced and is more resilient on slow endpoints; a gateway that explicitly rejects streaming is retried once without it.',
        sOutput: 'Output folder',
        visionTitle: 'Product recognition model (optional)',
        visionHint: 'By default the Harness built-in vision model reads product photos and size charts. You can add several OpenAI-compatible vision endpoints and switch between them freely. Product recognition always carries the strict 12-feature product-lock rules.',
        visionBuiltinName: 'Harness built-in vision model (default)',
        visionBuiltinHint: 'Uses the current Harness model; no endpoint or key needed',
        visionAddProfile: '+ Add vision endpoint',
        visionDeleteProfile: 'Delete this vision endpoint',
        newVisionProfileName: 'Vision endpoint',
        visionBaseUrl: 'Endpoint',
        visionBaseUrlHint: 'OpenAI compatible, include /v1, e.g. https://api.openai.com/v1',
        visionModel: 'Model',
        visionModelHint: 'Must accept image input, e.g. gpt-4o-mini / qwen-vl-max / gemini-2.0-flash',
        needBaseUrl: 'Fill in the endpoint first, then fetch models',
        visionKey: 'Vision API key',
        visionUsingCustom: 'Using a third-party vision model',
        visionUsingBuiltin: 'Using the Harness built-in vision model',
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
        aboutBody: 'Personal workbench plugin: the Host half proxies the image API locally (the key stays in a local config file); the Client half renders this page. Product photos (up to 4) are sent in upload order as multiple references to /images/edits, the first one being the front view; without a product photo it uses text-to-image /images/generations. The model and the background are described in words only.',
        // Upload / queue / persistence wording (previously hardcoded Chinese)
        pickImageFormat: 'Choose a PNG / JPG / WebP image',
        refImageTooLarge: 'Reference photos must be under 8MB each',
        imageUnsupported: 'Unsupported image format',
        refPersistFailed: 'The product photos work for now but could not be saved:',
        productAddBusy: 'Still processing the previous batch — try again in a moment',
        productRemoveBusy: 'Still processing the previous batch — try again in a moment',
        productAlreadyAdded: 'Those photos are already in the product references',
        productRefsLimit: 'At most 4 product references: nothing was added, select fewer photos',
        extractStale: 'The photos changed, so this result was discarded — extract again',
        revealFailed: 'Could not open the folder',
        sizeChartTooLarge: 'The size-chart photo must be under 8MB',
        sizeChartUnreadable: 'Unrecognised image format',
        sizeChartNoTable: 'No size chart recognised — try a clearer screenshot',
        logoTooLarge: 'The logo must be under 5MB',
        logoPersistFailed: 'The logo works for now but could not be saved:',
        copyFailed: 'Copy failed — select the text manually',
        // Error normalisation: a Host `code` wins, otherwise status / message
        errMissingKey: 'The API profile is missing its key or endpoint: complete it in Settings.',
        errBodyTooLarge: 'The upload was too large for the API: use fewer reference photos or a lower resolution.',
        errInvalidReference: 'The API could not accept a reference photo: try another one (PNG / JPG, under 8MB).',
        errHostUnreachable: 'Cannot reach the local workbench service: make sure the plugin is loaded in Harness, then refresh.',
        errBadResponse: 'The API did not return valid JSON: check the endpoint points at an OpenAI-compatible service.',
        errProvider: 'The image API returned an error: retry later; if it keeps failing, check the endpoint and model or switch profiles.',
        errUnknown: 'Request failed',
        // Host error codes (the values used by wbError / sendError in index.js)
        errCrossSite: 'The request was rejected as cross-site: use the workbench page inside Harness.',
        errImageNotFound: 'That image no longer exists (it may have been cleaned up): refresh the list and try again.',
        errInvalidImageName: 'That image file name is not allowed: rename the file and upload it again.',
        errInvalidJson: 'The request body was not valid JSON (internal plugin error): refresh the page and try again.',
        errInvalidRefName: 'That reference file name is not allowed: rename the file and upload it again.',
        errMethodNotAllowed: 'The endpoint rejected this request method (client and Host versions differ): update the plugin and try again.',
        errMissingReference: 'No usable reference photo: upload the product photos again and retry.',
        errNoImage: 'The API reported success but returned no image: retry, or switch to another model or endpoint.',
        errOutputDir: 'The output folder is not writable: pick another folder in Settings, or check its permissions.',
        errRefNotFound: 'That reference photo is gone (it may have been cleaned up): upload it again.',
        errReferenceCount: 'Too many reference photos: remove some and retry.',
        errReferenceEchoed: 'The API echoed the reference photo back instead of generating: retry, or switch to a model that supports image editing.',
        errReferenceTooLarge: 'One reference photo is too large: compress it or use a smaller image and retry.',
        errReferenceTotalSize: 'The reference photos exceed the total size limit: use fewer or smaller images.',
        errRevealOutside: 'Only files inside the output folder can be opened.',
        errSettingsCorrupt: 'The local settings file is unreadable and saving is paused: fix it or restore the .bak backup.',
        errPromptTooLong: 'The prompt is too long: shorten the product description or the prompt and try again.',
        errOpenFailed: 'The output folder could not be opened: check that it still exists, or open it yourself.',
        errDirNotFound: 'The output folder is missing or not a folder: pick another one in Settings, or create it.',
        errMissingDir: 'No save folder selected: choose one under “Save folder” first.',
        errMissingImage: 'The poster is empty: wait for the preview and try again.',
        errRefOutsideDir: 'That reference file is outside the allowed reference folder: upload it again.',
        queueDuplicate: 'The same job is already queued or running — wait for it to finish.',
        queueRetry: 'Retry',
        storeQuota: 'Local storage is full, so settings were not saved (this session still works): free browser storage and try again.',
        storeUnavailable: 'Browser storage is unavailable, so settings were not saved (this session still works).',
        close: 'Close',
      },
    }

    // ------------------------------------------------------------- constants
    // Model framing is fixed to a crop at the neck: the head is always outside
    // the frame. The rule is written into the prompt as ONE JSON block that
    // replaces the old composition paragraph - it is not a comma-spliced prose
    // clause and it is not repeated at the tail.
    const SHOW = [
      {
        id: 'neck', zh: '从脖子处裁切', en: 'crop at neck',
        rules: {
          模特展示: '从脖子处裁切',
          取景: '画面顶部从模特颈部开始，头部完全位于画面之外',
          必定出现: ['颈部', '肩部', '胸部', '腰部', '臀部', '双腿', '商品裤子（腰头、门襟、口袋、裤腿与裤脚）'],
          画面之外绝不出现: ['头部', '面部', '五官', '眼睛', '鼻子', '嘴巴', '耳朵', '头发', '头顶', '额头', '下巴'],
          // Without an explicit occupancy the model keeps headroom "just in case",
          // which is the other way a head sneaks back into a neck crop.
          人物占比: '颈部到裤脚占满画面高度，画面顶部不留多余空间',
          商品完整性: '商品从腰头到裤脚完整入镜，不被裁切或遮挡',
        },
      },
    ]
    // All ratios are available at 1K / 2K / 4K; the resolution chip below the
    // aspect chips selects which size table is used for the request.
    const RATIOS = [
      {
        id: 'square', zh: '方形 1:1', en: 'Square 1:1',
        sizes: { '1k': '1024x1024', '2k': '2048x2048', '4k': '4096x4096' },
      },
      {
        id: 'portrait', zh: '竖版 3:4', en: 'Portrait 3:4',
        sizes: { '1k': '768x1024', '2k': '1536x2048', '4k': '3072x4096' },
      },
      {
        id: 'landscape', zh: '横版 4:3', en: 'Landscape 4:3',
        sizes: { '1k': '1024x768', '2k': '2048x1536', '4k': '4096x3072' },
      },
      {
        id: 'portrait-9-16', zh: '竖版 9:16', en: 'Portrait 9:16',
        sizes: { '1k': '576x1024', '2k': '1152x2048', '4k': '2304x4096' },
      },
      {
        id: 'landscape-16-9', zh: '横版 16:9', en: 'Landscape 16:9',
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
      // Number(null) === 0: a blank/missing waist must read as "no suggestion",
      // not extrapolate below the first sample and print negative weights.
      if (!Number.isFinite(value) || value <= 0) return null
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


    /** Size-chart cell text round-trips through the input: blank -> null, a
     *  partial numeric text kept exactly ("72.", "-"), invalid text ignored. */
    function normalizeSizeCellText(text) {
      const normalized = String(text === undefined || text === null ? '' : text).replace(',', '.').trim()
      if (normalized !== '' && !/^-?\d*(?:\.\d*)?$/.test(normalized)) return undefined
      return normalized === '' ? null : normalized
    }


    /**
     * Built-in strict product-fidelity module (V2.4, highest priority).
     * Appended to every prompt while the studio toggle stays on, so the model is
     * forced to reproduce the exact uploaded product instead of a look-alike.
     * V2.4 is ONE JSON block, the same way the framing constraint is written, and
     * every rule appears exactly once: the old prose repeated "be faithful" and
     * "do not redesign" in five places, which cost tokens without adding meaning.
     */
    const FIDELITY_RULES = {
      '保真规则': '商品严格保真 V2.4',
      '优先级': '最高：商品保真是硬约束，优先于模特动作、服装搭配、摄影光影与画面美观度',
      '唯一依据': '商品参考图（文字描述只补充细节，冲突时以参考图为准）',
      '商品身份': {
        '必须': '生成与参考图同一件商品，不是相似款式或重新设计，全部可辨认设计细节尽可能准确还原',
        '禁止': ['替换商品', '增删、移动、合并、复制、镜像、简化既有特征或结构'],
      },
      '颜色与面料': {
        '保持': [
          '色相、饱和度与配色分布',
          '面料材质、厚薄与光泽',
          '织纹方向、粗细、密度与排列规律',
          '原始水洗位置、褪色范围、磨白痕迹、磨损分布与颜色深浅关系',
        ],
        '允许': '真实光照产生的自然明暗、阴影与高光',
        '禁止': ['偏色', '更换材质', '重绘纹理', '虚构水洗或磨损', '过度平滑', '过度锐化'],
      },
      '版型与比例': {
        '保持': [
          '腰、臀、裆、大腿、膝、小腿、裤脚之间的结构比例与宽松程度',
          '裤型轮廓、裤腿宽度、裤长、裤脚开口与整体垂坠',
        ],
        '禁止': ['收窄、加宽、拉长或缩短', '改变原始裁剪结构'],
      },
      '结构拓扑': {
        '保持': [
          '腰头、腰带袢、纽扣、门襟、口袋、拼接布片、缝线、五金的数量、形状、连接关系与相对位置',
          '几何拼接的线条走向、拐角形状与结构比例',
          '各结构与设计细节相对腰头、口袋、裆部、膝部、裤脚的位置关系不变',
        ],
        '禁止': ['新增', '删除', '移动', '合并', '复制', '镜像', '简化'],
      },
      '特殊设计': {
        '范围': '仅还原参考图中真实存在的破洞、刺绣、印花、拼布、条纹、铆钉等',
        '保持': ['数量、位置、尺寸比例、轮廓形状、颜色与相互对应关系', '破洞的原始边缘磨损、内部可见材质与轮廓'],
        '禁止': ['重新设计', '遗漏', '虚构', '数量、位置或镜像关系与参考图不符'],
      },
      '多参考图': {
        '分工': {
          '正面图': '确定正面设计',
          '侧面图': '补充侧面结构',
          '背面图': '确定背面设计',
          '完整图': '确定整体版型与结构比例',
          '局部特写': '补充可辨认细节',
        },
        '顺序': '按上传顺序优先：第 1 张视为正面主图，其后依次视为侧面、背面与细节图；无法判断角色时以第 1 张为准',
        '禁止': ['不同视角的结构被错误镜像、交换或混合', '背面专属设计出现在正面', '正面专属设计出现在背面', '缺少关键视角时虚构不可见的商品设计'],
      },
      '真实穿着': {
        '要求': '商品自然穿着于人体，符合人体支撑、面料重量、重力与服装物理规律',
        '允许': ['自然褶皱', '局部张力', '合理垂坠', '符合原始裤型的裤脚堆积', '符合原始版型的合理形变', '真实穿着造成的透视变化与面料弯曲'],
        '区分': '永久设计（水洗、破洞、拼接）与穿着产生的临时褶皱必须区分',
        '禁止': ['用褶皱遮挡、移动、扭曲或改变关键结构', '面料悬浮', '穿模', '异常拉伸', '结构错位', '违反重力规律的变形'],
      },
      '完整展示': {
        '取景': '裤腰最顶部至裤脚最底部完整入镜',
        '清晰': ['腰头、纽扣、腰带袢、门襟、口袋', '商品主要设计结构'],
        // Poses assign the hands, and "one hand in the pocket" is a normal pose that
        // necessarily covers a pocket. Forbidding all hand occlusion fought the pose
        // text, so only a large deliberate block is forbidden now.
        '禁止': ['用上衣、手袋或道具大面积遮挡关键结构', '刻意用手掌捂住腰头、门襟或裤脚导致结构不可辨认', '为构图而裁切、隐藏或修改主要设计'],
        '允许': ['手插兜、手扶裤缝、手拿手机等自然姿态造成的局部遮挡'],
      },
    }
    // Compact in the prompt (one short line, like the framing block) but pretty
    // in the editor, so the block stays cheap to send and still editable by hand.
    const FIDELITY_MODULE = JSON.stringify(FIDELITY_RULES)
    // V2.3 as it shipped before V2.4 relaxed the hand-occlusion ban and added the
    // reference-photo order rule. A stored copy that still matches it character for
    // character was never edited, so it is upgraded instead of pinning the wording
    // that fought the poses.
    const LEGACY_FIDELITY_V23 = (() => {
      const copy = JSON.parse(JSON.stringify(FIDELITY_RULES))
      // The version label is part of the stored string: without putting it back the
      // rebuilt copy differs by one character and would never match real user data.
      copy['保真规则'] = '商品严格保真 V2.3'
      delete copy['多参考图']['顺序']
      copy['完整展示']['禁止'] = ['上衣、手部、配饰或其他物体遮挡关键结构', '为构图而裁切、隐藏或修改主要设计']
      delete copy['完整展示']['允许']
      return JSON.stringify(copy)
    })()
    // V2.2 was prose. A stored copy that still matches it was never edited, so it
    // is upgraded to the current version instead of pinning the old wording forever.
    const LEGACY_FIDELITY_MODULE = [
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
      show: 'neck',
      // A neck-to-ankle product shot cannot fit in a square: the model shrinks the
      // figure to make room, which is how a head creeps back into a "neck crop". A
      // vertical frame is the honest default for this framing.
      ratio: 'portrait',
      resolution: '2k',
      desc: '',
      modelPrompt: '',
      backgroundPrompt: '',
      extraPrompt: '',
      strictFidelity: true,
      // No face is in frame, so "distorted face" would be a ban on something that
      // cannot exist; and a street scene legitimately contains shop-sign text, so
      // the blanket ban on 文字 is written as "overlaid text / watermark" instead.
      negative: '模糊、低清晰度、噪点、压缩痕迹、叠加文字与水印、多余手指、变形的手、多手多脚、严重畸变、背景错乱、背景杂乱、人物与背景融合、穿模、画面透灰不清晰、雾面、过曝、欠曝、色彩失真、偏色、材质错误、商品变形、过度锐化、塑料感',
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

    /** Requested image size is always derived from the selected aspect ratio and
     *  resolution (there is no stored default size any more). */
    function resolveOutputSpec(form) {
      const ratio = findOption(RATIOS, form.ratio)
      const resolution = findOption(RESOLUTIONS, form.resolution)
      const raw = (ratio.sizes && ratio.sizes[resolution.id]) || ratio.sizes['2k'] || ''
      const [width, height] = String(raw).split('x')
      return { ratio, resolution, size: raw, width, height }
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

    /**
     * Writes one preference. The result is returned instead of swallowed: a full
     * profile (QuotaExceededError) or disabled storage (SecurityError) means the
     * choice only lives in this session, and the user has to be told once.
     * @returns {{ok: boolean, error: Error|null}}
     */
    function saveJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error || new Error('storage unavailable') }
      }
    }

    /** Which STR key explains a failed write: full storage vs. no storage. */
    function storageErrorStringKey(error) {
      const name = String((error && error.name) || '')
      const code = Number((error && error.code) || 0)
      // Chrome/Safari use QuotaExceededError (22 / 1014 in Firefox).
      if (/quota/i.test(name) || code === 22 || code === 1014) return 'storeQuota'
      return 'storeUnavailable'
    }

    /** The saved accent is a chip id; anything else would leave the settings page
     *  with no chip highlighted, so an unknown value falls back to the default. */
    function loadAccentId() {
      const saved = loadJson(LS_ACCENT, null)
      const id = saved && typeof saved.id === 'string' ? saved.id.trim() : ''
      return ACCENTS.some(accent => accent.id === id) ? id : 'default'
    }

    /**
     * Normalises a persisted size poster. A hand-edited/corrupted entry used to
     * reach the poster canvas and the editable table unchanged (a null column or
     * a row without `values` threw during render and the error boundary replaced
     * the whole workbench), so every field is checked here and a bad cell is
     * dropped instead of taking the page down.
     * @returns {{columns: Array, rows: Array, weightUnit: string}|null}
     */
    function normalizeSizeChart(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const columns = []
      const seenKeys = new Set()
      for (const column of Array.isArray(value.columns) ? value.columns : []) {
        if (!column || typeof column !== 'object') continue
        const name = typeof column.name === 'string' ? column.name.trim() : ''
        if (!name) continue
        let key = typeof column.key === 'string' ? column.key.trim() : ''
        if (!key || seenKeys.has(key)) key = `c${columns.length}`
        seenKeys.add(key)
        columns.push({ key, name })
      }
      if (columns.length === 0) return null
      const knownKeys = columns.map(column => column.key)
      const rows = []
      const seenIds = new Set()
      for (const row of Array.isArray(value.rows) ? value.rows : []) {
        if (!row || typeof row !== 'object') continue
        let id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `row-${rows.length}`
        if (seenIds.has(id)) id = `row-${rows.length}-${seenIds.size}`
        seenIds.add(id)
        const size = typeof row.size === 'string' ? row.size : row.size === null || row.size === undefined ? '' : String(row.size)
        const values = {}
        const savedValues = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? row.values : {}
        for (const key of knownKeys) {
          const cell = savedValues[key]
          if (cell === null || cell === undefined || cell === '') continue
          // Only scalars can be measured, printed on the poster and shown in the
          // cell input; a nested object/array/boolean is dropped.
          if (typeof cell === 'string') values[key] = cell
          else if (typeof cell === 'number' && Number.isFinite(cell)) values[key] = cell
        }
        rows.push({ id, size, values })
      }
      if (rows.length === 0) return null
      return { columns, rows, weightUnit: value.weightUnit === 'jin' ? 'jin' : 'kg' }
    }

    /** The persisted poster, or null when there is nothing usable to restore. */
    function loadSizePoster() {
      return normalizeSizeChart(loadJson(LS_SIZEPOSTER, null))
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
        // The browser could not decode the picked file: reported through the same
        // code path as an unsupported image instead of pasting the DOMException.
        reader.onerror = () => reject(apiError('unreadable-image', 0, 'read failed', reader.error))
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

    // Injected at the very front of the product description: the uploaded
    // reference photo is the only authoritative source, the description is
    // only a supplemental cross-check and must never be used to generate,
    // modify or infer the product on its own.
    const PRODUCT_DESC_PREFIX = '用户上传的真实商品参考图是商品款式（颜色、面料、结构与版型）的唯一权威依据：描述里关于这些的文字只用于补充与交叉验证，冲突时以参考图为准，禁止虚构、增删或改变商品原始设计；而模特动作、背景环境与光线等描述照常生效。'

    // Notes written at the front of the description by older versions. Saved
    // descriptions and templates still contain them, so they are replaced by
    // the current wording instead of stacking two contradictory notes.
    const LEGACY_DESC_PREFIXES = [
      '上传的商品参考图为最高优先级，本段只做细节补充验证，严禁直接使用本段描述直接生成。',
    ]

    const DESC_PREFIXES = [PRODUCT_DESC_PREFIX].concat(LEGACY_DESC_PREFIXES)

    /** Returns the known note found at the very front of the text, if any. */
    function descPrefixAt(value) {
      for (const prefix of DESC_PREFIXES) {
        if (value.indexOf(prefix) === 0) return prefix
      }
      return ''
    }

    /** Length of the longest shared beginning with a known note, used to
     *  recognise a partially deleted note (e.g. the user removed its tail). */
    function damagedDescPrefixLength(value) {
      let shared = 0
      for (const prefix of DESC_PREFIXES) {
        let length = 0
        while (length < prefix.length && length < value.length && value.charAt(length) === prefix.charAt(length)) {
          length += 1
        }
        if (length > shared) shared = length
      }
      return shared
    }

    /** Adds the reference-first note. A note already at the front - including
     *  the one saved by an older version - is replaced by the current wording,
     *  never duplicated. */
    function withDescPrefix(text) {
      const value = String(text || '').trim()
      if (!value) return ''
      if (value.indexOf(PRODUCT_DESC_PREFIX) === 0) return value
      const body = stripDescPrefix(value)
      if (body !== value) return body ? `${PRODUCT_DESC_PREFIX}\n${body}` : PRODUCT_DESC_PREFIX
      const shared = damagedDescPrefixLength(value)
      if (shared >= 6) {
        const rest = value.slice(shared).replace(/^\s+/, '')
        return rest ? `${PRODUCT_DESC_PREFIX}\n${rest}` : PRODUCT_DESC_PREFIX
      }
      return `${PRODUCT_DESC_PREFIX}\n${value}`
    }

    /** Removes every known reference-first note from the front. */
    function stripDescPrefix(text) {
      let value = String(text || '').trim()
      let prefix = descPrefixAt(value)
      while (prefix) {
        value = value.slice(prefix.length).replace(/^\s+/, '')
        prefix = descPrefixAt(value)
      }
      return value.trim()
    }

    /** Replaces an old note at the front with the current wording while keeping
     *  the body byte-for-byte; used on load before the photo set is known. */
    function upgradeLegacyDescNote(text) {
      const value = String(text || '')
      for (const legacy of LEGACY_DESC_PREFIXES) {
        if (value.indexOf(legacy) === 0) {
          return PRODUCT_DESC_PREFIX + value.slice(legacy.length)
        }
      }
      return text
    }

    // The 12 dimensions the vision model reports; recognition results are kept
    // as a JSON object with these keys (the Host normalises the model answer).
    const PRODUCT_DESC_LABELS = [
      '颜色',
      '面料材质',
      '整体版型',
      '尺寸比例',
      '腰头结构',
      '门襟结构',
      '口袋结构',
      '缝线与拼接',
      '水洗与磨损',
      '特殊设计',
      '裤腿与裤脚',
      '结构相对位置',
    ]

    /** Returns the description body as JSON. A JSON body is kept verbatim; an
     *  older recognition result saved as 「维度：描述」 lines is upgraded to JSON
     *  so descriptions extracted before the JSON format existed do not need a
     *  new (paid) vision call. Manual prose descriptions are left untouched. */
    function normalizeDescriptionBody(text) {
      let body = stripDescPrefix(text)
      if (!body) return ''
      const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
      if (fenced) body = fenced[1].trim()
      if (!body) return ''
      if (body.charAt(0) === '{') return body
      const entries = []
      for (const line of body.split(/\r?\n/)) {
        const match = line.trim().match(/^([^：:]{1,24})[：:]\s*(.+)$/u)
        if (match) entries.push({ key: match[1].trim(), value: match[2].trim() })
      }
      // Only a recognisable legacy recognition result (most of the 12 dimensions
      // present) is upgraded; hand-written structured notes stay untouched.
      if (entries.filter(entry => PRODUCT_DESC_LABELS.indexOf(entry.key) >= 0).length < 8) return body
      const object = {}
      for (const label of PRODUCT_DESC_LABELS) {
        const found = entries.find(entry => entry.key === label)
        object[label] = found ? found.value : '无法判断'
      }
      for (const entry of entries) {
        if (PRODUCT_DESC_LABELS.indexOf(entry.key) < 0 && !Object.prototype.hasOwnProperty.call(object, entry.key)) {
          object[entry.key] = entry.value
        }
      }
      return JSON.stringify(object, null, 2)
    }

    function loadForm() {
      const saved = loadJson(LS_FORM, {})
      const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
      const merged = { ...DEFAULT_FORM, ...source }
      // Coerce persisted values: buildPrompt calls .trim() on the text fields and
      // the chips assume known ids, so a hand-edited/corrupted localStorage entry
      // must not be able to crash the whole workbench page.
      for (const key of ['desc', 'modelPrompt', 'backgroundPrompt', 'extraPrompt', 'negative']) {
        if (typeof merged[key] !== 'string') merged[key] = DEFAULT_FORM[key]
      }
      // A description saved by an older version starts with the previous
      // reference note: swap in the current wording right away so the removed
      // sentence cannot linger in the description field.
      if (merged.desc) merged.desc = upgradeLegacyDescNote(merged.desc)
      if (typeof merged.pose !== 'string') merged.pose = ''
      if (!RATIOS.some(item => item.id === merged.ratio)) merged.ratio = DEFAULT_FORM.ratio
      if (!RESOLUTIONS.some(item => item.id === merged.resolution)) merged.resolution = DEFAULT_FORM.resolution
      if (!SHOW.some(item => item.id === merged.show)) merged.show = DEFAULT_FORM.show
      merged.strictFidelity = merged.strictFidelity !== false
      merged.includeNegative = merged.includeNegative === true
      // Upgrade an untouched old negative prompt to the expanded Chinese one
      // unless the user has customised it.
      if (merged.negative === LEGACY_NEGATIVE || merged.negative === LEGACY_NEGATIVE_ZH_V1) {
        merged.negative = DEFAULT_FORM.negative
      }
      // Built-in poses were removed; an old built-in id no longer has a chip.
      if (LEGACY_POSES.indexOf(merged.pose) >= 0) merged.pose = ''
      return merged
    }

    /** Persisted collections are filtered so a bad entry cannot break rendering. */
    // ------------------------------------------------------------ pose groups
    // Custom actions carry an orientation so the studio can list them under
    // 正面 / 侧面 / 背面. Entries saved before this field existed have it guessed
    // from the name + description; the guess is stored on the next save.
    const POSE_ORIENTATIONS = ['front', 'side', 'back']
    const POSE_ORIENTATION_ALIASES = {
      front: 'front', 正面: 'front', 正: 'front', frontview: 'front', facingcamera: 'front',
      side: 'side', 侧面: 'side', 侧: 'side', sideview: 'side', profile: 'side', threequarter: 'side',
      back: 'back', 背面: 'back', 背: 'back', backview: 'back', rear: 'back',
    }
    // Unambiguous back-facing wording wins first (「背部正对镜头」 mentions 正对 but is
    // a back view), then front, then side, so "正面微侧身" is front and not side.
    // 背后 alone is not enough: a description may say "正面站立，背后是海景", so it
    // only counts together with a viewing cue (看/拍/镜头/机位/观众/视角).
    const POSE_ORIENTATION_TESTS = [
      [
        'back',
        /背(对|向)|背影|背(面|部)?正对|背部朝|背面朝|背后(看|拍|的?镜|机位|观众)|背(面|后)(有|的)?(视角|机位|观众|镜头)|后方(有|的)?(视角|机位|观众)|from the back|rear view|back view/i,
      ],
      ['front', /正面|正身|正对镜头|面向镜头|front view|facing (the )?camera/i],
      ['side', /侧面|侧身|侧对|侧向|three[- ]?quarter|side view|profile/i],
    ]
    // The name is the stronger signal (a description may mention 背部 as a body
    // part), so a bare 背面/侧身 in the name is enough there.
    const POSE_NAME_TESTS = [
      ['front', /正(面|身)|正对|front/i],
      ['back', /背(面|部|后)|背对|背向|背影|back/i],
      ['side', /侧(面|身|对|向)|side|profile/i],
    ]

    function guessPoseOrientation(text, tests) {
      const source = String(text || '')
      if (!source) return ''
      for (const [id, pattern] of tests) {
        if (pattern.test(source)) return id
      }
      return ''
    }

    function poseOrientationOf(value) {
      // The title is the user's own label, so an orientation written in it wins
      // over the stored field: renaming 「正面站姿」 to 「背对镜头站立」 re-groups the
      // action without any extra step. Only a title that says nothing about the
      // direction falls back to the stored value, then to the description.
      const fromName = guessPoseOrientation(value && value.name, POSE_NAME_TESTS)
      if (fromName) return fromName
      const raw = String((value && value.orientation) || '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
      if (raw && POSE_ORIENTATION_ALIASES[raw]) return POSE_ORIENTATION_ALIASES[raw]
      return guessPoseOrientation(value && value.prompt, POSE_ORIENTATION_TESTS) || 'front'
    }

    function groupPoses(poses) {
      const byId = new Map(POSE_ORIENTATIONS.map(id => [id, []]))
      for (const item of poses || []) {
        const bucket = byId.get(poseOrientationOf(item))
        if (bucket) bucket.push(item)
      }
      return POSE_ORIENTATIONS
        .map(id => ({ id, items: byId.get(id) || [] }))
        .filter(group => group.items.length > 0)
    }

    function loadPoses() {
      const value = loadJson(LS_POSES, [])
      return (Array.isArray(value) ? value : [])
        .filter(item => (
          item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.prompt === 'string'
        ))
        .map(item => ({ ...item, orientation: poseOrientationOf(item) }))
    }

    function loadTemplates() {
      const value = loadJson(LS_TEMPLATES, [])
      return (Array.isArray(value) ? value : []).filter(item => (
        item && typeof item.id === 'string' && typeof item.name === 'string' && item.form && typeof item.form === 'object'
      )).map(item => ({ ...item, form: { ...item.form } }))
    }

    function loadReusablePrompts() {
      const value = loadJson(LS_PROMPTS, [])
      return (Array.isArray(value) ? value : []).filter(item => (
        item && typeof item.id === 'string' && typeof item.text === 'string'
      )).map(item => ({ ...item, kind: item.kind || 'style' }))
    }

    // -------------------------------------------------- prompt import/export
    // The prompt library is the only place prompts are authored, so it is also
    // the unit that moves between machines: one JSON file, one click each way.
    // Ids are local bookkeeping and never travel; a prompt is identified by its
    // kind plus its exact text, which is also what the duplicate guard uses.
    const PROMPT_EXPORT_FORMAT = 'personal-workbench.prompt-library'
    const PROMPT_EXPORT_VERSION = 1
    const PROMPT_KIND_ALIASES = {
      model: 'model', scene: 'scene', style: 'style',
      models: 'model', backgrounds: 'scene', background: 'scene',
      modelprompt: 'model', backgroundprompt: 'scene', extraprompt: 'style',
      '模特': 'model', '背景': 'scene', '风格': 'style', '自定义': 'style',
      '模特提示词': 'model', '背景提示词': 'scene', '风格提示词': 'style', '自定义提示词': 'style',
    }

    function normalizePromptKind(kind) {
      const key = String(kind == null ? '' : kind).trim().toLowerCase()
      return PROMPT_KIND_ALIASES[key] || 'style'
    }

    function promptEntryText(item) {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      const raw = [item.text, item.prompt, item.content, item.value].find(value => typeof value === 'string')
      return String(raw || '').trim()
    }

    function promptEntryName(item, text) {
      if (item && typeof item === 'object') {
        const name = [item.name, item.title, item.label].find(value => typeof value === 'string' && value.trim())
        if (name) return name.trim()
      }
      return text.slice(0, 16)
    }

    /** Snapshot of the whole library as one portable JSON payload. */
    function buildPromptExport(prompts, now) {
      const list = (Array.isArray(prompts) ? prompts : [])
        .map(item => {
          const text = promptEntryText(item)
          if (!text) return null
          return { name: promptEntryName(item, text), kind: normalizePromptKind(item && item.kind), text }
        })
        .filter(Boolean)
      return {
        app: PROMPT_EXPORT_FORMAT,
        version: PROMPT_EXPORT_VERSION,
        exportedAt: new Date(now || Date.now()).toISOString(),
        count: list.length,
        prompts: list,
      }
    }

    /** Accepted payload shapes: our export, a bare list, or a wrapped list. */
    function promptImportList(payload) {
      if (Array.isArray(payload)) return payload
      if (!payload || typeof payload !== 'object') return null
      for (const key of ['prompts', 'items', 'entries', 'data']) {
        if (Array.isArray(payload[key])) return payload[key]
      }
      return null
    }

    /**
     * Reads an exported file back into library entries. Anything already in the
     * library with the same kind + text is skipped instead of duplicated.
     * @returns {{ok: boolean, entries: Array, duplicates: number, invalid: number}}
     */
    function parsePromptImport(raw, existing) {
      const failed = { ok: false, entries: [], duplicates: 0, invalid: 0 }
      let payload = raw
      if (typeof raw === 'string') {
        try {
          payload = JSON.parse(raw)
        } catch {
          return failed
        }
      }
      const list = promptImportList(payload)
      if (!list) return failed
      const seen = new Set()
      for (const item of Array.isArray(existing) ? existing : []) {
        const text = promptEntryText(item)
        if (text) seen.add(`${normalizePromptKind(item && item.kind)}\u0000${text}`)
      }
      const entries = []
      let duplicates = 0
      let invalid = 0
      const stamp = Date.now().toString(36)
      for (const item of list) {
        const text = promptEntryText(item)
        if (!text) {
          invalid += 1
          continue
        }
        const kind = normalizePromptKind(item && item.kind)
        const key = `${kind}\u0000${text}`
        if (seen.has(key)) {
          duplicates += 1
          continue
        }
        seen.add(key)
        entries.push({
          id: `pr-${stamp}${entries.length}${Math.random().toString(36).slice(2, 5)}`,
          kind,
          name: promptEntryName(item, text),
          text,
        })
      }
      return { ok: true, entries, duplicates, invalid }
    }

    function promptExportFilename(now) {
      const date = new Date(now || Date.now())
      const pad = value => String(value).padStart(2, '0')
      return `prompts-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
    }

    /** Saves text as a download; false when the environment cannot offer one. */
    function downloadTextFile(filename, text, mime) {
      try {
        if (typeof Blob !== 'function' || typeof document === 'undefined') return false
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
        const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }))
        const link = document.createElement('a')
        if (!link) return false
        link.href = url
        link.download = filename
        if (typeof link.click === 'function') link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 2000)
        return true
      } catch {
        return false
      }
    }

    function readBlobAsText(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('read failed'))
        reader.readAsText(blob)
      })
    }

    // ------------------------------------------------------------- auto titles
    // A saved action or prompt needs a short title, but typing one is busywork:
    // the host asks its text model to summarise the description into ≤15 chars.
    const TITLE_MAX_CHARS = 15

    function clipTitle(value) {
      let text = String(value || '').replace(/\s+/g, ' ').trim()
      // Only *wrapping* quote marks are noise from the model; brackets inside a
      // name such as 【城市街头实景｜详细版】 are meaningful and stay.
      const pairs = [['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"], ['`', '`']]
      // Quotes and trailing punctuation nest in either order (“标题”。 vs “标题。”),
      // so both are peeled alternately until the text stops changing. This has to
      // match the host's `sanitizeTitle`, or the two halves disagree on the result.
      for (let pass = 0; pass < 3; pass += 1) {
        const before = text
        for (const [open, close] of pairs) {
          if (text.length > 1 && text[0] === open && text[text.length - 1] === close) {
            text = text.slice(1, -1).trim()
          }
        }
        text = text.replace(/[。，、；：！？.!?;:…]+$/, '').trim()
        if (text === before) break
      }
      return Array.from(text).slice(0, TITLE_MAX_CHARS).join('')
    }

    /** A description pasted from another tool often carries its own name already
     *  (`"动作名称": "正面微侧身持手机自然站姿"`); that field is the most accurate
     *  title, so it is used verbatim before anything is derived or asked for.
     *  Mirrors the host: keys need a left boundary, and the ASCII keys take no
     *  whitespace boundary so `job title:` / `subtitle:` cannot match. */
    const TITLE_FIELD_VALUE = '([^"“”\'，,。;；\\n\\r}]{2,40})'
    const TITLE_FIELD_CJK = new RegExp(
      `(?:^|[\\s{,;、。，（(["“”'])["“”']?(?:动作名称|姿势名称|姿态名称|动作标题|标题|名称)["“”']?\\s*[:：=]\\s*["“”']?${TITLE_FIELD_VALUE}`,
      'i',
    )
    const TITLE_FIELD_ASCII = new RegExp(
      `(?:^|[{,;、。，（(["“”'])["“”']?(?:pose[ _-]?name|title)["“”']?\\s*[:：=]\\s*["“”']?${TITLE_FIELD_VALUE}`,
      'i',
    )
    function titleFromField(text) {
      const source = String(text || '')
      const match = TITLE_FIELD_CJK.exec(source) || TITLE_FIELD_ASCII.exec(source)
      if (!match) return ''
      return clipTitle(match[1].replace(/\\+/g, ' ').replace(/\s+/g, ' ').trim())
    }

    // Labels that name a block rather than an action: a clause made only of these
    // is skipped instead of becoming the title (mirrors the host).
    const TITLE_LABEL_PATTERN = /^(构图约束|构图|保真规则|保真|规则|约束|要求|参考图名称|参考图|参考|元数据|标签|占位|备注|名称|标题)/
    function peelTitleLabel(clause) {
      let base = String(clause || '').replace(/^[^\u4e00-\u9fff]+/, '').trim()
      for (let pass = 0; pass < 4 && base && TITLE_LABEL_PATTERN.test(base); pass += 1) {
        const next = base.replace(TITLE_LABEL_PATTERN, '').replace(/^[^\u4e00-\u9fff]+/, '').trim()
        if (!next) return ''
        if (next === base) break
        base = next
      }
      return base
    }

    /** Offline fallback: the first clause, squeezed into the same 15 characters.
     *  Mirrors the host's `fallbackTitle`: JSON blocks go entirely, bracket shells
     *  are removed but their content stays, and clauses that are only a label such
     *  as 「构图约束」/「参考图名称」 are skipped so they never become the title. */
    function localTitle(text, kind) {
      const named = titleFromField(text)
      if (named) return named
      let flat = String(text || '')
      for (let pass = 0; pass < 3 && flat.indexOf('{') >= 0; pass += 1) {
        const next = flat.replace(/\{[^{}]*\}/g, ' ')
        if (next === flat) break
        flat = next
      }
      flat = flat
        .replace(/[{}"[\]]/g, ' ')
        .replace(/[【】《》（）「」『』]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      let base = ''
      for (const clause of flat.split(/[。，、；：！？.!?;:]/)) {
        const peeled = peelTitleLabel(clause)
        if (peeled) {
          base = peeled
          break
        }
      }
      return clipTitle(base) || (kind === 'prompt' ? '未命名提示词' : '未命名动作')
    }

    /** Never throws: a missing title must not block saving, so any failure falls
     *  back to the local cut instead of surfacing an error. */
    async function requestTitle(text, kind) {
      const source = String(text || '').trim()
      if (!source) return ''
      try {
        const json = await api('/title', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: source, kind: kind === 'prompt' ? 'prompt' : 'pose' }),
        })
        return clipTitle(json && json.title) || localTitle(source, kind)
      } catch {
        return localTitle(source, kind)
      }
    }

    // ----------------------------------------------------- pose import/export
    // Actions travel as one JSON file, mirroring the prompt library. Ids never
    // leave the machine; an action is identified by orientation + name + text.
    const POSE_EXPORT_FORMAT = 'personal-workbench.pose-library'
    const POSE_EXPORT_VERSION = 1

    function poseEntryText(item) {
      if (!item) return ''
      const value = item.prompt !== undefined ? item.prompt : (item.text !== undefined ? item.text : item.content)
      return typeof value === 'string' ? value.trim() : ''
    }

    function poseEntryName(item, text) {
      const name = item && typeof item.name === 'string' ? item.name.trim() : ''
      return name || String(text || '').slice(0, 16)
    }

    // Dedupe key must derive the name exactly like `parsePoseImport` does, or a
    // nameless stored action would be imported a second time.
    function poseImportKey(item) {
      const text = poseEntryText(item)
      return `${poseOrientationOf(item)}\u0000${poseEntryName(item, text).slice(0, 80)}\u0000${text}`
    }

    function buildPoseExport(poses) {
      return {
        app: POSE_EXPORT_FORMAT,
        version: POSE_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        count: (poses || []).length,
        poses: (poses || []).map(item => ({
          name: item.name,
          orientation: poseOrientationOf(item),
          prompt: item.prompt,
        })),
      }
    }

    function poseImportList(raw) {
      if (Array.isArray(raw)) return raw
      if (!raw || typeof raw !== 'object') return null
      for (const key of ['poses', 'actions', 'items', 'entries', 'data']) {
        if (Array.isArray(raw[key])) return raw[key]
      }
      return null
    }

    function parsePoseImport(raw, existing) {
      const list = poseImportList(raw)
      // `null` means "this is not a pose file at all"; an empty array is a valid
      // file that happens to hold no actions.
      if (!list) return { ok: false, entries: [], duplicates: 0, invalid: 0 }
      const seen = new Set((existing || []).map(poseImportKey))
      const stamp = Date.now().toString(36)
      const entries = []
      let duplicates = 0
      let invalid = 0
      for (const item of list) {
        const text = poseEntryText(item)
        if (!text || text.length > 4000) {
          invalid += 1
          continue
        }
        const name = poseEntryName(item, text).slice(0, 80)
        const orientation = poseOrientationOf(item)
        const key = `${orientation}\u0000${name}\u0000${text}`
        if (seen.has(key)) {
          duplicates += 1
          continue
        }
        seen.add(key)
        entries.push({
          id: `pose-${stamp}${entries.length}${Math.random().toString(36).slice(2, 5)}`,
          name,
          prompt: text,
          orientation,
        })
      }
      return { ok: true, entries, duplicates, invalid }
    }

    function poseExportFilename(now) {
      const date = new Date(now || Date.now())
      const pad = value => String(value).padStart(2, '0')
      return `poses-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
    }

    function settingsToDraft(value) {
      if (!value) return null
      const vision = value.vision || {}
      return {
        activeId: value.activeId,
        outputDir: value.outputDir || '',
        profiles: (value.profiles || []).map(profile => ({ ...profile, apiKey: '', clearKey: false })),
        vision: {
          activeId: vision.activeId || '',
          profiles: (Array.isArray(vision.profiles) ? vision.profiles : []).map(profile => ({
            ...profile,
            apiKey: '',
            clearKey: false,
          })),
        },
      }
    }

    /** Vision draft -> /settings payload (empty apiKey keeps the saved key). */
    function visionDraftToPayload(vision) {
      if (!vision) return undefined
      return {
        activeId: vision.activeId || '',
        profiles: (Array.isArray(vision.profiles) ? vision.profiles : []).map(profile => ({
          id: profile.id,
          name: profile.name,
          baseUrl: profile.baseUrl || '',
          model: profile.model || '',
          apiKey: profile.apiKey || undefined,
          clearApiKey: profile.clearKey === true,
        })),
      }
    }

    const ZH_RATIO = {
      square: '方形构图',
      portrait: '竖版时装构图',
      landscape: '横版构图',
      'portrait-9-16': '竖版 9:16 社媒构图，全身时装取景',
      'landscape-16-9': '横版 16:9 宽银幕构图，电影感时装取景',
    }

    /** The fidelity rules are a JSON block now, so an edit has to stay parseable. */
    function isFidelityJson(text) {
      try {
        const value = JSON.parse(String(text || '').trim())
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      } catch {
        return false
      }
    }

    /** What actually travels in the prompt: compact, no formatting whitespace. */
    function compactFidelity(text) {
      const value = String(text || '').trim()
      if (!isFidelityJson(value)) return value
      return JSON.stringify(JSON.parse(value))
    }

    /** What the Settings editor shows: the same object, one rule per line. */
    function prettyFidelity(text) {
      const value = String(text || '').trim()
      if (!isFidelityJson(value)) return String(text || '')
      return JSON.stringify(JSON.parse(value), null, 2)
    }

    /** The strict-fidelity module can be customised from Settings; fall back to
     *  the built-in JSON rules when the user has not edited it. */
    function loadFidelityText() {
      const saved = loadJson(LS_FIDELITY, null)
      if (saved && typeof saved.text === 'string' && saved.text.trim()) {
        // An untouched copy of the old prose module is upgraded to the JSON one.
        if (saved.text.trim() === LEGACY_FIDELITY_MODULE.trim()) return FIDELITY_MODULE
        // Same for an untouched copy of the previous JSON version: the hand-occlusion
        // rule it carried contradicts "one hand in the pocket" poses.
        if (saved.text.trim() === LEGACY_FIDELITY_V23.trim()) return FIDELITY_MODULE
        return compactFidelity(saved.text)
      }
      return FIDELITY_MODULE
    }

    /** The studio keeps a copy of the picked library entry in these fields; a
     *  library edit/delete rewrites (or clears) every field still holding it.
     *  Each field belongs to exactly one library kind, so a rewrite is scoped to
     *  that kind: two entries that happen to share the same text stay separate. */
    const PROMPT_FIELD_KINDS = {
      modelPrompt: 'model',
      backgroundPrompt: 'scene',
      extraPrompt: 'style',
    }
    const PROMPT_FIELD_KEYS = ['modelPrompt', 'backgroundPrompt', 'extraPrompt']

    function promptTextPatch(form, from, to, kind) {
      const patch = {}
      if (!form || !from) return patch
      for (const key of PROMPT_FIELD_KEYS) {
        if (kind && PROMPT_FIELD_KINDS[key] !== kind) continue
        if (form[key] === from) patch[key] = to
      }
      return patch
    }

    /**
     * Prompt fields used to accept typed text, and templates saved back then carry
     * that text as a snapshot. Such a value has no chip now and the studio no
     * longer prints prompt text, so it is imported into the library once instead of
     * turning into an invisible prompt that still reaches the generator.
     * @returns library entries missing for the prompt text currently in the form
     */
    function legacyPromptEntries(form, prompts, suffix) {
      const entries = []
      if (!form) return entries
      const stamp = Date.now().toString(36)
      for (const key of PROMPT_FIELD_KEYS) {
        const value = String(form[key] || '').trim()
        if (!value) continue
        const kind = PROMPT_FIELD_KINDS[key]
        const known = (prompts || []).some(item => (
          (item.kind || 'style') === kind && String(item.text || '').trim() === value
        ))
        if (known) continue
        entries.push({
          id: `pr-${stamp}${entries.length}${Math.random().toString(36).slice(2, 5)}`,
          kind,
          name: `${value.slice(0, 16)}${suffix || ''}`,
          text: value,
        })
      }
      return entries
    }

    /**
     * Builds the prompt sent to the image API (Chinese prose by default, English
     * prose when the Harness locale is English; the built-in JSON blocks stay as
     * authored).
     * The studio uploads product references only - there is no model-sheet or
     * scene upload - so those two flags are gone rather than left unreachable.
     * @param form studio selections
     * @param hasProductRef whether a product reference was uploaded
     * @param customPoses user-defined poses (id, name, prompt)
     * @param fidelityText strict-product-fidelity module (editable in Settings)
     * @param lang 'zh' | 'en'
     */
    function buildPrompt(form, hasProductRef, customPoses, fidelityText, lang) {
      const en = lang === 'en'
      const rawDescription = form.desc && form.desc.trim() ? form.desc.trim() : ''
      // The reference photo is primary: with product photos attached the
      // description is prefixed with the "supplement only" note. Without
      // references that note is removed again so it never claims a missing photo.
      const description = hasProductRef ? withDescPrefix(rawDescription) : stripDescPrefix(rawDescription)
      const modelPrompt = form.modelPrompt && form.modelPrompt.trim() ? form.modelPrompt.trim() : ''
      const backgroundPrompt = form.backgroundPrompt && form.backgroundPrompt.trim() ? form.backgroundPrompt.trim() : ''
      // The model is described in words only; the framing chips speak about that
      // described model.
      const hasModel = Boolean(modelPrompt)
      const customPose = (customPoses || []).find(item => item && item.id === form.pose)
      const poseText = customPose && customPose.prompt ? customPose.prompt.trim() : ''
      // Framing (face visible / crop at neck / crop at chest) only means anything
      // when a model is part of the shot; otherwise the studio hides the chips.
      const framing = hasModel ? findOption(SHOW, form.show) : null
      const neckCrop = Boolean(framing && framing.id === 'neck')

      const parts = []
      if (modelPrompt) {
        parts.push(en ? `Professional e-commerce apparel photography, model: ${modelPrompt}` : `专业电商服装摄影，模特：${modelPrompt}`)
      } else {
        parts.push(en ? 'Professional e-commerce apparel photography' : '专业电商服装摄影')
      }

      // The JSON composition block is computed here but is NOT pushed into the
      // comma-joined paragraph: it replaces the old composition segment as a
      // standalone leading block (see below).
      const framingRules = framing ? JSON.stringify(framing.rules) : ''

      if (hasProductRef) {
        if (en) {
          parts.push(`${hasModel ? 'wearing' : 'presenting'} the product from the product reference photo${description ? `: ${description}` : ''}`)
        } else {
          parts.push(
            hasModel
              ? `穿着商品参考图中的商品${description ? `，${description}` : ''}`
              : `展示商品参考图中的商品${description ? `，${description}` : ''}`,
          )
        }
      } else if (description) {
        parts.push(en ? `${hasModel ? 'wearing' : 'presenting'} ${description}` : `${hasModel ? '穿着' : '展示'}${description}`)
      } else if (hasModel) {
        parts.push(en ? 'presenting the apparel' : '展示服装')
      }

      if (poseText) parts.push(poseText)
      // Backgrounds are described in words; the studio has no scene upload.
      let background = ''
      if (backgroundPrompt) background = en ? `background: ${backgroundPrompt}` : `背景：${backgroundPrompt}`
      parts.push(background || (en ? 'clean seamless studio backdrop' : '干净的纯色影棚背景'))
      if (form.extraPrompt && form.extraPrompt.trim()) parts.push(form.extraPrompt.trim())
      // A "full-body fashion framing" line fights the neck crop: the model satisfies
      // the whole-body request by including the head. The crop rule wins.
      if (en) {
        const ratioOption = findOption(RATIOS, form.ratio)
        parts.push(neckCrop ? `${ratioOption.en} composition, neck-down framing` : `${ratioOption.en} composition`)
      } else {
        const ratioText = neckCrop
          ? String(ZH_RATIO[form.ratio] || '').replace('全身时装取景', '颈部以下取景')
          : ZH_RATIO[form.ratio]
        if (ratioText) parts.push(ratioText)
      }
      // The pixel size is decided by the request, not by the prompt: writing
      // "1152x2048 pixels" into the text only added a claim the model cannot honour.
      // A user may also ask the opposite ("背景不要虚化"), so the keyword only
      // counts when no negation appears *before* it inside the same clause.
      const wantsShallow = `${form.extraPrompt || ''}，${backgroundPrompt}`
        .split(/[，,;；。\n]/)
        .some(clause => {
          const hit = clause.search(/浅景深|虚化|bokeh/i)
          return hit >= 0 && !/不|无|别|勿|避免|禁止/.test(clause.slice(0, hit))
        })
      if (en) {
        parts.push(wantsShallow
          ? 'shot on an 85mm lens at f/2.8, subject sharp with a softly blurred background; professional retouching, commercial quality, real photographic texture, high resolution'
          : 'shot on an 85mm lens at f/5.6, subject and product sharp throughout, fabric texture and stitching legible; professional retouching, commercial quality, real photographic texture, high resolution')
      } else {
        parts.push(wantsShallow
          ? '85mm 镜头拍摄，f/2.8 大光圈，主体清晰、背景柔和虚化；专业修图，商业级品质，真实摄影质感，高分辨率'
          : '85mm 镜头拍摄，f/5.6 光圈，主体（模特与商品）全程清晰，面料纹理与缝线细节可辨；专业修图，商业级品质，真实摄影质感，高分辨率')
      }
      // The fidelity JSON already states that the product reference wins, so this
      // sentence is only needed when that module is off (no duplicate claims).
      if (!(form.strictFidelity && hasProductRef)) parts.push(en ? 'product colour, material, cut and structure follow the product reference photo' : '商品颜色、材质、版型与结构以商品参考图为准')

      const paragraph = en ? `${parts.filter(Boolean).join(', ')}.` : `${parts.filter(Boolean).join('，')}。`
      // The JSON block replaces the old composition segment and leads the
      // prompt on its own line: written exactly once, never comma-spliced into
      // the paragraph and never repeated at the tail.
      let text = framingRules ? `${framingRules}\n${paragraph}` : paragraph
      // The fidelity module claims "the product reference photo is the only source
      // of truth": without an uploaded product photo that claim is false, so it is
      // only appended when such a photo really exists.
      if (form.strictFidelity && hasProductRef) text += `\n\n${fidelityText || FIDELITY_MODULE}`
      // Recency decides: the leading JSON block alone lost to the long prose after
      // it, so the crop rule is restated as the last instruction (a visible face
      // was the symptom). It stays out of the negative list, which is user content.
      if (neckCrop) {
        text += en
          ? '\nHard framing requirement: the frame starts at the model\'s neck; head, face, facial features and hair never appear and no face is drawn.'
          : '\n构图硬性要求：画面从模特颈部开始，头部、面部、五官与头发完全不出现，画面内不要出现脸。'
      }
      if (form.includeNegative && form.negative && form.negative.trim()) {
        text += `\n【严禁出现】${form.negative.trim()}。`
      }
      return text
    }

    /** An Error carrying the machine-readable fields errorText() needs. */
    function apiError(code, status, message, cause) {
      const error = new Error(String(message || ''))
      error.code = code
      error.status = status || 0
      if (cause) error.cause = cause
      return error
    }

    /** An error whose message is already localized (a client-side validation
     *  failure raised by this file, not by the Host). */
    function userFacingError(message) {
      return apiError('ui-message', 0, message)
    }

    /**
     * One Host call. `options.signal` is passed straight through to fetch, so a
     * caller can cancel; nothing here creates a signal of its own, which keeps
     * short routes (settings/history/ref/extract) exactly as cheap as before and
     * only lets the long generation call be cancelled.
     */
    async function api(pathname, options) {
      const init = options || {}
      let response
      try {
        response = await fetch(`${API}${pathname}`, init)
      } catch (error) {
        // A cancelled request is not a network failure: the watchdog aborted it
        // on purpose, so it must read as "timed out", never as "Host gone".
        const aborted = Boolean(error && error.name === 'AbortError')
          || Boolean(init.signal && init.signal.aborted)
        if (aborted) {
          throw apiError('timeout', 0, '请求已取消（本地超时或页面已关闭）', error)
        }
        // No response at all: the local Host route is gone (plugin unloaded) or
        // the request never left the page. The code lets the UI say it in one
        // short localized line instead of pasting the browser's English text.
        const detail = error && error.message ? error.message : String(error)
        throw apiError('host-unreachable', 0, `无法连接工作台本地服务（${detail}），请确认 Harness 已加载本插件。`, error)
      }
      let json = null
      try {
        json = await response.json()
      } catch {
        // Non-JSON response: reported as `bad-response` below.
      }
      // The Host is moving to {ok:false, code, error}; the code is preferred when
      // present, and status/message stay as the fallback for older builds.
      const code = json && typeof json.code === 'string' ? json.code.trim() : ''
      const detail = json && typeof json.error === 'string' ? json.error : ''
      if (!response.ok) {
        throw apiError(code || `http-${response.status}`, response.status, detail || `HTTP ${response.status}`)
      }
      if (json && json.ok === false) {
        throw apiError(code || 'request-failed', response.status, detail || '请求失败')
      }
      if (!json) throw apiError('bad-response', response.status, `HTTP ${response.status}`)
      return json
    }

    function formatTime(date) {
      const pad = n => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const BALANCE_ERROR_RE = /insufficient balance|余额不足|欠费|额度不足|quota exceeded|exceeded your current quota/i
    const AUTH_ERROR_RE = /invalid api key|unauthorized|无效的令牌|鉴权失败|authentication failed|authorization failed|接口返回 401|接口返回 402|HTTP 401|HTTP 402/i
    const RATE_LIMIT_ERROR_RE = /429|rate limit|too many requests|请求过于频繁|限流/i
    const TIMEOUT_ERROR_RE = /timeout|timed out|超时|aborted|abort/i
    const NETWORK_ERROR_RE = /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_connection|err_internet|econnrefused|无法连接|未加载本插件/i
    const MISSING_KEY_ERROR_RE = /缺少 *api|未配置 *(api|接口)|no api key|missing api key|api key.*(missing|未填写)|请先在「设置」/i

    // Host error code -> STR key: the code is matched loosely (case, dashes,
    // underscores and spaces ignored), so `missing_key`, `Missing-Key` and
    // `MISSING_KEY` all resolve to the same line. The right-hand entries below
    // the generic group are the codes the Host itself throws today.
    const API_ERROR_KEYS = {
      missingkey: 'errMissingKey',
      missingapikey: 'errMissingKey',
      nokey: 'errMissingKey',
      noapikey: 'errMissingKey',
      notconfigured: 'errMissingKey',
      missingconfig: 'errMissingKey',
      auth: 'errAuth',
      unauthorized: 'errAuth',
      invalidkey: 'errAuth',
      invalidapikey: 'errAuth',
      forbidden: 'errAuth',
      providerauth: 'errAuth',
      balance: 'errBalance',
      insufficientbalance: 'errBalance',
      quota: 'errBalance',
      quotareached: 'errBalance',
      paymentrequired: 'errBalance',
      providerbalance: 'errBalance',
      ratelimit: 'errRate',
      ratelimited: 'errRate',
      toomanyrequests: 'errRate',
      busy: 'errRate',
      overloaded: 'errRate',
      providerratelimit: 'errRate',
      timeout: 'errTimeout',
      timedout: 'errTimeout',
      requesttimeout: 'errTimeout',
      aborted: 'errTimeout',
      aborterror: 'errTimeout',
      providertimeout: 'errTimeout',
      bodytoolarge: 'errBodyTooLarge',
      payloadtoolarge: 'errBodyTooLarge',
      requesttoolarge: 'errBodyTooLarge',
      invalidreference: 'errInvalidReference',
      badreference: 'errInvalidReference',
      invalidimage: 'errInvalidReference',
      unsupportedimage: 'errInvalidReference',
      unreadableimage: 'imageUnsupported',
      missingreference: 'errMissingReference',
      referencecount: 'errReferenceCount',
      referencetotalsize: 'errReferenceTotalSize',
      referencetoolarge: 'errReferenceTooLarge',
      referenceechoed: 'errReferenceEchoed',
      imagenotfound: 'errImageNotFound',
      refnotfound: 'errRefNotFound',
      invalidimagename: 'errInvalidImageName',
      invalidrefname: 'errInvalidRefName',
      invalidjson: 'errInvalidJson',
      methodnotallowed: 'errMethodNotAllowed',
      missingprompt: 'needPrompt',
      noimagereturned: 'errNoImage',
      outputdirunwritable: 'errOutputDir',
      revealoutsideoutputdir: 'errRevealOutside',
      crosssitedenied: 'errCrossSite',
      settingscorrupt: 'errSettingsCorrupt',
      prompttoolong: 'errPromptTooLong',
      openfailed: 'errOpenFailed',
      dirnotfound: 'errDirNotFound',
      refoutsidedir: 'errRefOutsideDir',
      missingdir: 'errMissingDir',
      missingimage: 'errMissingImage',
      hostunreachable: 'errHostUnreachable',
      unreachable: 'errHostUnreachable',
      network: 'errHostUnreachable',
      networkerror: 'errHostUnreachable',
      fetchfailed: 'errHostUnreachable',
      offline: 'errHostUnreachable',
      badresponse: 'errBadResponse',
      invalidresponse: 'errBadResponse',
      nonjson: 'errBadResponse',
      parseerror: 'errBadResponse',
      provider: 'errProvider',
      providererror: 'errProvider',
      upstream: 'errProvider',
      upstreamerror: 'errProvider',
      servererror: 'errProvider',
      internalerror: 'errProvider',
    }

    // `http-<status>` is what api() derives when the Host sends no code; only the
    // meaningful statuses get their own wording (403 stays generic: it is often a
    // per-image moderation refusal, not a broken key).
    const HTTP_ERROR_KEYS = {
      400: 'errUnknown',
      401: 'errAuth',
      402: 'errBalance',
      403: 'errUnknown',
      404: 'errUnknown',
      408: 'errTimeout',
      409: 'errUnknown',
      413: 'errBodyTooLarge',
      415: 'errInvalidReference',
      422: 'errInvalidReference',
      429: 'errRate',
      500: 'errProvider',
      502: 'errProvider',
      503: 'errProvider',
      504: 'errProvider',
    }

    /** Maps one error code to the STR key that explains it. */
    function apiErrorStringKey(code) {
      const raw = String(code == null ? '' : code).trim()
      if (!raw) return 'errUnknown'
      const http = /^http[-_ ]?(\d{3})$/i.exec(raw)
      if (http) {
        const status = Number(http[1])
        return HTTP_ERROR_KEYS[status] || (status >= 500 ? 'errProvider' : 'errUnknown')
      }
      const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
      return API_ERROR_KEYS[key] || 'errUnknown'
    }

    /**
     * Turns anything thrown by api() (or by the browser) into
     * {code, status, detail}: a Host `code` wins, otherwise status first and the
     * message text second, so native English text never decides the wording.
     */
    function normalizeApiError(error) {
      const source = error && typeof error === 'object' ? error : { message: String(error == null ? '' : error) }
      const detail = String(source.message || '').trim()
      const status = Number(source.status || source.statusCode || 0) || 0
      let code = typeof source.code === 'string' ? source.code.trim() : ''
      if (!code) {
        if (source.name === 'AbortError') code = 'timeout'
        else if (status >= 400) code = `http-${status}`
        else if (BALANCE_ERROR_RE.test(detail)) code = 'balance'
        else if (AUTH_ERROR_RE.test(detail)) code = 'auth'
        else if (MISSING_KEY_ERROR_RE.test(detail)) code = 'missing-key'
        else if (RATE_LIMIT_ERROR_RE.test(detail)) code = 'rate-limit'
        else if (TIMEOUT_ERROR_RE.test(detail)) code = 'timeout'
        else if (NETWORK_ERROR_RE.test(detail)) code = 'host-unreachable'
        else code = 'unknown'
      }
      return { code, status, detail }
    }

    /**
     * The one place that renders an error for the user. Known codes get their own
     * localized line; an unmapped code keeps the generic line plus a truncated
     * copy of the Host/provider message, so a new code is still debuggable.
     */
    function errorText(error, t) {
      const info = normalizeApiError(error)
      if (info.code === 'ui-message') return info.detail || t('errUnknown')
      const key = apiErrorStringKey(info.code)
      const base = t(key)
      if (key !== 'errUnknown') return base
      if (!info.detail || /^HTTP \d{3}$/i.test(info.detail) || info.detail === base) return base
      const detail = info.detail.length > ERROR_DETAIL_MAX
        ? `${info.detail.slice(0, ERROR_DETAIL_MAX)}…`
        : info.detail
      return `${base} · ${detail}`
    }

    /** Only errors that will fail *every* queued job are fatal: exhausted
     *  balance/quota or a rejected key. A plain 403 is often a per-image content
     *  moderation refusal (or a failed image download), so it must never cancel
     *  the rest of the queue - otherwise one bad job looks like a queue-wide
     *  failure. */
    function isFatalApiError(error) {
      const info = normalizeApiError(error)
      const key = apiErrorStringKey(info.code)
      if (key === 'errBalance' || key === 'errAuth') return true
      return BALANCE_ERROR_RE.test(info.detail) || AUTH_ERROR_RE.test(info.detail)
    }

    /** Compatibility layer for call sites that still pass a bare message. */
    function friendlyApiError(message, t) {
      return errorText(message, t)
    }

    /** For the two diagnostics panes (connection test / model discovery) the
     *  localized line alone is not enough: the provider's own message is what
     *  tells the user which key or model is wrong. Kept out of every notice and
     *  queue row, where a wall of raw text is just noise. */
    function errorTextWithDetail(error, t) {
      const info = normalizeApiError(error)
      const base = errorText(error, t)
      if (!info.detail || base.indexOf(info.detail) >= 0) return base
      const detail = info.detail.length > ERROR_DETAIL_MAX
        ? `${info.detail.slice(0, ERROR_DETAIL_MAX)}…`
        : info.detail
      return `${base} · ${detail}`
    }

    /** "Click again to confirm" window shared by the library and settings pages.
     *  A second click inside delayMs runs the action; the pending timer is
     *  re-armed on every new target and cleared when the page goes away, so no
     *  timer outlives its component. */
    function useConfirmWindow(delayMs) {
      const timerRef = useRef(0)
      const disarm = useCallback(() => {
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = 0
      }, [])
      const arm = useCallback(onExpire => {
        disarm()
        timerRef.current = window.setTimeout(() => {
          timerRef.current = 0
          onExpire()
        }, delayMs)
      }, [delayMs, disarm])
      useEffect(() => disarm, [disarm])
      return { arm, disarm }
    }

    function formatDuration(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return ''
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`
    }

    /** Debounce helper: every schedule() restarts the timer, so `action` only runs
     *  once after the last change. Used to auto-extract the product description
     *  five seconds after the reference photos stop changing. */
    function createDebouncedAction(delayMs, action) {
      let timer = null
      return {
        schedule(waitMs) {
          if (timer) clearTimeout(timer)
          const wait = typeof waitMs === 'number' && waitMs >= 0 ? waitMs : delayMs
          timer = setTimeout(() => {
            timer = null
            action()
          }, wait)
        },
        cancel() {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
        },
        pending() {
          return timer !== null
        },
      }
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
        props.hint
          ? h(
              'div',
              { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 7, lineHeight: 1.55 } },
              props.hint,
            )
          : null,
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

    // Quiet selectable chip used for library entries (templates, prompts).
    const QUIET_CHIP = {
      padding: '5px 11px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
    }

    const ACTIVE_CHIP = {
      ...QUIET_CHIP,
      borderColor: 'var(--dsw-alias-brand-primary)',
      background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)',
      color: 'var(--dsw-alias-brand-primary)',
    }

    // Prompt text is authored only in the prompt library, so every place that
    // needs a model / background / style prompt renders this picker instead of a
    // textarea: one saved entry per field, click again to clear. The text itself
    // is never rendered here (not even as a hover tooltip); the chip label is the
    // entry name, and the full text stays in the prompt library.
    function PromptPicker(props) {
      const { t, label, kind, value, prompts, onPick, onClear, onOpenLibrary, onAdopt } = props
      const text = String(value || '').trim()
      const list = (prompts || []).filter(item => (item.kind || 'style') === kind)
      const matched = text ? list.filter(item => String(item.text || '').trim() === text) : []
      // Only one chip can look selected even if two entries share the same text.
      const activeId = matched.length ? matched[0].id : null
      // A field can hold text that no library entry provides: a template saved by
      // an older version, or an entry deleted elsewhere. Say so instead of
      // quietly feeding an invisible prompt into the generator.
      const orphan = Boolean(text) && matched.length === 0
      return h(
        'div',
        { style: { marginBottom: 16 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' } }, label),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            orphan && onAdopt
              ? h('button', { type: 'button', onClick: () => onAdopt(text), style: tintButton() }, t('promptAdopt'))
              : null,
            text && onClear
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: onClear,
                    style: textButton({ fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }),
                  },
                  t('promptClear'),
                )
              : null,
            onOpenLibrary
              ? h('button', { type: 'button', onClick: onOpenLibrary, style: tintButton() }, t('promptNewForKind'))
              : null,
          ),
        ),
        list.length
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              list.map(item =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    onClick: () => onPick(item),
                    style: item.id === activeId ? ACTIVE_CHIP : QUIET_CHIP,
                  },
                  item.name,
                ),
              ),
            )
          : (orphan
              ? null
              : h(
                  'div',
                  { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
                  t('promptSelectEmpty'),
                )),
        orphan
          ? h(
              'div',
              { style: { marginTop: 6, fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-state-warn-primary)' } },
              t('promptOrphan'),
            )
          : null,
      )
    }

    function Thumb(props) {
      return h(
        'button',
        {
          type: 'button',
          onClick: props.onOpen,
          title: props.title || props.name,
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
    /** Rows in the queue card: the newest MAX_JOB_ROWS, except that a running or
     *  queued job is never dropped (dropping one would hide a job that still
     *  holds a slot). */
    function capJobList(list) {
      if (list.length <= MAX_JOB_ROWS) return list
      const active = list.filter(job => job.status === 'running' || job.status === 'queued')
      const room = Math.max(0, MAX_JOB_ROWS - active.length)
      const finished = list.filter(job => job.status !== 'running' && job.status !== 'queued').slice(0, room)
      const keep = new Set(active.concat(finished))
      return list.filter(job => keep.has(job))
    }

    /** A failed job keeps its request so it can be retried without a re-upload.
     *  Those requests carry base64 photos, so only the newest
     *  MAX_RETRY_PAYLOADS failures keep one; older rows stay as plain errors. */
    function pruneRetryPayloads(list) {
      let seen = 0
      let changed = false
      const next = list.map(job => {
        if (job.status !== 'error' || !job.payload) return job
        seen += 1
        if (seen <= MAX_RETRY_PAYLOADS) return job
        changed = true
        return { ...job, payload: undefined }
      })
      return changed ? next : list
    }

    /** Identifies "the same generation request" (prompt + size + the exact
     *  reference set) so a double click cannot queue the same paid job twice. */
    function jobSignature(payload) {
      const references = (payload && payload.references) || []
      const fingerprint = references
        .map(item => `${item.name || ''}:${String(item.dataBase64 || '').length}`)
        .join(',')
      return `${(payload && payload.prompt) || ''}\u0000${(payload && payload.size) || ''}\u0000${references.length}\u0000${fingerprint}`
    }

    function Page() {
      const lang = useLanguage()
      const t = useCallback(key => (STR[lang] && STR[lang][key]) || (STR.zh[key] || key), [lang])
      const [tab, setTab] = useState('home')
      const [posePage, setPosePage] = useState(false)
      const [poseNew, setPoseNew] = useState(false)
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
      // id -> watchdog timer for a running job.
      const jobTimersRef = useRef(new Map())
      // id -> AbortController for a running generation. Only `/generate` gets one:
      // it is the one call that can hang for minutes.
      const jobAbortRef = useRef(new Map())
      const [form, setForm] = useState(loadForm)
      const [customPrompt, setCustomPrompt] = useState(null)
      const [accentId, setAccentId] = useState(loadAccentId)
      const [preview, setPreview] = useState(null)
      const [now, setNow] = useState(() => new Date())
      const [testState, setTestState] = useState(null)
      const [saving, setSaving] = useState(false)
      const [draft, setDraft] = useState(null)
      const [productRefs, setProductRefs] = useState([])
      const [customPoses, setCustomPoses] = useState(loadPoses)
      const [fidelityText, setFidelityText] = useState(loadFidelityText)
      const [templates, setTemplates] = useState(loadTemplates)
      const [reusablePrompts, setReusablePrompts] = useState(loadReusablePrompts)
      const [promptPage, setPromptPage] = useState(false)
      // The inline "new / edit prompt" draft lives here, not inside the library
      // component: leaving the library (back button, tab switch) must not throw
      // away text the user already typed into the editor.
      const [promptDraft, setPromptDraft] = useState(null)
      const [extracting, setExtracting] = useState(false)

      // Auto product-info extraction: user changes to the reference photos are
      // debounced by AUTO_EXTRACT_DELAY_MS; refs give the timer the current busy
      // state and handler without re-creating the timer on every render.
      const extractingRef = useRef(false)
      const extractHandlerRef = useRef(null)
      const productMutationVersionRef = useRef(0)
      const extractedVersionRef = useRef(0)
      const autoExtractSchedulerRef = useRef(null)
      // Timestamps used to avoid overwriting a description the user edited after
      // changing the photos (or while extraction is in flight).
      const photoChangedAtRef = useRef(0)
      const descTouchedAtRef = useRef(0)
      // Always-current snapshots for async handlers (setState is asynchronous).
      const productRefsRef = useRef(productRefs)
      productRefsRef.current = productRefs
      const persistQueueRef = useRef(Promise.resolve())
      const addingFilesRef = useRef(false)
      const tabEffectReadyRef = useRef(false)
      if (autoExtractSchedulerRef.current === null) {
        autoExtractSchedulerRef.current = createDebouncedAction(AUTO_EXTRACT_DELAY_MS, () => {
          // Nothing to do when this exact photo set has already been extracted.
          if (productMutationVersionRef.current <= extractedVersionRef.current) return
          // The user typed a description after changing the photos: keep it.
          if (descTouchedAtRef.current > photoChangedAtRef.current) return
          if (extractingRef.current) {
            autoExtractSchedulerRef.current.schedule(1000)
            return
          }
          if (extractHandlerRef.current) extractHandlerRef.current({ auto: true })
        })
      }

      // A full profile or disabled storage must be visible: the form is saved on
      // every keystroke, so the same failure is only reported once (a second
      // wording appears only when the reason itself changes).
      const storageNoticeRef = useRef('')
      const reportStorageFailure = useCallback(result => {
        if (!result || result.ok) return
        const key = storageErrorStringKey(result.error)
        if (storageNoticeRef.current === key) return
        storageNoticeRef.current = key
        setNotice({ kind: 'error', text: t(key) })
      }, [t])

      const persistPoses = useCallback(next => {
        setCustomPoses(next)
        reportStorageFailure(saveJson(LS_POSES, next))
      }, [reportStorageFailure])

      const refreshHistory = useCallback(async () => {
        try {
          const json = await api('/history?limit=48')
          setHistory({ items: json.items || [], total: json.total || 0, outputDir: json.outputDir || '' })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      const refreshSettings = useCallback(async () => {
        try {
          const json = await api('/settings')
          const value = json.settings || null
          setSettings(value)
          setDraft(prev => prev || settingsToDraft(value))
          // The host reports a damaged/unreadable settings file: surface it so
          // the user knows saves are paused and a .bak recovery is available.
          if (json.warning) setNotice({ kind: 'error', text: String(json.warning) })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      useEffect(() => {
        refreshSettings()
        refreshHistory()
      }, [refreshSettings, refreshHistory])

      useEffect(() => {
        reportStorageFailure(saveJson(LS_FORM, form))
      }, [form, reportStorageFailure])

      useEffect(() => {
        const handle = window.setInterval(() => setNow(new Date()), 20000)
        return () => window.clearInterval(handle)
      }, [])

      useEffect(() => {
        // The mount effect above already loaded settings/history; this effect
        // only refreshes history when the user actually switches tabs.
        if (!tabEffectReadyRef.current) {
          tabEffectReadyRef.current = true
          return
        }
        if (tab === 'studio' || tab === 'home') refreshHistory()
      }, [tab, refreshHistory])

      // If the first settings fetch failed (host still starting), visiting the
      // Settings tab retries instead of leaving a permanent "…" placeholder.
      useEffect(() => {
        if (tab === 'settings' && !draft) refreshSettings()
      }, [tab, draft, refreshSettings])

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
        () => buildPrompt(form, productRefs.length > 0, customPoses, fidelityText, lang),
        [form, productRefs, customPoses, fidelityText, lang],
      )
      const promptValue = customPrompt === null ? prompt : customPrompt
      const referenceCount = productRefs.length

      const saveFidelityText = useCallback(text => {
        const value = compactFidelity(text)
        if (!value) return false
        // The module is appended as one JSON block, so broken JSON is refused here
        // instead of silently shipping half an object with the next prompt.
        if (!isFidelityJson(value)) {
          setNotice({ kind: 'error', text: t('fidelityJsonInvalid') })
          return false
        }
        setFidelityText(value)
        reportStorageFailure(saveJson(LS_FIDELITY, { text: value }))
        setNotice({ kind: 'ok', text: t('saved') })
        return true
      }, [reportStorageFailure, t])

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

      // Keep the stored description consistent with the current photo set, but
      // only when the photo set changes: running on every keystroke made the
      // controlled textarea eat trailing spaces/newlines and re-add a deleted
      // prefix. buildPrompt still enforces the note for the generation prompt.
      useEffect(() => {
        const current = form.desc || ''
        if (!current.trim()) return
        const next = productRefs.length > 0
          ? withDescPrefix(normalizeDescriptionBody(current))
          : stripDescPrefix(current)
        if (next !== current) update({ desc: next })
        // form.desc is intentionally not a dependency: this is a photo-set migration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [productRefs.length])

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
        reportStorageFailure(saveJson(LS_TEMPLATES, next))
        setNotice({ kind: 'ok', text: t('templateSaved') })
      }, [form, templates, templateSnapshot, reportStorageFailure, t])

      const applyTemplate = useCallback(template => {
        if (!template || !template.form) return
        const next = { ...template.form }
        if (next.pose && !customPoses.some(item => item.id === next.pose)) next.pose = ''
        if (!SHOW.some(item => item.id === next.show)) next.show = DEFAULT_FORM.show
        if (!RATIOS.some(item => item.id === next.ratio)) next.ratio = DEFAULT_FORM.ratio
        if (!RESOLUTIONS.some(item => item.id === next.resolution)) next.resolution = DEFAULT_FORM.resolution
        // A template may carry the reference-first note from a previous photo set.
        if (typeof next.desc === 'string') {
          next.desc = productRefs.length > 0 ? withDescPrefix(next.desc) : stripDescPrefix(next.desc)
        }
        update(next)
        setTemplatePage(false)
        setPosePage(false)
        setNotice({ kind: 'ok', text: t('templateApplied') })
      }, [update, customPoses, productRefs.length, t])

      const updateTemplate = useCallback((id, patch) => {
        const next = templates.map(template => (
          template.id === id ? { ...template, ...patch, updatedAt: Date.now() } : template
        ))
        setTemplates(next)
        reportStorageFailure(saveJson(LS_TEMPLATES, next))
        setNotice({ kind: 'ok', text: t('templateUpdated') })
      }, [templates, reportStorageFailure, t])

      const deleteTemplate = useCallback(id => {
        const next = templates.filter(template => template.id !== id)
        setTemplates(next)
        reportStorageFailure(saveJson(LS_TEMPLATES, next))
      }, [templates, reportStorageFailure])

      // ------------------------------------------------------ reusable prompts
      const persistReusablePrompts = useCallback(next => {
        setReusablePrompts(next)
        reportStorageFailure(saveJson(LS_PROMPTS, next))
      }, [reportStorageFailure])

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

      // One field per library entry, so the applied copies are compared by exact
      // text inside the entry's own kind. Edits/deletes in the library keep the
      // studio (and the template snapshots) in sync.
      const syncAppliedPrompt = useCallback((from, to, kind) => {
        const patch = promptTextPatch(form, from, to, kind)
        if (!Object.keys(patch).length) return false
        setForm(prev => ({ ...prev, ...patch }))
        // Only a real change may drop a hand-written final prompt.
        setCustomPrompt(null)
        return true
      }, [form])

      const dropAppliedPrompt = useCallback((text, kind) => syncAppliedPrompt(text, '', kind), [syncAppliedPrompt])

      // Templates keep their own copy of the prompt text; an edit/delete in the
      // library has to follow through or applying the template would restore a
      // prompt that no longer exists in the library.
      const syncTemplates = useCallback((from, to, kind) => {
        let touched = false
        const next = templates.map(template => {
          const patch = promptTextPatch(template.form, from, to, kind)
          if (!Object.keys(patch).length) return template
          touched = true
          return { ...template, form: { ...template.form, ...patch }, updatedAt: Date.now() }
        })
        if (!touched) return false
        setTemplates(next)
        reportStorageFailure(saveJson(LS_TEMPLATES, next))
        return true
      }, [templates, reportStorageFailure])

      const updateReusablePrompt = useCallback((id, patch) => {
        const current = reusablePrompts.find(item => item.id === id)
        persistReusablePrompts(reusablePrompts.map(item => (item.id === id ? { ...item, ...patch } : item)))
        if (current) {
          const kind = current.kind || 'style'
          const kindChanged = typeof patch.kind === 'string' && patch.kind !== kind
          const textChanged = typeof patch.text === 'string' && patch.text !== current.text
          if (kindChanged) {
            // The entry moved to another kind, so a field of the old kind cannot
            // show it any more: clear the stale copy instead of leaving prompt
            // text that no chip represents.
            dropAppliedPrompt(current.text, kind)
            syncTemplates(current.text, '', kind)
          } else if (textChanged) {
            syncAppliedPrompt(current.text, patch.text, kind)
            syncTemplates(current.text, patch.text, kind)
          }
        }
        setNotice({ kind: 'ok', text: t('promptUpdated') })
      }, [reusablePrompts, persistReusablePrompts, dropAppliedPrompt, syncAppliedPrompt, syncTemplates, t])

      const deleteReusablePrompt = useCallback(id => {
        const current = reusablePrompts.find(item => item.id === id)
        if (!current) return
        const kind = current.kind || 'style'
        const remaining = reusablePrompts.filter(item => item.id !== id)
        persistReusablePrompts(remaining)
        // An entry with exactly the same text still provides it to the field.
        const survivor = remaining.some(item => (item.kind || 'style') === kind && item.text === current.text)
        if (!survivor) {
          dropAppliedPrompt(current.text, kind)
          syncTemplates(current.text, '', kind)
        }
        setNotice({ kind: 'ok', text: survivor ? t('promptDeleted') : t('promptDeletedCleared') })
      }, [reusablePrompts, persistReusablePrompts, dropAppliedPrompt, syncTemplates, t])

      const adoptPromptText = useCallback((kind, text) => {
        const value = String(text || '').trim()
        if (!value) return
        const cleanKind = ['style', 'model', 'scene'].indexOf(kind) >= 0 ? kind : 'style'
        if (reusablePrompts.some(item => (item.kind || 'style') === cleanKind && String(item.text || '').trim() === value)) return
        persistReusablePrompts([...reusablePrompts, {
          id: `pr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          kind: cleanKind,
          name: value.slice(0, 16),
          text: value,
        }])
        setNotice({ kind: 'ok', text: t('promptArchived') })
      }, [reusablePrompts, persistReusablePrompts, t])

      // Imported entries are appended as-is: they already carry an id, a kind and
      // a name, and parsePromptImport dropped everything the library has.
      const importReusablePrompts = useCallback((entries, meta) => {
        const valid = (Array.isArray(entries) ? entries : []).filter(item => (
          item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim()
        ))
        if (!valid.length) return
        persistReusablePrompts([...reusablePrompts, ...valid.map(item => ({
          ...item,
          kind: normalizePromptKind(item.kind),
          name: String(item.name || '').trim() || item.text.slice(0, 16),
          text: item.text.trim(),
        }))])
        const skipped = (meta && Number(meta.duplicates || 0)) + (meta && Number(meta.invalid || 0))
        const base = `${t('promptImportDone')} ${valid.length}${t('promptCountUnit')}`
        setNotice({
          kind: 'ok',
          text: skipped > 0 ? `${base}${t('promptImportSkipped')}${skipped}` : base,
        })
      }, [reusablePrompts, persistReusablePrompts, t])

      const reportPromptExport = useCallback((count, saved) => {
        setNotice(saved
          ? { kind: 'ok', text: `${t('promptExported')} ${count}${t('promptCountUnit')}` }
          : { kind: 'error', text: t('promptExportFailed') })
      }, [t])

      // Prompt fields used to accept typed text; whatever is still persisted in
      // them (or restored from a template written by an older version) has no chip
      // now, so import those leftovers into the library once.
      const promptMigrationRef = useRef(false)
      useEffect(() => {
        if (promptMigrationRef.current) return
        promptMigrationRef.current = true
        const imported = legacyPromptEntries(form, reusablePrompts, t('promptLegacySuffix'))
        if (!imported.length) return
        persistReusablePrompts([...reusablePrompts, ...imported])
        setNotice({ kind: 'ok', text: t('promptMigrated') })
      }, [form, reusablePrompts, persistReusablePrompts, t])

      const openPromptLibrary = useCallback(kind => {
        const draft = String(kind || '') ? { id: null, kind, name: '', text: '' } : null
        // Re-opening the library keeps an unsaved draft the user already typed.
        setPromptDraft(prev => (draft && !(prev && String(prev.text || '').trim()) ? draft : prev))
        setPromptPage(true)
      }, [])

      const closePromptLibrary = useCallback(() => {
        setPromptPage(false)
      }, [])

      const loadReferenceFile = useCallback(async file => {
        if (!file) return null
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          throw userFacingError(t('pickImageFormat'))
        }
        if (file.size > 8 * 1024 * 1024) throw userFacingError(t('refImageTooLarge'))
        const optimized = await optimizeReferenceImage(file).catch(() => null)
        const dataUrl = optimized ? optimized.dataUrl : await readBlobAsDataUrl(file)
        const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/i.exec(dataUrl)
        if (!match) throw userFacingError(t('imageUnsupported'))
        return {
          dataBase64: match[2],
          mediaType: optimized ? optimized.mediaType : match[1],
          name: file.name,
          preview: dataUrl,
        }
      }, [t])

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

      const openPoseLibrary = useCallback(startNew => {
        setPoseNew(startNew === true)
        setPosePage(true)
      }, [])

      const importPoses = useCallback(entries => {
        const valid = (Array.isArray(entries) ? entries : []).filter(item => (
          item && typeof item.id === 'string' && typeof item.prompt === 'string' && item.prompt.trim()
        ))
        if (!valid.length) return 0
        persistPoses([...customPoses, ...valid.map(item => ({
          ...item,
          name: String(item.name || '').trim() || item.prompt.trim().slice(0, 16),
          prompt: item.prompt.trim(),
          orientation: poseOrientationOf(item),
        }))])
        setNotice({ kind: 'ok', text: `${t('poseImportDone')} ${valid.length}` })
        return valid.length
      }, [customPoses, persistPoses, t])

      const reportPoseExport = useCallback(count => {
        setNotice({ kind: 'ok', text: `${t('poseExported')} ${count}` })
      }, [t])

      // Persist the whole product-photo set through a promise chain: two quick
      // upload/remove actions must land on the host in the order they happened,
      // otherwise an older snapshot could overwrite a newer one on disk.
      const persistProductRefs = useCallback(refs => {
        const payload = refs.map(item => ({
          dataBase64: item.dataBase64,
          mediaType: item.mediaType,
          name: item.name,
        }))
        persistQueueRef.current = persistQueueRef.current.then(async () => {
          try {
            await api('/ref/products', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ references: payload, clear: payload.length === 0 }),
            })
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('refPersistFailed')} ${errorText(error, t)}` })
          }
        })
        return persistQueueRef.current
      }, [t])

      const handleProductFiles = useCallback(async files => {
        const list = Array.from(files || [])
        if (list.length === 0) return
        if (addingFilesRef.current) {
          setNotice({ kind: 'error', text: t('productAddBusy') })
          return
        }
        addingFilesRef.current = true
        try {
          const loaded = []
          for (const file of list) loaded.push(await loadReferenceFile(file))
          const current = productRefsRef.current || []
          const seen = new Set(current.map(item => item.dataBase64))
          const fresh = []
          for (const item of loaded) {
            if (!item || seen.has(item.dataBase64)) continue
            seen.add(item.dataBase64)
            fresh.push(item)
          }
          if (fresh.length === 0) {
            setNotice({ kind: 'ok', text: t('productAlreadyAdded') })
            return
          }
          if (current.length + fresh.length > 4) {
            setNotice({ kind: 'error', text: t('productRefsLimit') })
            return
          }
          const next = [...current, ...fresh]
          setProductRefs(next)
          persistProductRefs(next)
          productMutationVersionRef.current += 1
          photoChangedAtRef.current = Date.now()
          autoExtractSchedulerRef.current.schedule()
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        } finally {
          addingFilesRef.current = false
        }
      }, [loadReferenceFile, persistProductRefs, t])

      const handleRemoveProduct = useCallback(index => {
        if (addingFilesRef.current) {
          setNotice({ kind: 'error', text: t('productRemoveBusy') })
          return
        }
        const current = productRefsRef.current || []
        const next = current.filter((_, position) => position !== index)
        setProductRefs(next)
        persistProductRefs(next)
        productMutationVersionRef.current += 1
        photoChangedAtRef.current = Date.now()
        if (next.length > 0) autoExtractSchedulerRef.current.schedule()
        else autoExtractSchedulerRef.current.cancel()
      }, [persistProductRefs, t])

      const handleDescriptionChange = useCallback(value => {
        descTouchedAtRef.current = Date.now()
        update({ desc: value })
      }, [update])

      // One-click product analysis: send the uploaded product photos to the
      // workbench Host, which asks the harness LLM for the structured key
      // elements (colour, fabric, cut, trims, ...) used by the description.
      const handleExtractDescription = useCallback(async (options = {}) => {
        const auto = options && options.auto === true
        if (extracting) return
        const refs = productRefsRef.current || []
        if (refs.length === 0) {
          setNotice({ kind: 'error', text: t('extractNeedRef') })
          return
        }
        // Remember which photo revision this run covers: a successful extraction
        // satisfies the pending auto-extract for that same revision.
        const extractionVersion = productMutationVersionRef.current
        const startedAt = Date.now()
        setExtracting(true)
        setNotice(null)
        try {
          const json = await api('/extract', {
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
          const text = String(json.text || '').trim()
          if (!text) throw userFacingError(t('extractEmpty'))
          // The photo set changed (or was cleared) while the model was running:
          // the answer describes images that are no longer attached.
          if (productMutationVersionRef.current !== extractionVersion || (productRefsRef.current || []).length === 0) {
            setNotice({ kind: 'error', text: t('extractStale') })
            return
          }
          // Automatic extraction must not overwrite text typed during the call.
          if (auto && descTouchedAtRef.current > startedAt) {
            extractedVersionRef.current = Math.max(extractedVersionRef.current, extractionVersion)
            return
          }
          update({ desc: withDescPrefix(normalizeDescriptionBody(text)) })
          extractedVersionRef.current = Math.max(extractedVersionRef.current, extractionVersion)
          setNotice({ kind: 'ok', text: t('extractDone') })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        } finally {
          setExtracting(false)
        }
      }, [extracting, update, t])

      // The debounced auto-extract timer reads the latest busy state/handler
      // through refs, so it never fires with a stale closure.
      useEffect(() => {
        extractingRef.current = extracting
      }, [extracting])

      useEffect(() => {
        extractHandlerRef.current = handleExtractDescription
      }, [handleExtractDescription])

      useEffect(() => () => {
        if (autoExtractSchedulerRef.current) autoExtractSchedulerRef.current.cancel()
        // A pending watchdog must not fire after the page is gone.
        for (const timer of jobTimersRef.current.values()) window.clearTimeout(timer)
        jobTimersRef.current.clear()
        // …and a generation still in flight must not keep the socket open.
        for (const controller of jobAbortRef.current.values()) {
          try {
            controller.abort()
          } catch {
            // already settled
          }
        }
        jobAbortRef.current.clear()
      }, [])

      const updateJob = (id, patch) => {
        setJobs(prev => capJobList(pruneRetryPayloads(prev.map(job => (job.id === id ? { ...job, ...patch } : job)))))
      }

      function clearJobWatchdog(id) {
        const timer = jobTimersRef.current.get(id)
        if (timer === undefined) return
        window.clearTimeout(timer)
        jobTimersRef.current.delete(id)
      }

      /** Cancels the HTTP request behind one job (idempotent: the entry is gone
       *  once it fired, and an already-settled controller ignores abort()). */
      function abortJobRequest(id) {
        const controller = jobAbortRef.current.get(id)
        if (!controller) return false
        jobAbortRef.current.delete(id)
        try {
          controller.abort()
        } catch {
          // already settled
        }
        return true
      }

      async function runJob(job) {
        activeJobsRef.current += 1
        updateJob(job.id, { status: 'running', startedAt: Date.now() })
        // Only the generation call carries an AbortController: it is the one
        // request that can hang for minutes, and the Host answers it with a
        // single JSON body (no stream), so cancelling it only ends that call.
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        if (controller) jobAbortRef.current.set(job.id, controller)
        // A lost response would otherwise hold the slot forever. The watchdog
        // cancels the request and closes the row itself; `state.timedOut` keeps
        // the resulting rejection (and any late answer) from touching that row.
        const state = { timedOut: false }
        jobTimersRef.current.set(job.id, window.setTimeout(() => {
          jobTimersRef.current.delete(job.id)
          // Order matters: the flag goes up before abort() so the rejection the
          // abort causes is recognised as "already timed out", then the request
          // is cancelled, then the row/slot are settled as before.
          state.timedOut = true
          abortJobRequest(job.id)
          activeJobsRef.current = Math.max(0, activeJobsRef.current - 1)
          updateJob(job.id, {
            status: 'error',
            finishedAt: Date.now(),
            error: t('errTimeout'),
            // Tooltip detail stays in the current language: the row already says
            // which limit was hit, so no English diagnostic leaks into the UI.
            errorRaw: `${t('errTimeout')} · ${Math.round(JOB_WATCHDOG_MS / 1000)}s`,
            errorCode: 'timeout',
          })
          setNotice({ kind: 'error', text: t('errTimeout') })
          startQueuedJobs()
        }, JOB_WATCHDOG_MS))
        try {
          const json = await api('/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(job.payload),
            signal: controller ? controller.signal : undefined,
          })
          if (state.timedOut) return
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
          if (state.timedOut) return
          const info = normalizeApiError(error)
          const message = errorText(error, t)
          const raw = info.detail || message
          const fatal = isFatalApiError(error)
          // The payload is kept so this row can offer "retry" without asking the
          // user to upload the photos again; pruneRetryPayloads keeps only the
          // newest MAX_RETRY_PAYLOADS failures holding one.
          updateJob(job.id, {
            status: 'error',
            finishedAt: Date.now(),
            error: message,
            errorRaw: raw,
            errorCode: info.code,
          })
          // A balance/auth failure would fail every remaining job too: cancel the
          // rest of the queue and explain it once instead of spamming identical errors.
          if (fatal && queueRef.current.length > 0) {
            const pending = queueRef.current.splice(0)
            pending.forEach(item => updateJob(item.id, {
              status: 'error',
              finishedAt: Date.now(),
              error: message,
              errorRaw: raw,
              errorCode: info.code,
            }))
            setNotice({ kind: 'error', text: t('queueStopped') })
          } else {
            // A single failure (moderation, bad size, one-off provider error)
            // otherwise lives only inside a job row that can scroll out of view.
            setNotice({ kind: 'error', text: message })
          }
        } finally {
          clearJobWatchdog(job.id)
          // The request is over either way (done, failed, or aborted above).
          jobAbortRef.current.delete(job.id)
          // The watchdog already released the slot; releasing it twice would let
          // more than MAX_CONCURRENT_JOBS run at once.
          if (!state.timedOut) {
            activeJobsRef.current = Math.max(0, activeJobsRef.current - 1)
            startQueuedJobs()
          }
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
        // While settings are still loading, let the host decide (it reports a
        // clear missing-key error); only block when we know the key is absent.
        if (settings && !settings.hasApiKey) {
          setNotice({ kind: 'error', text: t('needKey') })
          return
        }
        // The queue refs are the authority; the jobs state can lag a fast click.
        const pendingCount = activeJobsRef.current + queueRef.current.length
        if (pendingCount >= MAX_PENDING_JOBS) {
          setNotice({ kind: 'error', text: t('queueFull') })
          return
        }
        const references = productRefs
          .filter(Boolean)
          .map(item => ({ dataBase64: item.dataBase64, mediaType: item.mediaType, name: item.name }))
        // The requested size is always computed from the aspect-ratio +
        // resolution chips; the fallback matches the default form (portrait 2K),
        // never the old square default.
        const outputSpec = resolveOutputSpec(form)
        const size = outputSpec.size || '1536x2048'
        const payload = {
          prompt: text,
          size,
          references,
          profileId: settings ? settings.activeId : undefined,
          model: settings && settings.model ? settings.model : undefined,
        }
        // A second click while the identical job is still queued or running must
        // not spend another paid generation.
        const signature = jobSignature(payload)
        if (jobs.some(job => (job.status === 'queued' || job.status === 'running') && job.signature === signature)) {
          setNotice({ kind: 'error', text: t('queueDuplicate') })
          return
        }
        const job = {
          id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          status: 'queued',
          createdAt: Date.now(),
          prompt: text,
          ratioLabel: `${optionLabel(outputSpec.ratio, lang)} · ${optionLabel(outputSpec.resolution, lang)}`,
          referenceCount: references.length,
          signature,
          payload,
        }
        setJobs(prev => capJobList([job, ...prev]))
        queueRef.current.push(job)
        setNotice({ kind: 'ok', text: t('queueAdded') })
        startQueuedJobs()
      }

      // Re-runs a failed job from the request it kept, as a new row: the failed
      // row stays visible (and stays retryable until its payload is pruned).
      function handleRetryJob(id) {
        const source = jobs.find(job => job.id === id)
        if (!source || !source.payload) return
        if (activeJobsRef.current + queueRef.current.length >= MAX_PENDING_JOBS) {
          setNotice({ kind: 'error', text: t('queueFull') })
          return
        }
        // Belt and braces: if that attempt is somehow still in flight (a watchdog
        // row whose abort never landed), cancel it before spending a new call.
        abortJobRequest(id)
        const retry = {
          ...source,
          id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          status: 'queued',
          createdAt: Date.now(),
          startedAt: undefined,
          finishedAt: undefined,
          items: undefined,
          timings: undefined,
          error: undefined,
          errorRaw: undefined,
          errorCode: undefined,
        }
        setJobs(prev => capJobList([retry, ...prev]))
        queueRef.current.push(retry)
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
            setNotice({ kind: 'error', text: t('copyFailed') })
          }
          document.body.removeChild(area)
        }
      }, [promptValue, t])

      const handleAccent = useCallback(id => {
        setAccentId(id)
        reportStorageFailure(saveJson(LS_ACCENT, { id }))
        if (appCtx) applyAccent(appCtx, id)
      }, [reportStorageFailure])

      const handleSaveSettings = useCallback(async payload => {
        if (!draft || saving) return
        const sentDraft = draft
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
              quality: profile.quality,
              requestType: profile.requestType === 'json' ? 'json' : 'stream',
              apiKey: profile.apiKey || undefined,
              clearApiKey: profile.clearKey === true,
            })),
            vision: visionDraftToPayload(draft.vision),
          }
          const json = await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          setSettings(json.settings || null)
          // Do not discard edits typed while the request was in flight: only
          // re-seed the draft when it is still the snapshot that was sent.
          setDraft(current => (current === sentDraft ? settingsToDraft(json.settings) : current))
          setNotice({ kind: 'ok', text: t('saved') })
          refreshHistory()
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
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
          if (json.settings && json.settings.activeId) {
            setDraft(prev => (prev ? { ...prev, activeId: json.settings.activeId } : prev))
          }
          const name = json.settings && json.settings.name ? json.settings.name : ''
          setNotice({ kind: 'ok', text: name ? `${t('activeNow')} · ${name}` : t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      // Vision endpoints affect extraction only, but switching one should take
      // effect immediately just like the image profiles (otherwise Studio keeps
      // extracting with the previously saved endpoint until Save).
      const handleActivateVision = useCallback(async id => {
        try {
          const json = await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ vision: { activeId: id } }),
          })
          setSettings(json.settings || null)
          const savedActive = json.settings && json.settings.vision ? json.settings.vision.activeId : ''
          setDraft(prev => (prev ? { ...prev, vision: { ...(prev.vision || {}), activeId: savedActive } } : prev))
          setNotice({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      const handleTest = useCallback(async override => {
        const profileId = override && override.profileId ? override.profileId : null
        setTestState({ state: 'testing', profileId })
        try {
          const json = await api('/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(override || {}),
          })
          setTestState({ state: json.ok ? 'ok' : 'fail', message: json.message || json.error || '', profileId })
        } catch (error) {
          setTestState({ state: 'fail', message: errorTextWithDetail(error, t), profileId })
        }
      }, [t])

      const openPanel = useCallback(key => {
        try {
          if (key === 'conversation') appCtx.layout.selectPanel(null)
          else appCtx.layout.selectPanel(key)
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      const startSession = useCallback(() => {
        try {
          appCtx.uiWorkspace.startSession()
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

      const handleReveal = useCallback(async () => {
        try {
          const json = await api('/reveal', { method: 'POST' })
          if (!json || !json.ok) setNotice({ kind: 'error', text: t('revealFailed') })
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
        }
      }, [t])

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
              // The prompt draft is intentionally kept: switching tabs must not
              // discard text typed into the inline editor.
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
            onImport: importPoses,
            onExport: reportPoseExport,
            startNew: poseNew,
          })
        } else if (templatePage) {
          body = h(TemplateLibrary, {
            lang, t,
            templates,
            prompts: reusablePrompts,
            onBack: () => setTemplatePage(false),
            onApply: applyTemplate,
            onUpdate: updateTemplate,
            onDelete: deleteTemplate,
            onOpenPromptLibrary: openPromptLibrary,
            onAdoptPrompt: adoptPromptText,
          })
        } else if (promptPage) {
          body = h(PromptLibrary, {
            lang, t,
            prompts: reusablePrompts,
            draft: promptDraft,
            setDraft: setPromptDraft,
            onBack: closePromptLibrary,
            onSave: saveReusablePrompt,
            onUpdate: updateReusablePrompt,
            onDelete: deleteReusablePrompt,
            onImport: importReusablePrompts,
            onExport: reportPromptExport,
          })
        } else {
          body = h(StudioTab, {
            lang, t, form, update, promptValue, setCustomPrompt,
            onCopy: handleCopy,
            onGenerate: handleEnqueue,
            results, history, lastTiming,
            jobs, onClearFinishedJobs: handleClearFinishedJobs, onRetryJob: handleRetryJob,
            onPreview: setPreview,
            onOpenStudioHistory: refreshHistory,
            onRevealOutput: handleReveal,
            needKey: settings ? !settings.hasApiKey : true,
            onOpenSettings: () => setTab('settings'),
            productRefs,
            onProductFiles: handleProductFiles,
            onRemoveProduct: handleRemoveProduct,
            onDescriptionChange: handleDescriptionChange,
            customPoses,
            onOpenPoseLibrary: () => openPoseLibrary(true),
            extracting,
            onExtractDescription: handleExtractDescription,
            templates,
            onSaveTemplate: saveTemplate,
            onApplyTemplate: applyTemplate,
            onOpenTemplateLibrary: () => setTemplatePage(true),
            prompts: reusablePrompts,
            onOpenPromptLibrary: openPromptLibrary,
            onAdoptPrompt: adoptPromptText,
            referenceCount,
            activeName: settings && settings.name ? settings.name : '',
            activeModel: settings && settings.model ? settings.model : '',
            visionLabel: (() => {
              const vision = settings && settings.vision
              const profiles = vision && Array.isArray(vision.profiles) ? vision.profiles : []
              const profile = profiles.find(item => item.id === vision.activeId)
              if (!profile) return t('visionBadgeBuiltin')
              if (!profile.baseUrl || !profile.model) return t('visionIncomplete')
              return `${t('visionBadgeCustom')} · ${profile.model}`
            })(),
          })
        }
      } else if (tab === 'size') {
        body = h(SizeChartTab, { lang, t })
      } else {
        body = h(SettingsTab, {
          lang, t, settings, draft, setDraft, saving,
          onSave: handleSaveSettings, onActivate: handleActivateProfile,
          onActivateVision: handleActivateVision,
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
        const saved = loadSizePoster()
        if (saved) return { columns: saved.columns, rows: saved.rows }
        return {
          columns: DEFAULT_SIZE_CHART.columns.map(column => ({ ...column })),
          rows: DEFAULT_SIZE_CHART.rows.map(row => ({ ...row, values: { ...row.values } })),
        }
      })
      const [weightUnit, setWeightUnit] = useState(() => {
        const saved = loadSizePoster()
        return saved ? saved.weightUnit : 'kg'
      })
      const [chartImage, setChartImage] = useState(null)
      const [extracting, setExtracting] = useState(false)
      const [logo, setLogo] = useState(null)
      const [logoImage, setLogoImage] = useState(null)
      const [notice, setNotice] = useState(null)
      const [posterDir, setPosterDir] = useState(() => {
        const saved = loadJson(LS_POSTER_DIR, {})
        return saved && typeof saved.dir === 'string' ? saved.dir : ''
      })
      const [savingPoster, setSavingPoster] = useState(false)
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
        const rawWaist = waistColumn && row.values ? row.values[waistColumn.key] : null
        const waist = rawWaist === null || rawWaist === undefined || rawWaist === '' ? NaN : Number(rawWaist)
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

      // The size chart is edited cell by cell (a save per keystroke), so a full
      // profile is reported once instead of on every character.
      const sizeStorageNoticeRef = useRef('')
      const reportSizeStorageFailure = result => {
        if (!result || result.ok) return
        const key = storageErrorStringKey(result.error)
        if (sizeStorageNoticeRef.current === key) return
        sizeStorageNoticeRef.current = key
        setNotice({ kind: 'error', text: t(key) })
      }

      useEffect(() => {
        reportSizeStorageFailure(saveJson(LS_SIZEPOSTER, { columns: chart.columns, rows: chart.rows, weightUnit }))
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
            en: `${SIZE_COLUMN_EN[column.name] || String(column.name || '').toUpperCase()} (cm)`,
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
          context.fillText(row.size || '', x + columns[0].width / 2, rowY + rowHeight / 2 - (suggestion.waist ? 16 : 0), columns[0].width - 14)
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
          setNotice({ kind: 'error', text: t('pickImageFormat') })
          return
        }
        if (file.size > 8 * 1024 * 1024) {
          setNotice({ kind: 'error', text: t('sizeChartTooLarge') })
          return
        }
        try {
          const dataUrl = await readBlobAsDataUrl(file)
          setChartImage({ dataUrl, name: file.name })
          setNotice(null)
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
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
          if (!match) throw userFacingError(t('sizeChartUnreadable'))
          const json = await api('/extract-size', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              references: [{ dataBase64: match[2], mediaType: match[1], name: chartImage.name }],
            }),
          })
          if (!json.columns || !json.rows || json.columns.length === 0 || json.rows.length === 0) {
            throw userFacingError(t('sizeChartNoTable'))
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
          setNotice({ kind: 'error', text: errorText(error, t) })
        } finally {
          setExtracting(false)
        }
      }

      const handleLogoFile = async file => {
        if (!file) return
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          setNotice({ kind: 'error', text: t('pickImageFormat') })
          return
        }
        if (file.size > 5 * 1024 * 1024) {
          setNotice({ kind: 'error', text: t('logoTooLarge') })
          return
        }
        try {
          const dataUrl = await readBlobAsDataUrl(file)
          const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
          if (!match) throw userFacingError(t('imageUnsupported'))
          setLogo({ dataUrl, name: file.name })
          try {
            await api('/ref/logo', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataBase64: match[2], mediaType: match[1], name: file.name }),
            })
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('logoPersistFailed')} ${errorText(error, t)}` })
          }
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(error, t) })
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
        // Keep the raw number text while editing: parsing to Number on every
        // keystroke turned "72." into 72 (dot lost) and "0.5" into 5.
        const value = normalizeSizeCellText(text)
        if (value === undefined) return
        setChart(prev => ({
          ...prev,
          rows: prev.rows.map(row => (
            row.id === id
              ? { ...row, values: { ...(row.values || {}), [key]: value } }
              : row
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

      const posterFilename = () => {
        const now = new Date()
        const pad = value => String(value).padStart(2, '0')
        return `size-chart-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.png`
      }

      const downloadToBrowser = blob => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = posterFilename()
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 2000)
        setNotice({ kind: 'ok', text: t('sizeDownloaded') })
      }

      const encodePoster = blob => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const match = /^data:[^;]+;base64,(.*)$/.exec(String(reader.result || ''))
          if (match) resolve(match[1])
          else reject(new Error('encode failed'))
        }
        reader.onerror = () => reject(reader.error || new Error('encode failed'))
        reader.readAsDataURL(blob)
      })

      const downloadPoster = () => {
        const canvas = canvasRef.current
        if (!canvas || typeof canvas.toBlob !== 'function') return
        const dir = String(posterDir || '').trim()
        canvas.toBlob(async blob => {
          if (!blob) return
          // No folder chosen: keep the plain browser download.
          if (!dir) {
            downloadToBrowser(blob)
            return
          }
          setSavingPoster(true)
          try {
            const dataBase64 = await encodePoster(blob)
            const json = await api('/poster', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dir, name: posterFilename(), dataBase64 }),
            })
            setNotice({ kind: 'ok', text: `${t('sizeSavedTo')} ${json.path || dir}` })
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('sizeSaveFailed')} ${errorText(error, t)}` })
          } finally {
            setSavingPoster(false)
          }
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
          Field,
          { label: t('sizeSaveDir') },
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', {
              value: posterDir,
              placeholder: t('sizeSaveDirHint'),
              onChange: event => {
                const dir = event.target.value
                setPosterDir(dir)
                reportSizeStorageFailure(saveJson(LS_POSTER_DIR, { dir }))
              },
              style: { ...INPUT_STYLE, flex: '1 1 260px' },
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  try {
                    const picked = appCtx && appCtx.uiWorkspace ? await appCtx.uiWorkspace.pickDirectory() : ''
                    if (picked) {
                      setPosterDir(picked)
                      reportSizeStorageFailure(saveJson(LS_POSTER_DIR, { dir: picked }))
                    }
                  } catch (error) {
                    // picker unavailable; editing the text field still works
                  }
                },
                style: ghostButton({ padding: '8px 12px', fontSize: 12.5 }),
              },
              t('pick'),
            ),
            posterDir
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      setPosterDir('')
                      reportSizeStorageFailure(saveJson(LS_POSTER_DIR, { dir: '' }))
                    },
                    style: ghostButton({ padding: '8px 12px', fontSize: 12.5 }),
                  },
                  t('sizeSaveDirClear'),
                )
              : null,
          ),
        ),
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
        jobs, onClearFinishedJobs, onRetryJob,
        onRevealOutput,
        productRefs,
        onProductFiles, onRemoveProduct,
        onDescriptionChange,
        referenceCount,
        customPoses, onOpenPoseLibrary,
        extracting, onExtractDescription,
        templates, onSaveTemplate, onApplyTemplate, onOpenTemplateLibrary,
        prompts, onOpenPromptLibrary,
        onAdoptPrompt,
        activeName, activeModel, visionLabel,
      } = props

      const [templateNaming, setTemplateNaming] = useState(false)
      const [templateName, setTemplateName] = useState('')

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

      // Prompt text is authored only in the prompt library: these fields just pick
      // a saved entry, and clicking the picked chip again clears the field.
      const promptPicker = (kind, valueKey, labelKey) =>
        h(PromptPicker, {
          key: kind,
          t,
          label: t(labelKey),
          kind,
          value: form[valueKey],
          prompts,
          onPick: item => {
            const current = String(form[valueKey] || '').trim()
            update({ [valueKey]: current === String(item.text || '').trim() ? '' : item.text })
          },
          onClear: () => update({ [valueKey]: '' }),
          onOpenLibrary: () => onOpenPromptLibrary(kind),
          onAdopt: onAdoptPrompt ? text => onAdoptPrompt(kind, text) : null,
        })

      const chip = (key, labelKey, options, hintText) =>
        h(ChipGroup, {
          key,
          lang,
          label: t(labelKey),
          hint: hintText || '',
          options,
          value: form[key],
          onChange: value => update({ [key]: value }),
        })

      const managePoseButton = h(
        'button',
        { type: 'button', onClick: onOpenPoseLibrary, style: tintButton() },
        t('fPoseCustom'),
      )

      const quietChip = QUIET_CHIP

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

      const poseChip = item => {
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
      }

      // Actions are listed under their orientation so a long library stays
      // scannable; empty groups are skipped entirely.
      const poseSection = customPoses.length
        ? h(
            'div',
            { style: { marginBottom: 16 } },
            poseLabelRow,
            groupPoses(customPoses).map(group =>
              h(
                'div',
                { key: group.id, style: { marginBottom: 8 } },
                h(
                  'div',
                  { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 5, letterSpacing: 0.2 } },
                  t(`poseGroup${group.id === 'front' ? 'Front' : group.id === 'side' ? 'Side' : 'Back'}`),
                ),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, group.items.map(poseChip)),
              ),
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
        form.modelPrompt && String(form.modelPrompt).trim() ? chip('show', 'fShow', SHOW, t('showHint')) : null,
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
          extra: h('button', { type: 'button', onClick: () => onOpenPromptLibrary(), style: softButton() }, t('promptManage')),
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
            onChange: event => onDescriptionChange(event.target.value),
            rows: Math.min(22, Math.max(2, String(form.desc || '').split('\n').length + 1)),
            style: { ...INPUT_STYLE, resize: 'vertical' },
          }),
          h(
            'div',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 7, lineHeight: 1.55 } },
            `${visionLabel ? `${visionLabel} · ` : ''}${t('lockHint')}`,
            visionLabel
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: onOpenSettings,
                    style: { border: 'none', background: 'transparent', padding: '0 0 0 8px', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', fontSize: 11 },
                  },
                  t('visionConfigure'),
                )
              : null,
          ),
        ),
        h(Hairline),
        h(
          'div',
          { style: { paddingTop: 14 } },
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 16px' } },
            promptPicker('model', 'modelPrompt', 'fModelPrompt'),
            promptPicker('scene', 'backgroundPrompt', 'fBackgroundPrompt'),
          ),
          promptPicker('style', 'extraPrompt', 'fExtraPrompt'),
          h(
            'div',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: -6, lineHeight: 1.55 } },
            t('promptOnlyHint'),
          ),
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
              ? h('div', { title: job.errorRaw || job.error, style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', marginTop: 2, lineHeight: 1.4 } }, job.error)
              : null,
          ),
          // A failed row keeps its request (base64 photos included) so retrying
          // never asks for another upload; older failures lose the payload and
          // simply show no button.
          job.status === 'error' && job.payload && typeof onRetryJob === 'function'
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: () => onRetryJob(job.id),
                  style: textButton({ fontSize: 11.5, flex: 'none', padding: '4px 6px' }),
                },
                t('queueRetry'),
              )
            : null,
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

      // Tooltip for a generated/history thumbnail: which profile + model made it,
      // and whether the host had to retry a gateway that echoed the reference.
      const itemTitle = item => {
        const meta = item && item.meta
        if (!meta) return item && item.name ? item.name : ''
        const lines = []
        const head = [meta.profileName, meta.model].filter(Boolean).join(' · ')
        if (head) lines.push(head)
        lines.push(`${meta.mode === 'edit' ? t('modeEdit') : t('modeText')}${meta.refCount ? ` · ${meta.refCount} ${t('refsCount')}` : ''}`)
        if (meta.echoRetried) lines.push(t('echoRetried'))
        if (meta.prompt) lines.push(String(meta.prompt).slice(0, 180))
        return lines.join('\n')
      }

      const grid = items =>
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 } },
          items.map(item => h(Thumb, {
            key: item.name || item.url,
            src: item.url,
            name: item.name,
            title: itemTitle(item),
            onOpen: () => onPreview(item.url),
          })),
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
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', { type: 'button', onClick: props.onOpenStudioHistory, style: textButton({ fontSize: 12 }) }, t('refresh')),
            h('button', { type: 'button', onClick: onRevealOutput, style: textButton({ fontSize: 12 }) }, t('saveDir')),
          ),
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
      const { lang, t, prompts, draft, setDraft, onBack, onSave, onUpdate, onDelete, onImport, onExport } = props
      // Editing a row opens the fields inside that row; "new prompt" opens the
      // same fields in a card above the list. The draft itself lives in the app so
      // leaving this page cannot silently discard typed text.
      const editor = draft || null
      const [confirmId, setConfirmId] = useState(null)
      const [warning, setWarning] = useState('')
      const [titling, setTitling] = useState(false)
      const confirmWindow = useConfirmWindow(CONFIRM_DELETE_MS)

      const autoTitle = async () => {
        if (!editor) return
        const text = String(editor.text || '').trim()
        if (!text) {
          setWarning(t('titleNeedPrompt'))
          return
        }
        setTitling(true)
        setWarning('')
        try {
          const title = await requestTitle(text, 'prompt')
          setDraft(prev => ({ ...(prev || {}), name: title }))
        } finally {
          setTitling(false)
        }
      }

      const kinds = [
        { id: 'style', labelKey: 'promptKindStyle' },
        { id: 'model', labelKey: 'promptKindModel' },
        { id: 'scene', labelKey: 'promptKindScene' },
      ]
      const kindLabel = kind => {
        const entry = kinds.find(item => item.id === kind)
        return t(entry ? entry.labelKey : 'promptKindStyle')
      }
      // The segmented control needs both languages, so read the dictionaries
      // directly instead of putting one resolved string into both slots.
      const kindOptions = kinds.map(item => ({ id: item.id, zh: STR.zh[item.labelKey], en: STR.en[item.labelKey] }))
      const promptList = Array.isArray(prompts) ? prompts : []

      // Switching to another row while an unsaved draft has text would throw that
      // text away, so the switch is refused until the draft is saved or cancelled.
      const switchDraft = next => {
        if (editor && String(editor.text || '').trim() && editor.id !== next.id) {
          setWarning(t('promptDraftBusy'))
          return
        }
        setWarning('')
        setDraft(next)
      }
      const startNew = () => {
        setConfirmId(null)
        switchDraft({ id: null, kind: 'style', name: '', text: '' })
      }
      const startEdit = prompt => {
        setConfirmId(null)
        switchDraft({
          id: prompt.id,
          kind: prompt.kind || 'style',
          name: prompt.name || '',
          text: prompt.text || '',
        })
      }
      const changeEditor = patch => setDraft(prev => ({ ...(prev || {}), ...patch }))
      const saveEditor = async () => {
        if (!editor) return
        const text = String(editor.text || '').trim()
        if (!text) return
        const kind = ['style', 'model', 'scene'].indexOf(editor.kind) >= 0 ? editor.kind : 'style'
        // Two entries with the same text in one kind cannot be told apart by the
        // studio fields they feed, so the duplicate is refused here.
        const duplicate = promptList.some(item => (
          item.id !== editor.id && (item.kind || 'style') === kind && String(item.text || '').trim() === text
        ))
        if (duplicate) {
          setWarning(t('promptDupBlocked'))
          return
        }
        // An empty title is generated from the text, so saving never needs typing.
        let name = String(editor.name || '').trim()
        if (!name) {
          setTitling(true)
          try {
            name = await requestTitle(text, 'prompt')
          } finally {
            setTitling(false)
          }
        }
        name = clipTitle(name) || localTitle(text, 'prompt')
        setWarning('')
        if (editor.id) onUpdate(editor.id, { kind, name, text })
        else onSave(kind, name, text)
        setDraft(null)
      }
      const remove = prompt => {
        if (confirmId !== prompt.id) {
          setConfirmId(prompt.id)
          confirmWindow.arm(() => setConfirmId(current => (current === prompt.id ? null : current)))
          return
        }
        confirmWindow.disarm()
        setConfirmId(null)
        onDelete(prompt.id)
        if (editor && editor.id === prompt.id) setDraft(null)
      }

      // One click each way: the whole library leaves as a JSON file and comes back
      // through the same shape, so a second machine needs no re-typing.
      const fileInputRef = useRef(null)
      const exportPrompts = () => {
        if (promptList.length === 0) {
          setWarning(t('promptExportEmpty'))
          return
        }
        const payload = buildPromptExport(promptList)
        const saved = downloadTextFile(promptExportFilename(), JSON.stringify(payload, null, 2), 'application/json')
        setWarning(saved ? '' : t('promptExportFailed'))
        if (typeof onExport === 'function') onExport(payload.count, saved)
      }
      const chooseImportFile = () => {
        const input = fileInputRef.current
        if (!input) return
        input.value = ''
        if (typeof input.click === 'function') input.click()
      }
      const importFromFile = async event => {
        const input = event && event.target
        const file = input && input.files && input.files[0]
        if (!file) return
        try {
          const raw = typeof file.text === 'function' ? await file.text() : await readBlobAsText(file)
          const result = parsePromptImport(raw, promptList)
          if (!result.ok) {
            setWarning(t('promptImportInvalid'))
            return
          }
          if (result.entries.length === 0) {
            setWarning(result.invalid && !result.duplicates ? t('promptImportEmpty') : t('promptImportAllDup'))
            return
          }
          setWarning('')
          if (typeof onImport === 'function') {
            onImport(result.entries, { duplicates: result.duplicates, invalid: result.invalid })
          }
        } catch {
          setWarning(t('promptImportInvalid'))
        } finally {
          if (input) input.value = ''
        }
      }

      const editorFields = () => [
        h(
          Field,
          { key: 'name', label: t('promptNameLabel'), hint: t('titleAutoHint') },
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', {
              value: editor.name,
              placeholder: t('promptNamePh'),
              maxLength: TITLE_MAX_CHARS,
              onChange: event => changeEditor({ name: event.target.value }),
              style: { ...INPUT_STYLE, flex: '1 1 200px' },
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: autoTitle,
                disabled: titling || !String(editor.text || '').trim(),
                style: ghostButton({
                  padding: '8px 12px',
                  fontSize: 12.5,
                  opacity: titling || !String(editor.text || '').trim() ? 0.55 : 1,
                  cursor: titling || !String(editor.text || '').trim() ? 'not-allowed' : 'pointer',
                }),
              },
              titling ? t('titleTitling') : t('titleAuto'),
            ),
          ),
        ),
        h(
          Field,
          { key: 'kind', label: t('promptKindLabel') },
          h(Segmented, { options: kindOptions, value: editor.kind, lang, onChange: value => changeEditor({ kind: value }) }),
        ),
        h(
          Field,
          { key: 'text', label: t('promptTextLabel') },
          h('textarea', {
            value: editor.text,
            placeholder: editor.kind === 'model'
              ? t('fModelPromptPh')
              : (editor.kind === 'scene' ? t('fBackgroundPromptPh') : t('fExtraPromptPh')),
            onChange: event => changeEditor({ text: event.target.value }),
            rows: 5,
            style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
          }),
        ),
        h(
          'div',
          { key: 'actions', style: { display: 'flex', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              onClick: saveEditor,
              disabled: !String(editor.text || '').trim(),
              style: {
                ...PRIMARY_BUTTON,
                padding: '7px 16px',
                fontSize: 12.5,
                opacity: String(editor.text || '').trim() ? 1 : 0.55,
              },
            },
            t('saveName'),
          ),
          h('button', { type: 'button', onClick: () => setDraft(null), style: softButton() }, t('cancel')),
        ),
      ]

      const newCard = editor && !editor.id
        ? h(
            Card,
            { key: 'new', style: { marginBottom: 16 } },
            h('div', { style: { fontSize: 13, fontWeight: 650, marginBottom: 12 } }, t('promptNewTitle')),
            editorFields(),
          )
        : null

      const row = prompt => {
        if (editor && editor.id === prompt.id) {
          return h(
            Card,
            { key: prompt.id, style: { padding: '14px 16px' } },
            h('div', { style: { fontSize: 13, fontWeight: 650, marginBottom: 12 } }, t('promptEditTitle')),
            editorFields(),
          )
        }
        return h(
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
      }

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
          h(
            'button',
            {
              type: 'button',
              onClick: exportPrompts,
              style: softButton({ opacity: promptList.length ? 1 : 0.55 }),
            },
            t('promptExport'),
          ),
          h('button', { type: 'button', onClick: chooseImportFile, style: softButton() }, t('promptImport')),
          h('button', { type: 'button', onClick: startNew, style: tintButton() }, t('promptNewForKind')),
        ),
        h('input', {
          key: 'prompt-import-file',
          type: 'file',
          accept: 'application/json,.json',
          ref: fileInputRef,
          style: { display: 'none' },
          onChange: importFromFile,
        }),
        h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 14px', lineHeight: 1.65 } }, t('promptLibraryHint')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '0 0 14px', lineHeight: 1.65 } }, t('promptIOPortHint')),
        warning
          ? h(
              'div',
              { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)', margin: '0 0 12px', lineHeight: 1.6 } },
              warning,
            )
          : null,
        newCard,
        promptList.length === 0
          ? h(Card, { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', padding: '14px 16px' } }, t('promptLibraryEmpty'))
          : groups,
      )
    }

    // ------------------------------------------------------ template library
    // Editable library for the user's own quick templates. Creating happens in
    // the studio ("+ 保存为模板"); this page renames/edits/deletes them. Prompt
    // fields are picked from the prompt library, never typed here.
    function TemplateLibrary(props) {
      const { lang, t, templates, prompts, onBack, onApply, onUpdate, onDelete, onOpenPromptLibrary, onAdoptPrompt } = props
      const [editor, setEditor] = useState(null)
      const [confirmId, setConfirmId] = useState(null)
      const confirmWindow = useConfirmWindow(CONFIRM_DELETE_MS)

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
          confirmWindow.arm(() => setConfirmId(current => (current === template.id ? null : current)))
          return
        }
        confirmWindow.disarm()
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
            h(PromptPicker, {
              key: 'model',
              t,
              label: t('fModelPrompt'),
              kind: 'model',
              value: editor.modelPrompt,
              prompts,
              onPick: item => changeEditor({ modelPrompt: item.text }),
              onClear: () => changeEditor({ modelPrompt: '' }),
              onOpenLibrary: onOpenPromptLibrary ? () => onOpenPromptLibrary('model') : null,
              onAdopt: onAdoptPrompt ? text => onAdoptPrompt('model', text) : null,
            }),
            h(PromptPicker, {
              key: 'scene',
              t,
              label: t('fBackgroundPrompt'),
              kind: 'scene',
              value: editor.backgroundPrompt,
              prompts,
              onPick: item => changeEditor({ backgroundPrompt: item.text }),
              onClear: () => changeEditor({ backgroundPrompt: '' }),
              onOpenLibrary: onOpenPromptLibrary ? () => onOpenPromptLibrary('scene') : null,
              onAdopt: onAdoptPrompt ? text => onAdoptPrompt('scene', text) : null,
            }),
            h(PromptPicker, {
              key: 'style',
              t,
              label: t('fExtraPrompt'),
              kind: 'style',
              value: editor.extraPrompt,
              prompts,
              onPick: item => changeEditor({ extraPrompt: item.text }),
              onClear: () => changeEditor({ extraPrompt: '' }),
              onOpenLibrary: onOpenPromptLibrary ? () => onOpenPromptLibrary('style') : null,
              onAdopt: onAdoptPrompt ? text => onAdoptPrompt('style', text) : null,
            }),
            h(
              'div',
              { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', margin: '-6px 0 14px', lineHeight: 1.55 } },
              t('promptOnlyHint'),
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
      const { t, customPoses, onSavePose, onDeletePose, onBack, selectedPose, onImport, onExport, startNew } = props
      // editor === null means "browsing". A new draft and an in-place row edit
      // share the same shape so both render the same fields.
      const [editor, setEditor] = useState(() => (
        startNew ? { mode: 'new', id: null, name: '', prompt: '', orientation: 'front' } : null
      ))
      const [flash, setFlash] = useState('')
      const [warning, setWarning] = useState('')
      const [confirmId, setConfirmId] = useState(null)
      const [titling, setTitling] = useState(false)
      const fileInputRef = useRef(null)
      const confirmWindow = useConfirmWindow(CONFIRM_DELETE_MS)

      // Only the description is required: an empty title is generated on save.
      const canSave = Boolean(editor && editor.prompt.trim()) && !titling

      const autoTitle = async () => {
        if (!editor) return
        const prompt = editor.prompt.trim()
        if (!prompt) {
          setWarning(t('titleNeedPrompt'))
          return
        }
        setTitling(true)
        setWarning('')
        try {
          const title = await requestTitle(prompt, 'pose')
          setEditor(prev => (prev ? { ...prev, name: title } : prev))
        } finally {
          setTitling(false)
        }
      }

      const openNew = () => {
        setFlash('')
        setWarning('')
        setConfirmId(null)
        setEditor({ mode: 'new', id: null, name: '', prompt: '', orientation: 'front' })
      }

      const startEdit = item => {
        setFlash('')
        setWarning('')
        setConfirmId(null)
        setEditor({
          mode: 'edit',
          id: item.id,
          name: item.name,
          prompt: item.prompt,
          orientation: poseOrientationOf(item),
        })
      }

      const closeEditor = () => {
        setConfirmId(null)
        setEditor(null)
      }

      const change = patch => {
        setFlash('')
        setWarning('')
        setConfirmId(null)
        setEditor(prev => {
          if (!prev) return prev
          const next = { ...prev, ...patch }
          // Typing a title that names a direction re-groups the action at once, so
          // the chips below show what the title decided instead of an old choice.
          const derived = guessPoseOrientation(next.name, POSE_NAME_TESTS)
          if (derived) next.orientation = derived
          return next
        })
      }

      const save = async () => {
        if (!editor) return
        const prompt = editor.prompt.trim()
        if (!prompt) return
        let name = editor.name.trim()
        if (!name) {
          setTitling(true)
          try {
            name = await requestTitle(prompt, 'pose')
          } finally {
            setTitling(false)
          }
        }
        name = clipTitle(name) || localTitle(prompt, 'pose')
        if (!name) return
        // The saved orientation follows the title first, so the group in the
        // studio matches what the name says even after an auto-generated title.
        const orientation = poseOrientationOf({ name, orientation: editor.orientation, prompt })
        const id = editor.id || `pose-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        onSavePose({ id, name, prompt, orientation })
        setEditor(null)
        setConfirmId(null)
        setFlash(t('poseSaved'))
      }

      const exportPoses = () => {
        setFlash('')
        setWarning('')
        if (customPoses.length === 0) {
          setWarning(t('poseExportEmpty'))
          return
        }
        const payload = buildPoseExport(customPoses)
        const saved = downloadTextFile(poseExportFilename(), JSON.stringify(payload, null, 2), 'application/json')
        if (!saved) {
          setWarning(t('poseExportFailed'))
          return
        }
        if (onExport) onExport(customPoses.length)
      }

      const chooseImportFile = () => {
        const input = fileInputRef.current
        if (!input) return
        input.value = ''
        input.click()
      }

      const importFromFile = async event => {
        const file = event && event.target && event.target.files ? event.target.files[0] : null
        setFlash('')
        setWarning('')
        if (!file) return
        try {
          const raw = typeof file.text === 'function' ? await file.text() : await readBlobAsText(file)
          let parsed = null
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = null
          }
          const result = parsePoseImport(parsed, customPoses)
          const skipped = result.duplicates + result.invalid
          // A readable document that simply yields nothing is not a malformed
          // file, so the "invalid" wording is reserved for unparseable input.
          if (!result.ok) {
            setWarning(t('poseImportInvalid'))
            return
          }
          if (!result.entries.length) {
            if (result.duplicates > 0 && result.invalid === 0) setWarning(t('poseImportAllDup'))
            else if (skipped > 0) setWarning(`${t('poseImportEmpty')}${t('poseImportSkipped')}${skipped}`)
            else setWarning(t('poseImportEmpty'))
            return
          }
          if (onImport) onImport(result.entries)
          setFlash(`${t('poseImportDone')} ${result.entries.length}`)
          if (skipped > 0) setWarning(`${t('poseImportSkipped')}${skipped}`)
        } catch (error) {
          setWarning(t('poseImportInvalid'))
        } finally {
          if (event && event.target) event.target.value = ''
        }
      }

      // Two-step inline delete: the first click arms the row, the second one
      // deletes. This avoids a native confirm dialog, which embedding shells may
      // suppress, and still prevents a single misclick from removing an action.
      const remove = item => {
        if (confirmId !== item.id) {
          setConfirmId(item.id)
          confirmWindow.arm(() => setConfirmId(current => (current === item.id ? null : current)))
          return
        }
        confirmWindow.disarm()
        setConfirmId(null)
        onDeletePose(item.id)
        if (editor && editor.id === item.id) setEditor(null)
      }

      const orientationLabel = id =>
        t(`poseGroup${id === 'front' ? 'Front' : id === 'side' ? 'Side' : 'Back'}`)

      const orientationChips = value =>
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          POSE_ORIENTATIONS.map(id =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                onClick: () => change({ orientation: id }),
                style: {
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: '1px solid ' + (value === id ? 'transparent' : 'var(--dsw-alias-border-l1)'),
                  background: value === id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
                  color: value === id ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                },
              },
              orientationLabel(id),
            ),
          ),
        )

      // The group follows the title: when the title names a direction the chips
      // would be a lie (any click is overruled on save), so they are replaced by a
      // read-only badge that says where the group came from.
      const orientationStatus = draft => {
        const derived = guessPoseOrientation(draft.name, POSE_NAME_TESTS)
        if (!derived) return orientationChips(poseOrientationOf(draft))
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(
            'span',
            {
              style: {
                padding: '4px 12px',
                borderRadius: 999,
                fontSize: 12,
                background: 'var(--dsw-alias-brand-primary)',
                color: '#ffffff',
              },
            },
            orientationLabel(derived),
          ),
          h(
            'span',
            { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
            t('poseOrientAuto'),
          ),
        )
      }

      const orientationHintText = draft =>
        guessPoseOrientation(draft.name, POSE_NAME_TESTS) ? t('poseOrientAutoHint') : t('poseOrientationHint')

      // Same fields for a new draft and for an in-place row edit.
      const editorCard = draft =>
        h(
          Card,
          { style: { borderColor: 'var(--dsw-alias-brand-primary)', marginBottom: 10 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 } },
            h('div', { style: { fontSize: 13, fontWeight: 650 } }, draft.mode === 'edit' ? t('poseEditTitle') : t('poseAddTitle')),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('poseOrientationHint')),
          ),
          h(
            Field,
            { label: t('poseName'), hint: t('titleAutoHint') },
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('input', {
                value: draft.name,
                placeholder: t('poseNamePh'),
                maxLength: TITLE_MAX_CHARS,
                onChange: event => change({ name: event.target.value }),
                style: { ...INPUT_STYLE, flex: '1 1 200px' },
              }),
              h(
                'button',
                {
                  type: 'button',
                  onClick: autoTitle,
                  disabled: titling || !String(draft.prompt || '').trim(),
                  style: ghostButton({
                    padding: '8px 12px',
                    fontSize: 12.5,
                    opacity: titling || !String(draft.prompt || '').trim() ? 0.55 : 1,
                    cursor: titling || !String(draft.prompt || '').trim() ? 'not-allowed' : 'pointer',
                  }),
                },
                titling ? t('titleTitling') : t('titleAuto'),
              ),
            ),
          ),
          h(
            Field,
            { label: t('posePrompt') },
            h('textarea', {
              value: draft.prompt,
              placeholder: t('posePromptPh'),
              onChange: event => change({ prompt: event.target.value }),
              rows: 3,
              style: { ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 },
            }),
          ),
          h(
            Field,
            { label: t('poseOrient'), hint: orientationHintText(draft) },
            orientationStatus(draft),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 4 } },
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
              t('poseSave'),
            ),
            h('button', { type: 'button', onClick: closeEditor, style: ghostButton({ padding: '7px 14px', fontSize: 12.5 }) }, t('cancel')),
          ),
        )

      const rowCard = item =>
        h(
          Card,
          { key: item.id, style: { padding: '12px 14px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 } },
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
                { type: 'button', onClick: () => startEdit(item), style: ghostButton({ padding: '4px 10px', fontSize: 12 }) },
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
        )

      const list = customPoses.length > 0
        ? h(
            'div',
            null,
            groupPoses(customPoses).map(group =>
              h(
                'div',
                { key: group.id, style: { marginBottom: 14 } },
                h(
                  'div',
                  { style: { fontSize: 12.5, fontWeight: 650, margin: '6px 0 8px' } },
                  `${orientationLabel(group.id)} · ${group.items.length}`,
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  group.items.map(item => (
                    editor && editor.mode === 'edit' && editor.id === item.id ? editorCard(editor) : rowCard(item)
                  )),
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
          { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: onBack, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseBack')),
          h('div', { style: { fontSize: 16, fontWeight: 680 } }, t('posePageTitle')),
          h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', onClick: chooseImportFile, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseImport')),
          h('button', { type: 'button', onClick: exportPoses, style: ghostButton({ padding: '6px 12px', fontSize: 12.5 }) }, t('poseExport')),
          h('button', { type: 'button', onClick: openNew, style: tintButton() }, t('poseNew')),
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: 'application/json,.json',
            onChange: importFromFile,
            style: { display: 'none' },
          }),
        ),
        h(
          'div',
          { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 10px', lineHeight: 1.65 } },
          t('posePageHint'),
        ),
        h(
          'div',
          { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, lineHeight: 1.6 } },
          t('poseIOPortHint'),
        ),
        flash ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)', marginBottom: 10 } }, flash) : null,
        warning ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', marginBottom: 10 } }, warning) : null,
        editor && editor.mode === 'new' ? editorCard(editor) : null,
        list,
      )
    }

    // ---------------------------------------------------------- settings tab
    function SettingsTab(props) {
      const {
        lang, t, settings, draft, setDraft, saving, onSave, onActivate, onActivateVision, onTest, testState,
        accentId, onAccent, fidelityText, fidelityDefault, onSaveFidelity, onResetFidelity,
      } = props
      const [models, setModels] = useState(null)
      const [modelState, setModelState] = useState(null)
      const [visionModels, setVisionModels] = useState(null)
      const [visionModelState, setVisionModelState] = useState(null)
      const [fidelityEditing, setFidelityEditing] = useState(false)
      const [fidelityDraft, setFidelityDraft] = useState('')
      const [confirmDelete, setConfirmDelete] = useState(null)
      const confirmWindow = useConfirmWindow(CONFIRM_DELETE_MS)
      const profiles = draft ? draft.profiles : []
      const active = draft ? profiles.find(profile => profile.id === draft.activeId) || profiles[0] || null : null
      const fidelityEdited = typeof fidelityText === 'string' && fidelityText !== fidelityDefault
      const vision = (draft && draft.vision) || { activeId: '', profiles: [] }
      const visionProfiles = Array.isArray(vision.profiles) ? vision.profiles : []
      const activeVisionProfile = visionProfiles.find(profile => profile.id === vision.activeId) || null
      // Async model discovery must never land on a profile the user switched
      // away from: each request records its target id and a sequence number.
      const activeIdRef = useRef(active ? active.id : null)
      const visionIdRef = useRef(activeVisionProfile ? activeVisionProfile.id : null)
      activeIdRef.current = active ? active.id : null
      visionIdRef.current = activeVisionProfile ? activeVisionProfile.id : null
      const modelRequestRef = useRef(0)
      const visionRequestRef = useRef(0)

      /** First click arms a destructive action, second click within 4 s runs it. */
      const armDelete = which => {
        if (confirmDelete === which) {
          confirmWindow.disarm()
          setConfirmDelete(null)
          return true
        }
        setConfirmDelete(which)
        confirmWindow.arm(() => setConfirmDelete(current => (current === which ? null : current)))
        return false
      }

      const updateVision = useCallback(patch => {
        setDraft(prev => (prev ? { ...prev, vision: { ...(prev.vision || {}), ...patch } } : prev))
      }, [setDraft])

      const updateVisionProfile = useCallback(patch => {
        setDraft(prev => {
          if (!prev) return prev
          const currentVision = prev.vision || { activeId: '', profiles: [] }
          const current = (currentVision.profiles || []).find(profile => profile.id === currentVision.activeId)
          if (!current) return prev
          return {
            ...prev,
            vision: {
              ...currentVision,
              profiles: (currentVision.profiles || []).map(profile => (
                profile.id === current.id ? { ...profile, ...patch } : profile
              )),
            },
          }
        })
      }, [setDraft])

      const selectVisionProfile = useCallback(id => {
        setVisionModels(null)
        setVisionModelState(null)
        updateVision({ activeId: id })
        // A switch between already-saved endpoints takes effect immediately (like
        // the image profile chips); a brand-new profile waits for Save.
        const saved = id === '' || Boolean(
          settings && settings.vision && Array.isArray(settings.vision.profiles)
          && settings.vision.profiles.some(profile => profile.id === id),
        )
        if (saved && onActivateVision) onActivateVision(id)
      }, [settings, updateVision, onActivateVision])

      const addVisionProfile = useCallback(() => {
        const first = visionProfiles[0]
        const profile = {
          id: `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: t('newVisionProfileName'),
          baseUrl: first ? first.baseUrl : '',
          model: '',
          apiKey: '',
          hasApiKey: false,
          apiKeyTail: '',
          clearKey: false,
        }
        setVisionModels(null)
        setVisionModelState(null)
        updateVision({ activeId: profile.id, profiles: [...visionProfiles, profile] })
      }, [visionProfiles, updateVision, t])

      const removeVisionProfile = useCallback(() => {
        if (!activeVisionProfile) return
        const remaining = visionProfiles.filter(profile => profile.id !== activeVisionProfile.id)
        setVisionModels(null)
        setVisionModelState(null)
        updateVision({ activeId: remaining.length > 0 ? remaining[0].id : '', profiles: remaining })
      }, [activeVisionProfile, visionProfiles, updateVision])

      const fetchVisionModels = useCallback(async () => {
        if (!activeVisionProfile) return
        const targetId = activeVisionProfile.id
        if (!activeVisionProfile.baseUrl || !activeVisionProfile.baseUrl.trim()) {
          setVisionModelState({ state: 'fail', message: t('needBaseUrl') })
          return
        }
        const requestId = visionRequestRef.current + 1
        visionRequestRef.current = requestId
        setVisionModelState({ state: 'loading' })
        setVisionModels(null)
        try {
          const json = await api('/models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              source: 'vision',
              profileId: targetId,
              baseUrl: activeVisionProfile.baseUrl,
              apiKey: activeVisionProfile.apiKey || undefined,
            }),
          })
          if (visionRequestRef.current !== requestId || visionIdRef.current !== targetId) return
          const ids = Array.isArray(json.ids) ? json.ids : []
          setVisionModels(ids)
          setVisionModelState({ state: 'ok', count: ids.length })
        } catch (error) {
          if (visionRequestRef.current !== requestId || visionIdRef.current !== targetId) return
          setVisionModels(null)
          setVisionModelState({ state: 'fail', message: errorTextWithDetail(error, t) })
        }
      }, [activeVisionProfile, t])

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
          quality: current ? current.quality : '',
          requestType: current ? current.requestType : 'stream',
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
        const targetId = active.id
        if (!String(active.baseUrl || '').trim()) {
          setModelState({ state: 'fail', message: t('needBaseUrl') })
          return
        }
        const requestId = modelRequestRef.current + 1
        modelRequestRef.current = requestId
        setModelState({ state: 'loading' })
        setModels(null)
        try {
          const json = await api('/models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ profileId: targetId, baseUrl: active.baseUrl, apiKey: active.apiKey || undefined }),
          })
          if (modelRequestRef.current !== requestId || activeIdRef.current !== targetId) return
          const ids = json.ids || []
          setModels(ids)
          setModelState({ state: 'ok', count: ids.length })
          // Fill only a blank model. The endpoint list can be partial, and a
          // deliberately typed model must never be replaced silently.
          if (ids.length > 0) {
            setDraft(prev => {
              if (!prev) return prev
              return {
                ...prev,
                profiles: prev.profiles.map(profile => {
                  if (profile.id !== targetId || String(profile.model || '').trim()) return profile
                  return { ...profile, model: ids[0] }
                }),
              }
            })
          }
        } catch (error) {
          if (modelRequestRef.current !== requestId || activeIdRef.current !== targetId) return
          setModels(null)
          setModelState({ state: 'fail', message: errorTextWithDetail(error, t) })
        }
      }, [active, setDraft, t])

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
            quality: profile.quality,
            requestType: profile.requestType === 'json' ? 'json' : 'stream',
            apiKey: profile.apiKey || undefined,
            clearApiKey: profile.clearKey === true,
          })),
          vision: visionDraftToPayload(draft.vision),
        })
      }, [draft, onSave])

      const visionOptionStyle = active => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        padding: '8px 12px',
        borderRadius: 10,
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 12,
        border: active ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
        background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' : 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
      })

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
            Field,
            { label: t('sRequestType'), hint: t('sRequestTypeHint') },
            h(Segmented, {
              lang,
              value: active.requestType === 'json' ? 'json' : 'stream',
              onChange: id => updateProfile({ requestType: id }),
              options: [
                { id: 'stream', zh: t('sRequestTypeStream'), en: t('sRequestTypeStream') },
                { id: 'json', zh: t('sRequestTypeJson'), en: t('sRequestTypeJson') },
              ],
            }),
          ),
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
                testState && testState.state === 'testing' && (!testState.profileId || testState.profileId === active.id) ? t('testing') : t('test')),
              testState && (!testState.profileId || testState.profileId === active.id)
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
                  onClick: () => {
                    if (armDelete('image')) removeProfile()
                  },
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
                confirmDelete === 'image' ? t('confirmRemove') : t('deleteProfile'),
              ),
              profiles.length <= 1
                ? h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, t('lastProfileWarn'))
                : null,
            ),
          ),
        ),
        h(SectionTitle, { title: t('visionTitle') }),
        h(
          Card,
          { style: { marginBottom: 20 } },
          h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, lineHeight: 1.65 } }, t('visionHint')),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 } },
            h(
              'button',
              {
                type: 'button',
                onClick: () => selectVisionProfile(''),
                style: visionOptionStyle(!activeVisionProfile),
              },
              h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, t('visionBuiltinName')),
              h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('visionBuiltinHint')),
            ),
            visionProfiles.map(profile =>
              h(
                'button',
                {
                  key: profile.id,
                  type: 'button',
                  title: profile.baseUrl,
                  onClick: () => selectVisionProfile(profile.id),
                  style: visionOptionStyle(Boolean(activeVisionProfile && activeVisionProfile.id === profile.id)),
                },
                h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, profile.name || t('newVisionProfileName')),
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, profile.model || profile.baseUrl || '—'),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: addVisionProfile,
                style: {
                  padding: '8px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 12,
                  border: '1px dashed var(--dsw-alias-border-l2)',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              t('visionAddProfile'),
            ),
          ),
          activeVisionProfile
            ? h(
                'div',
                null,
                h(
                  Field,
                  { label: t('profileName') },
                  h('input', {
                    value: activeVisionProfile.name || '',
                    placeholder: t('profileNamePh'),
                    onChange: event => updateVisionProfile({ name: event.target.value }),
                    style: INPUT_STYLE,
                  }),
                ),
                h(
                  Field,
                  { label: t('visionBaseUrl'), hint: t('visionBaseUrlHint') },
                  h('input', {
                    value: activeVisionProfile.baseUrl || '',
                    placeholder: 'https://api.openai.com/v1',
                    onChange: event => updateVisionProfile({ baseUrl: event.target.value }),
                    style: INPUT_STYLE,
                  }),
                ),
                h(
                  Field,
                  {
                    label: t('visionModel'),
                    hint: t('visionModelHint'),
                    extra: h(
                      'button',
                      {
                        type: 'button',
                        onClick: fetchVisionModels,
                        disabled: visionModelState && visionModelState.state === 'loading',
                        style: ghostButton({ padding: '3px 9px', fontSize: 11.5 }),
                      },
                      visionModelState && visionModelState.state === 'loading' ? t('sFetching') : `⟳ ${t('sFetchModels')}`,
                    ),
                  },
                  h('input', {
                    value: activeVisionProfile.model || '',
                    placeholder: 'gpt-4o-mini',
                    onChange: event => updateVisionProfile({ model: event.target.value }),
                    style: INPUT_STYLE,
                  }),
                  visionModelState
                    ? h(
                        'div',
                        {
                          style: {
                            fontSize: 11,
                            marginTop: 5,
                            wordBreak: 'break-word',
                            color: visionModelState.state === 'fail' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        visionModelState.state === 'ok'
                          ? `${visionModelState.count} ${t('sModelsFound')}`
                          : visionModelState.state === 'fail'
                            ? visionModelState.message
                            : '',
                      )
                    : null,
                  visionModels
                    ? h(
                        'div',
                        { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxHeight: 112, overflowY: 'auto' } },
                        visionModels.map(id =>
                          h(
                            'button',
                            {
                              key: id,
                              type: 'button',
                              title: id,
                              onClick: () => updateVisionProfile({ model: id }),
                              style: {
                                padding: '4px 9px',
                                borderRadius: 8,
                                fontSize: 11.5,
                                cursor: 'pointer',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                border: activeVisionProfile.model === id ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
                                background: activeVisionProfile.model === id ? 'var(--dsw-alias-brand-primary)' : 'transparent',
                                color: activeVisionProfile.model === id ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                              },
                            },
                            id,
                          ),
                        ),
                      )
                    : null,
                ),
                h(
                  Field,
                  {
                    label: t('visionKey'),
                    hint: activeVisionProfile.hasApiKey
                      ? `${t('sKeyPhSet')}${activeVisionProfile.apiKeyTail ? `（••••${activeVisionProfile.apiKeyTail}）` : ''}`
                      : undefined,
                  },
                  h('input', {
                    type: 'password',
                    value: activeVisionProfile.apiKey || '',
                    placeholder: activeVisionProfile.hasApiKey ? t('sKeyPhSet') : t('sKeyPhEmpty'),
                    onChange: event => updateVisionProfile({ apiKey: event.target.value }),
                    style: INPUT_STYLE,
                    autoComplete: 'off',
                  }),
                  h(
                    'label',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 8, cursor: 'pointer' } },
                    h('input', { type: 'checkbox', checked: activeVisionProfile.clearKey === true, onChange: event => updateVisionProfile({ clearKey: event.target.checked }) }),
                    t('sClearKey'),
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      marginTop: 2,
                      color: activeVisionProfile.baseUrl && activeVisionProfile.model
                        ? 'var(--dsw-alias-label-secondary)'
                        : 'var(--dsw-alias-state-warn-primary)',
                    },
                  },
                  activeVisionProfile.baseUrl && activeVisionProfile.model
                    ? `${t('visionUsingCustom')} · ${activeVisionProfile.name || activeVisionProfile.model || '—'}`
                    : t('visionIncomplete'),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' } },
                  h('button', { type: 'button', onClick: saveAll, disabled: saving, style: { ...PRIMARY_BUTTON, opacity: saving ? 0.7 : 1 } }, saving ? '…' : t('save')),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        if (armDelete('vision')) removeVisionProfile()
                      },
                      style: ghostButton({ padding: '8px 12px', fontSize: 12.5, color: 'var(--dsw-alias-state-error-primary)' }),
                    },
                    confirmDelete === 'vision' ? t('confirmRemove') : t('visionDeleteProfile'),
                  ),
                ),
              )
            : h(
                'div',
                null,
                h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, t('visionUsingBuiltin')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' } },
                  h('button', { type: 'button', onClick: saveAll, disabled: saving, style: { ...PRIMARY_BUTTON, opacity: saving ? 0.7 : 1 } }, saving ? '…' : t('save')),
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
                        setFidelityDraft(prettyFidelity(fidelityText))
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
                  rows: 20,
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
                        if (onSaveFidelity(fidelityDraft) === false) return
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
                    { type: 'button', onClick: () => setFidelityDraft(prettyFidelity(fidelityDefault)), style: textButton({ color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 }) },
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
          // The saved accent is validated (a hand-edited id cannot leave the
          // palette without a highlight): loadAccentId() falls back to default.
          applyAccent(ctx, loadAccentId())
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
