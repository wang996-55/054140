# 爆款图复刻 · 插件内实现契约（v2.3.0）

本文是 `@local/ai-replica` 的权威契约：运行时映射、数据形状、Host 路由、模块 API、Client 片段与存储布局。
《AI_爆款图复刻_开发文档_V4.1》描述产品行为；本文描述在本 Harness 里**具体怎么落地**。两者冲突时以本文的工程细节为准，行为目标仍以 V4.1 为准。

---

## 0. 运行时形态（与原文档的差异）

| V4.1 | 本插件 | 原因 |
| --- | --- | --- |
| Vue3 + Konva | React（`React.createElement`）+ Canvas 2D | Client 半只暴露 React |
| FastAPI 本地服务 + HTTP | Cordis Host 半，同源路由 `/api/ai-replica/*` | `ctx.webServer.register`，无额外端口 |
| Pillow / OpenCV 合成 | `lib/compositor.js`（纯 JS，RGBA 缓冲 + bilinear + supersampling） | 无原生依赖、确定性、可单测 |
| `rembg` 抠图 | 浏览器端边缘泛洪 + 色彩距离 + 形态学 + 羽化，**强制人工确认** | 插件内不带模型；人工门禁兜底 |
| 本地磁盘任意路径 | `<DSH_PROFILE_DIR 或 ~/.dsh>/ai-replica/` | 原子写 + 路径穿越防护 |

约束：所有付费调用只发生在 Host 进程；Client 永远看不到 API Key；导出只由 Host 合成器产出。

---

## 1. 数据契约

### 1.1 Scene JSON（`scene_analysis.json`）

```jsonc
{
  "schema_version": "1.0",
  "reference_type": "ecommerce|apparel|marketing_poster|social_post|creative_poster|other",
  "camera": { "angle": "eye_level|top_down|three_quarter|low_angle|unknown",
              "expected_product_view": "front|side|back|top|angle_45|unknown",
              "confidence": 0.0 },
  "lighting": { "direction": "top_left|top_right|left|right|top|front|back|diffuse|mixed|unknown",
                "softness": "hard|soft|diffuse|unknown",
                "temperature": "warm|neutral|cool|unknown",
                "confidence": 0.0 },
  "support_surface": { "type": "tabletop|floor|podium|shelf|wall|suspended|none|unknown",
                       "orientation": "horizontal|vertical|unknown",
                       "contact_point_hint": "bottom_center|bottom_left|bottom_right|center|unknown" },
  "placement": { "preferred_region": "center|left|right|top|bottom|full_bleed|unknown",
                 "clearance": "clear|partial|blocked|unknown",
                 "needs_user_confirmation": true },
  "scene_description": "≤600 字",
  "color_palette": [{ "name": "暖白", "hex": "#F3EEE6" }],
  "style_tags": ["clean"],
  "reference_texts": [],
  "risks": []
}
```

- 归一化在 `lib/schema.js#normalizeScene`：接受中英文别名（如 `顶视 → top_down`、`正面 → front`），未知值降级 `unknown`，`hex` 统一 `#rrggbb`。
- 文件分两层：`scene_analysis.json` 是模型原始结论（附 `raw_text`、`model`、`created_at`）；`scene_review.json` 是人工审核结论 `{ scene, confirmed:{path:true}, updated_at }`。`effectiveScene()` 优先 review。
- 门禁：`unconfirmedAfterReview(scene, confirmed)` 返回仍为 `unknown`（或 `placement.needs_user_confirmation === true` 且未确认）的路径；非空即 `scene-unconfirmed`（409）。

### 1.2 Product profile JSON（`product_profile.json`）

上传商品图后立刻调用视觉模型，用**内置固定提示词**按固定顺序提取商品信息；解析与补全在 `lib/product.js`。

```jsonc
{
  "schema_version": "1.0",
  "profile": {
    "schema_version": "1.0",
    "name": "不锈钢保温杯 500ml",     // 1. 商品名称
    "selling_points": ["316 内胆", "24 小时保温"],  // 2. 核心卖点，最多 3 项
    "color": "哑光黑",               // 3. 规格参数 (1) 颜色
    "appearance": "圆柱形杯体",       // 3. 规格参数 (2) 外观
    "notes": []                     // ["信息冲突"] 时表示原始资料互相矛盾
  },
  "raw_text": "模型原样输出",
  "model": "vision-x",
  "prompt_version": "1",
  "created_at": "2026-01-01T00:00:00.000Z",
  "source": "vision|manual"
}
```

- 解析：`parseProductText()` 先试 JSON（模型偶尔仍回 JSON），否则按标签行解析（容忍 `**1. 商品名称：**`、`1.商品名称:`、`（1）颜色：`、英文标签）。
- 缺失字段一律 `未提供`；互相矛盾填 `信息冲突`；卖点去重并截断到 3 项。**不推测、不补全**。
- `hasProductInfo()` 全为占位符时返回 false，Host 报 `product-empty`(422)，不会假装成功。
- 用途：`compileScenePrompt({ product })` 与 `compileBackgroundPrompt({ product })` 都会带上 `productSummary()`，让场景判断与背景配色对齐真实商品；`snapshot.product` 只给界面展示。

### 1.3 Composition JSON（`composition.json`）

```jsonc
{
  "schema_version": "1.0",
  "canvas": { "width": 1024, "height": 1024, "preset": "1:1" },
  "background": { "asset_id": "...", "sha256": "..." },
  "product": { "asset_id": "...", "mask_id": "...", "sha256": "...",
               "cx": 0.5, "cy": 0.6, "width_ratio": 0.42,
               "rotation_deg": 0, "opacity": 1, "visible": true },
  "shadow": { "enabled": true, "offset_x": 0, "offset_y": 1.5, "blur": 4,
              "opacity": 0.35, "color": "#000000", "contact": true },
  "adjustments": { "enabled": false, "brightness": 0, "warmth": 0 },
  "text_layers": [
    { "id": "t1", "text": "新品上架\n限时 8 折", "font_family": "sans",
      "font_size": 0.07, "line_height": 1.25, "color": "#111111",
      "align": "left", "x": 0.08, "y": 0.1, "width": 0.5,
      "placement": "behind|front", "visible": true,
      "weight": "medium|bold", "shadow": false }
  ],
  "meta": { "created_at": "...", "updated_at": "...", "params_version": "1.0" }
}
```

`background.asset_id` / `product.asset_id` 允许空串（首次保存画布参数时可能还没定），但**导出**时必须非空，否则 `background-missing` / `mask-unconfirmed`。

### 1.3 Composition 几何计划（Host 权威）

`lib/compositor.js#planComposition(composition)`，`S = min(width, height)`：

| 量 | 公式 | 说明 |
| --- | --- | --- |
| `pw` | `width_ratio × canvas.width` | 商品目标宽度 |
| `ph` | `pw × source_height / source_width` | 宽高比来自真实商品图 |
| `cx, cy` | `product.cx × width`, `product.cy × height` | 归一化中心 |
| `dx, dy` | `offset_x × S / 100`, `offset_y × S / 100` | **短边百分比** |
| `radius` | `blur × S / 100` | **短边百分比**（最多 20% 短边） |
| `fontPx` | `font_size × S` | 文字层 |
| `lineHeight` | `fontPx × line_height` | |
| `x, y, box` | `x × width`, `y × height`, `width × width` | 文字框 |

schema 范围：`offset_x/offset_y ∈ [-20, 20]`、`blur ∈ [0, 20]`，默认 `0 / 1.5 / 4`。
导出顺序：背景 cover → `overlayBehind` → 阴影（含接触阴影）→ 商品 bilinear 仿射 → `overlayFront`。
商品 alpha = 源 alpha × 蒙版 alpha × `opacity`；`visible:false` 连阴影一起不画。

### 1.4 任务与状态机

```
created → product_review → analyzing → scene_review → mask_review → background_review → editing → exporting → done
```

`ALLOWED`（`lib/tasks.js`）另含：`product_review → analyzing`（商品信息确认/跳过）、`created → analyzing`（老流程/创意模式）、`scene_review → analyzing`（重分析）、`remote_outcome_unknown → analyzing | scene_review | cancelled`、`mask_review ⇄ mask_rejected`、任意活动态 → `failed | cancelled`、`done → editing`（回炉）。

`task.json` 关键字段：

```jsonc
{
  "id": "t-...", "state": "editing", "created_at": "...", "updated_at": "...",
  "submitted": { "form": {...}, "assets": { "reference": {...}, "product": {...}|null } },
  "budget": { "product_calls": 1, "max_product_calls": 2,
              "vision_calls": 1, "max_vision_calls": 1, "image_calls": 1, "max_image_calls": 1 },
  "product": { "profile_asset": "product_profile.json", "confirmed": true, "source": "vision|manual|skipped" },
  "scene": { "analysis_asset": "scene_analysis.json", "review_asset": "scene_review.json" },
  "cutout": { "product_asset": {...}, "mask_asset": {...}, "mode": "auto|transparent",
              "width": 1200, "height": 1600, "reviewed": true },
  "backgrounds": [ { "id": "bg1", "file": "...", "normalized_file": "...",
                     "source": "generate|upload", "asset": "...", "sha256": "..." } ],
  "background_version_id": "bg1",
  "compatibility": { "checked": true, "level": "ok|warn", "issues": [], "overridden": false },
  "exports": [ { "file": "exports/xxx.png", "width": 1024, "height": 1024,
                 "bytes": 123456, "composition_sha256": "..." } ],
  "accept": { "rating": 5, "notes": "..." },
  "error": { "code": "...", "message": "..." }
}
```

### 1.5 提交表单

```jsonc
{
  "reference_type": "ecommerce", "mode": "style_reference|high_fidelity", "fidelity": 0.8,
  "creative_mode": false, "product_view": "front", "product_kind": "apparel|non_apparel",
  "user_requirement": "", "lang": "zh|en", "aspect": "1:1|4:5|3:4|16:9",
  "output_size": 1024, "background_count": 1
}
```

`output_size` 是**短边**；`aspect` 推出画布：`1:1 → s×s`、`4:5 → s×(s·1.25)`、`3:4 → s×(s·4/3)`、`16:9 → (s·16/9)×s`（`lib/api.js#canvasSize`，与 Client `aspectSize` 一致）。

### 1.6 中转站设置（`settings.json`，schema 2.1）

**视觉接口与生图接口各自使用独立配置**：两条通道分别保存 `base_url / path / model / auth / headers / timeout_ms`，可以指向不同中转站、不同账号、不同 Key。

```jsonc
{
  "schema_version": "2.1",
  "vision": {
    "provider": "openai_chat|openai_responses|anthropic|gemini",
    "base_url": "https://relay-a.example.com/v1",
    "path": "/chat/completions",
    "model": "gpt-4o-mini",
    "auth": "bearer|x-api-key|api-key|google|none",
    "headers": { "X-Relay-Token": "..." },
    "timeout_ms": 120000,
    "detail": "auto|low|high",
    "max_tokens": 0
  },
  "image": {
    "provider": "openai_images|openai_chat|gemini",
    "base_url": "https://relay-b.example.com/v1",
    "path": "/images/generations",
    "edit_path": "/images/edits",
    "model": "gpt-image-1",
    "edit_model": "",
    "auth": "bearer|x-api-key|api-key|google|none",
    "headers": {},
    "timeout_ms": 300000,
    "size": "1024x1024",
    "response_format": "b64_json|url",
    "quality": ""
  },
  "allow_localhost": false,
  "max_download_bytes": 33554432,
  "max_base64_bytes": 33554432
}
```

- `path` 可写相对路径（拼在 `base_url` 后）或**完整 URL**（含查询串，部分中转站把 key 放在 query 里）；`{model}` 占位符会被展开，例如 `"/models/{model}/generations"`。
- `models_path` 是「一键拉取模型」用的列表地址，留空即 `<base_url>/models`；同样可写完整 URL 与查询串。
- `headers` 用于第三方中转站要求的额外令牌（`X-Relay-Token`、`HTTP-Referer` 等），与 `auth` 生成的认证头合并。
- **Key 隔离**：`vision_api_key` 与 `image_api_key` 分别保存，互不串用；解析顺序为环境变量 `REPLICA_VISION_API_KEY` / `REPLICA_IMAGE_API_KEY` → `REPLICA_API_KEY` → `OPENAI_API_KEY` → `secrets.json`（`vision_api_key` / `image_api_key`，兼容旧的 `api_key`）。Key 永不返回给 Client、永不写日志。
- 旧版扁平设置（`base_url` / `models` / `protocols` / `paths` / `timeout_ms` / `image_*`）经 `lib/relay.js#migrateLegacySettings` 自动升级为双通道。
- 第三方兼容：视觉支持 `openai_chat` / `openai_responses` / `anthropic` / `gemini` 四种请求与响应形态；生图支持 `openai_images`（`/images/generations`、`/images/edits` multipart）、`openai_chat`（部分中转站用 chat 出图）、`gemini`（`generateContent`）。图片回包解析兼容 `b64_json` / `url` / markdown 链接 / 裸 base64 / `output` 块。

---

## 2. Host HTTP 契约（同源，前缀 `/api/ai-replica`）

所有响应 `{ ok: true, ... }`；错误 `{ ok: false, code, error, detail? }`，HTTP 状态由 `lib/errors.js#CODES` 决定。
**所有路由都做 Origin/Host 信任检查**：`Sec-Fetch-Site: cross-site` → 403；`Host` 不在信任集合 → 403；带 `Origin`/`Referer` 且不是同源（含 loopback 别名）→ 403。

| 方法 & 路径 | 请求 | 成功响应 | 主要错误 |
| --- | --- | --- | --- |
| `GET /health` | — | `{ version, root, has_key, configured, source, vision:{has_key,source}, image:{has_key,source}, cutout:'local-browser', compositor:'host-node' }` | — |
| `GET /settings` | — | `{ settings, has_key, configured, source, vision, image, enums, labels, composition_enums, relay, versions }` | — |
| `PUT /settings` | `{ settings, vision_api_key?, image_api_key? }`（旧的 `api_key` 会同时写入两条通道） | `{ settings, has_key, configured, source, vision, image }` | `bad-request` |
| `POST /settings/test` | `{ kind:'vision'\|'image', confirm_cost:true }` | `{ ok, kind, ms, ...provider }`（各用自己通道的 url / model / key） | `bad-request`（未确认）、`provider-*` |
| `POST /settings/models` | `{ kind:'vision'\|'image', channel? }`（`channel` 可带未保存的中转站地址） | `{ ok, kind, count, models:[id], ms }` | `provider-missing`(409)、`provider-auth`(502)、`provider-error`(502)、`provider-timeout-unknown`(504) |
| `GET /tasks?limit=` | — | `{ total, items:[{ id, state, reference_type, rating, export, thumbnail, created_at, updated_at }] }` | — |
| `POST /tasks` | `{ form, images:{ reference, product? } }`（data URL） | 完整 snapshot | `product-required`(400)、`asset-invalid` |
| `GET /task?id=` | — | 完整 snapshot | `not-found`(404) |
| `DELETE /task?id=&confirm=1` | — | `{ deleted:id }` | `bad-request`（未确认） |
| `POST /analyze?id=` | `{}` | 完整 snapshot | `budget-exhausted`(409)、`scene-schema-invalid`(502)、`provider-missing`(409)、`provider-auth`(502)、`provider-rate-limit`(429)、`provider-timeout-unknown`(504) |
| `POST /describe?id=` | `{}` | snapshot（含 `product.profile`） | `product-required`(400)、`product-empty`(422)、`invalid-state`(409)、`budget-exhausted`(409)、`provider-*` |
| `PUT /product-profile?id=` | `{ profile:{ name, selling_points, color, appearance } }` | snapshot（`source:"manual"`） | `bad-request`(400) |
| `POST /product-skip?id=` | `{}` | snapshot（`source:"skipped"`） | `invalid-state`(409) |
| `PUT /scene-review?id=` | `{ scene, confirmed:{path:true} }` | snapshot（state→`mask_review`） | `scene-unconfirmed`(409)、`scene-schema-invalid` |
| `POST /cutout?id=` | `{ mode, product_png, mask_png }` | snapshot | `asset-invalid` |
| `PUT /mask?id=` | `{ confirm:true, product_png?, mask_png?, confirm_continue? }` | snapshot（state→`background_review`，写入 `compatibility`） | `mask-unconfirmed`、`view-mismatch`(409) |
| `POST /compatibility?id=` | `{ confirm_continue? }` | snapshot | `view-mismatch` |
| `POST /background?id=` | `{ mode:'generate' }` / `{ mode:'upload', image }` / `{ mode:'select', version_id, normalized_png?, confirm? }` | snapshot（confirm→`editing`） | `budget-exhausted`、`background-missing`、`provider-*` |
| `PUT /composition?id=` | `{ composition }` | snapshot | `composition-invalid` |
| `POST /export?id=` | `{ composition?, overlays:{ behind?, front? } }` | `{ export:{ file, width, height, bytes, sha256 }, url, ...snapshot }` | `mask-unconfirmed`、`background-missing`、`compose-invalid` |
| `POST /accept?id=` | `{ rating:1..5, notes }` | snapshot（state→`done`） | `bad-request` |
| `POST /cancel?id=` | `{}` | snapshot（state→`cancelled`） | — |
| `GET /file?task=&file=` | — | PNG/JPEG 二进制 | `bad-request`（穿越）、`asset-invalid` |
| `POST /reveal` | `{ task }` | `{ ok, dir }` | — |

> **为什么不是 `/tasks/:id/...`**：`/api` 前缀下有连接网关（`ctx.connection`）自己的 handler，它在同一个 `/api` 前缀上优先应答，把任何未被精确注册的 `/api/*/*/...` 路径当成 RPC 端点并返回 `401 unauthorized`（实测）。因此本插件只注册 **精确路径**，任务 id 走查询参数 `?id=`，`prefix` 路由一律不用。

**snapshot**（所有返回任务的响应同一形状）：

```jsonc
{
  "ok": true, "version": "2.0.0",
  "task": { },                          // task.json
  "scene": { "analysis": { } , "review": { }, "effective": { }, "missing": ["camera.angle"] },
  "urls": {
    "reference": "...", "product": "...", "product_rgba": "...", "mask": "...",
    "backgrounds": [{ "id": "bg1", "url": "...", "normalized": "..." }],
    "exports": ["..."]
  },
  "composition": { },                   // composition.json（未保存过为 null）
  "composition_default": { },           // 按表单推出的默认参数（含画布尺寸与资产 id）
  "prompts": { "background": { "text": "...", "version": "1", "hash": "..." } }
}
```

---

## 3. Host 模块契约

### `lib/errors.js`
`CODES`（code → `{status, zh}`）、`class AppError(code, message, opts)`、`toErrorPayload(error) → {status, payload}`、`fail(code, message)`。
对外 code：`bad-request` `method-not-allowed` `not-found` `cross-site-denied` `product-required` `asset-invalid` `scene-schema-invalid` `scene-unconfirmed` `mask-unconfirmed` `view-mismatch` `background-missing` `composition-invalid` `compose-invalid` `provider-auth` `provider-rate-limit` `provider-error` `provider-timeout-unknown` `budget-exhausted` `conflict` `internal`。

### `lib/store.js`
`profileRoot()` `rootDir()` `taskDir(id)` `assetsDir(id)` `exportsDir(id)` `ensureRoot()` `sha256(buf)` `safeId(id)` `newId(prefix)` `containedPath(base, rel)` `writeJsonAtomic` `writeBytesAtomic` `readJson` `withLock(key, fn)` `detectImageType(buf)` `saveAsset(taskId, {kind, buffer, ext})` `readAssetFile` `readAssetBuffer(taskId, assetId)`。

### `lib/schema.js`
`SCENE_ENUMS` `COMPOSITION_ENUMS` `SCENE_LABELS_ZH` `SCENE_SCHEMA` `COMPOSITION_SCHEMA` `validateScene` `validateComposition` `coerceHex` `defaultScene()` `normalizeScene(raw)` `ratioPreset(w, h)` `defaultComposition(seed)` `normalizeComposition(raw)` `unconfirmedPaths` `mergeSceneReview` `unconfirmedAfterReview(scene, confirmed)`。

### `lib/relay.js`
`VISION_PROVIDERS` `IMAGE_PROVIDERS` `AUTH_STYLES` `DEFAULT_VISION` `DEFAULT_IMAGE` `DEFAULT_SHARED` `defaultSettings()` `migrateLegacySettings(raw)` `normalizeVision` `normalizeImage` `normalizeProviderSettings(next, current)` `resolveChannelKey(channel, secrets, env)` `keyState(secrets, env)` `channelHeaders(channel, apiKey)` `channelUrl(channel)` `channelUrlForModel(channel)` `modelListUrl(channel)` `parseModelList(payload)` `listModels({channel, apiKey, fetchImpl, timeoutMs, allowLocalhost})` `buildVisionRequest` `callVision({channel, apiKey, prompt, images, fetchImpl, timeoutMs})` `buildImageRequest` `generateImage({channel, shared, apiKey, prompt, size, referenceImages, fetchImpl, timeoutMs})` `testProvider({settings, visionKey, imageKey, kind})` `splitDataUrl` `parseImageResponse(payload)` `assertSafeRemoteUrl(url, allowLocalhost)` `downloadImage(url, opts)` `class RelayError`。
两条通道完全独立：视觉只读 `settings.vision` + 视觉 Key，生图只读 `settings.image` + 生图 Key。
`modelListUrl` 默认 `<base_url>/models`，可用通道字段 `models_path` 覆盖（支持完整 URL 与查询串）。
SSRF：拒绝私网 / 环回 / CGNAT / 元数据地址，除非 `allow_localhost`；重定向手动跟随并逐跳校验；响应体有体积上限。

### `lib/prompts.js`
`SCENE_PROMPT_VERSION='1'` `BACKGROUND_PROMPT_VERSION='1'` `PRODUCT_PROMPT_VERSION='1'` `PRODUCT_PROMPT_ZH`（内置商品信息提取提示词，逐字保留）`PRODUCT_PROMPT_EN` `compileProductPrompt({lang, extra}) → {system, user, version}` `compileScenePrompt({lang, form, product})` `compileBackgroundPrompt({lang, scene, form, product}) → {text, version, hash, parts:{angle, light, surface, reserve, ban}}` `promptFingerprint(scene)`。
背景提示词固定含五段：机位 / 光源 / 承载面 / 预留区域 / 禁止项（禁止出现商品、logo、文字、人物等）。
`product` 非空时场景提示词与背景提示词都会追加一行商品摘要，用于对齐视角、配色与尺度。

### `lib/product.js`
`PRODUCT_SCHEMA_VERSION='1.0'` `UNKNOWN_VALUE='未提供'` `CONFLICT_VALUE='信息冲突'` `MAX_SELLING_POINTS=3` `parseProductText(raw)` `normalizeProductProfile(input)` `hasProductInfo(profile)` `productSummary(profile,{lang})` `productLines(profile)`。
顺序固定：1 商品名称 → 2 核心卖点（最多 3）→ 3 规格参数（颜色、外观）；不做任何推测补全。

### `lib/scene.js`
`checkCompatibility({scene, productView, form, cutout}) → { level:'ok'|'warn', issues:[{code, severity, zh}] }`
codes：`view-unknown` `view-mismatch` `placement-blocked` `surface-suspended` `angle-topdown-front` `type-mismatch`。

### `lib/compositor.js`
`planComposition(composition)`（§1.3）；`composeExport({composition, background, product, mask, overlayBehind, overlayFront, output}) → {width, height, data}`；`fitCover(image, w, h)`；`applyShadow(dst, coverage, {width, height, shadow, opacity, scale})`。
`planComposition` 通过 `source_width/source_height`（或 `pixel_width/pixelHeight`）取商品像素尺寸，缺省按正方形。

### `lib/png.js`
`decodePng(buffer) → {width, height, data}`（类型 0/2/3/4/6，PLTE/tRNS，filter 0–4；拒绝隔行与 16-bit）；`encodePng({width, height, data}) → Buffer`（8-bit RGBA，filter 0，level 9，字节确定）。

### `lib/tasks.js`
`STATE_FLOW` `canTransition(from, to)` `readSettings` `writeSettings` `readSecrets` `writeSecrets`（0600）`clearSecrets` `createTask` `loadTask` `updateTask` `setState` `listTasks` `deleteTask` `reserveCall(task, kind)` `refundCall(task, kind)` `recordCall` `logRelay` `saveExportFile` `fingerprint(composition)`。

### `lib/api.js`
`PREFIX='/api/ai-replica'`、`VERSION='2.1.0'`、`createHandlers() → { health, settings, test, tasks, taskById, action, file, reveal }`、`export { snapshot }`、`RELAY_ENUMS`。

### `index.js`
`export const inject = ['webServer']`，`export function apply(ctx)`：`ctx.effect` 内注册 **21 条精确路由**（`health`、`settings`、`settings/test`、`settings/models`、`file`、`reveal`、`tasks`、`task`，加 13 个动作 `describe / product-profile / product-skip / analyze / scene-review / cutout / mask / compatibility / background / composition / export / accept / cancel`），任务 id 从 `?id=` 读取，统一 `wrap()` 做 Origin/Host 校验 + `AppError → JSON`。

---

## 4. Client 契约

片段顺序（`scripts/build-client.mjs` 拼接生成 `client.js`）：

| 片段 | 内容 |
| --- | --- |
| `00-header.js` | `__ModuleLoader__.load` 外壳、常量、keyframes |
| `10-core.js` | i18n（zh/en 全量）、`api()`、工具、UI 原语 |
| `20-home.js` | 新建任务：图片、表单、提交；提交成功后立即 `POST /describe` 拉取商品信息 |
| `30-scene.js` | 商品信息卡（`ProductCard`：名称/卖点/颜色/外观，可改可重提取）+ 场景审核：字段编辑、unknown 逐项确认、原始返回 |
| `40-mask.js` | 抠图 + 蒙版编辑器（泛洪、画笔、扩张/收缩/羽化、缩放） |
| `50-background.js` | 背景生成/上传、版本选择、三项检查 |
| `60-canvas.js` | Canvas 工作台：拖拽/缩放/旋转、文字层 3 版式、阴影、明度色温、撤销/重做、导出 |
| `70-task.js` | 任务外壳：8 步进度、2s 轮询、横幅、验收 |
| `80-history.js` | 历史列表、打开、删除 |
| `85-settings.js` | 双通道设置：视觉卡 + 生图卡各自的中转站、路径、模型（含一键拉取模型）、认证方式、Key、额外请求头、超时；三页签横向滑动切换 + 底部常驻保存条 |
| `90-app.js` | App 外壳、错误边界、Slot 注册 |

Client 侧自动抠图（`40-mask.js`）：
1. 读图到离屏 canvas（长边 ≤1600），取 `ImageData`；
2. 若 >2% 像素 alpha < 250 → 判定透明 PNG，直接用原 alpha；
3. 否则以四边像素均值为种子做颜色距离泛洪（`tolerance` 5–90，默认 32），标记背景；
4. 扩张/收缩用可分离滑动窗口 max/min；羽化用可分离 box blur；
5. 输出 `product_png`（原 RGB + 蒙版 alpha）与 `mask_png`（白 + 蒙版 alpha），两者同尺寸；
6. 用户点「确认蒙版」→ `POST /cutout` 再 `PUT /mask {confirm:true}`。

Slot 注册：

```js
ctx.slots.register({ name: 'main', key: 'ai-replica' }, render)
ctx.slots.register({ name: 'sidebar.panellist', id: 'ai-replica', order: -12, label }, ReplicaIcon)
```

---

## 5. 验收与测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/schema.test.mjs` | 场景/组合校验、别名归一化、未确认路径 |
| `tests/product.test.mjs` | 商品信息固定格式解析（加粗/行内/JSON 三种回包）、卖点上限与去重、未提供/信息冲突、摘要与提示词内置文本 |
| `tests/relay.test.mjs` | 双通道配置与迁移、URL/请求头、四种视觉协议、三种生图请求、图片回包解析、模型列表拉取与解析、Key 隔离、SSRF 校验、单通道测试 |
| `tests/image.test.mjs` | PNG 往返、坏数据拒绝、几何计划、合成/阴影/调整/cover |
| `tests/host.test.mjs` | 全流程（假中转站）：双通道设置、商品信息提取与人工改写、建任务、分析、门禁、抠图、蒙版、背景、合成、导出、验收、超时/401/预算/穿越 |
| `tests/host-apply.test.mjs` | 路由注册与销毁、设置双通道形状、Origin/Host 信任（含 loopback 别名） |
| `tests/client.test.mjs` | Client 半加载、Slot 注册、无 Key 泄漏、商品信息卡片与三个固定分节 |
| `tests/render.test.mjs` | 无头渲染全部视图（React shim + 真实 Host 快照），并真的点一次「保存」「拉取模型」「重新提取」校验请求体 |

`node scripts/release.mjs` = 重建 client + 全部测试 + 打包 `dist/ai-replica-<version>.zip` 并打印 SHA-256。

---

## 6. 存储布局

```
<DSH_PROFILE_DIR 或 ~/.dsh>/ai-replica/
  settings.json          { schema_version:'2.1', vision:{...}, image:{...}, allow_localhost, max_*_bytes }
  secrets.json           { vision_api_key, image_api_key, saved_at }（0600）
  history.json           { items: [...] }
  tasks/<id>/
    task.json
    product_profile.json
    scene_analysis.json
    scene_review.json
    composition.json
    assets/<sha256 前缀>-<kind>.<ext>
    exports/export-<timestamp>.png
    logs/relay.jsonl
```

写入策略：临时文件 + `fsync` + `rename`；同任务操作走进程内串行锁；`containedPath` 确保所有路径落在任务目录内。
