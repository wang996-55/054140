# 爆款图复刻 · Replica Studio（`@local/ai-replica` 2.1.0）

按《AI_爆款图复刻_开发文档_V4.1》重写的 Harness 插件版：**整条流水线都在插件页面内跑完**，不再打开浏览器、不再起第二个端口、不依赖 Python / Konva / npm 依赖。

```
参考图 ─┬─► 视觉分析（1 次调用）─► 场景 JSON 校验 ─► 人工逐项审核（门禁）
        │                                            │
商品图 ─┴─► 本地抠图 + 蒙版修边 ─► 人工确认（门禁）──┤
                                                      ▼
                        视角兼容判断（不兼容需显式 confirm_continue）
                                     │
              背景：AI 生成 / 手动上传 ─► 三项人工检查（门禁）
                                     │
                     Canvas 参数编辑（拖拽/缩放/旋转/文字层/阴影）
                                     │
            composition JSON ─► Host 端 PNG 原生合成（唯一权威几何）
                                     │
                       尺寸/文案自检 ─► 导出 PNG ─► 人工验收（1-5 分）
```

## 为什么是"插件内版"

| V4.1 原方案 | 本插件实现 | 说明 |
| --- | --- | --- |
| Vue3 + Konva | React（自带 `React.createElement`）+ Canvas 2D | Harness 的 Client 半只暴露 React |
| FastAPI 本地服务 | Cordis Host 半，同源路由 `/api/ai-replica/*` | `ctx.webServer.register`，无额外端口 |
| Python Pillow + OpenCV 合成 | `lib/compositor.js`（纯 JS，RGBA 原生缓冲） | 确定性、无原生依赖、可单测 |
| `rembg` 抠图 | 浏览器端边缘泛洪 + 色彩距离 + 羽化，**强制人工蒙版确认** | 没有模型就靠人眼兜底 |
| 本地磁盘读写 | `<DSH_PROFILE_DIR>/ai-replica/` | 原子写、路径穿越防护、SHA-256 资产身份 |

## 硬门禁（永不自动绕过）

1. **商品图必填**，除非显式开启创意模式（开启后商品一致性不保证）。
2. **场景 JSON 必须通过 schema 校验**，并且人工逐项确认；任何仍是 `unknown` 的字段都要单独勾选确认。
3. **蒙版必须人工确认**，才能进入背景步骤。
4. **背景必须人工审核**（三项检查：无多余商品 / 预留区干净 / 台面与光线方向）。
5. **视角不兼容**时必须显式 `confirm_continue` 才能继续，并在任务上留痕。
6. **导出只走 Host 合成器**，导出后重新解码自检尺寸。
7. **付费调用绝不自动重试**：超时会进入 `remote_outcome_unknown` 并退回预算，由人决定是否重跑。
8. **两条通道的 API Key 分开保存**，只存在 `secrets.json`（0600）或环境变量 `REPLICA_VISION_API_KEY` / `REPLICA_IMAGE_API_KEY`；不返回前端、不写日志、不进提示词，且视觉 Key 与生图 Key 永不串用。

## 安装

插件已经以 link 方式挂在 `desktop` profile：

- `%USERPROFILE%\.dsh\profiles\desktop\package.json`
  - `dependencies["@local/ai-replica"] = "link:E:/deepseek/ai-replica"`
  - `dsh.profile.bundles` 内含 `@local/ai-replica`（旧的 `@local/personal-workbench` 已移除）

改完 bundle 列表需要**重启 DSH** 才会加载 Host 半；重启后侧边栏出现「爆款图复刻」。
开发期也可以在 profile 的 `cordis.patch.yml` 里临时 `insert` 同一个包，Loader 会热挂载（本次开发即用此法验证），但**正式入口只保留 bundles 一处**，避免同一个包被挂两次、路由重复注册。

插件只注册**精确路径**路由：`/api` 前缀被连接网关占用，任何 `/api/*/*/…` 形式的未精确路径会被它返回 `401 unauthorized`，所以任务 id 走 `?id=` 查询参数（详见 `docs/contracts.md` §2）。

## 首次配置

插件右上角 →「设置」，页面分成**三张卡片**：视觉通道、生图通道、共享项。两条通道各自独立，可以指向不同中转站、用不同账号与 Key。

| 字段 | 说明 |
| --- | --- |
| 协议（视觉） | `openai_chat` / `openai_responses` / `anthropic` / `gemini` —— 中转站兼容哪种就选哪种 |
| 协议（生图） | `openai_images` / `openai_chat`（部分中转站用 chat 出图）/ `gemini` |
| 中转站地址 | 每条通道各填一个，例如 `https://relay-a.example.com/v1`；可填**完整 URL**（含查询串，适合把 key 放 query 的中转站）；`{model}` 占位符会被展开 |
| 请求路径 | 相对路径（默认 `<base_url>/chat/completions`、`/images/generations`）或完整 URL |
| 模型 | 每条通道各一个；生图另有「编辑模型 / 编辑路径」用于参考图改图（multipart `/images/edits`） |
| 认证方式 | `bearer`（`Authorization: Bearer`）/ `x-api-key`（Anthropic 系）/ `api-key`（Azure 系）/ `google`（`?key=`）/ `none` |
| 额外请求头 | JSON，例如 `{"X-Relay-Token":"..."}`，与认证头合并，适配需要二次鉴权的中转站 |
| API Key | 视觉 Key 与生图 Key **分开保存**，互不串用；保存后写入 `secrets.json`，页面只显示"已保存" |
| 超时 | 视觉默认 120s，生图默认 300s；超时即 `provider-timeout-unknown`（可能已计费，不自动重试） |
| 允许本机地址 | `allow_localhost` 默认关闭；SSRF 防护要求显式开启才允许 `127.0.0.1` 这类本地中转 |
| 测试按钮 | 每条通道各自一个，**真实消耗一次请求**，必须二次确认 |

Key 也可用环境变量给出，优先级从高到低：`REPLICA_VISION_API_KEY` / `REPLICA_IMAGE_API_KEY` → `REPLICA_API_KEY` → `OPENAI_API_KEY` → `secrets.json`。页面显示的 `vision.has_key` / `image.has_key` 会标注来源是环境变量还是已保存的 Key。

## 使用流程

1. **新建复刻**：参考图（必填）+ 商品图（保真模式必填）+ 比例/边长/生成次数上限。
2. **场景审核**：看模型结论、改错的字段、勾选「已逐项核对」以及每个 `unknown` 的确认。
3. **抠图与蒙版**：自动估算 → 画笔补回/擦除 → 扩张/收缩/羽化 → 确认。
4. **背景**：可生成（受 `background_count` 预算限制）或上传干净背景；三项检查后确认。
5. **Canvas**：拖动移动、角点缩放、顶部圆点旋转；文字层有 3 个版式；阴影按短边百分比；明度/色温默认关闭。
6. **导出**：Host 用同一套参数在 PNG 缓冲上合成，导出后再次解码校验尺寸。
7. **验收**：1-5 分 + 备注，写入历史。

## 存储布局

```
<DSH_PROFILE_DIR 或 ~/.dsh>/ai-replica/
  settings.json          双通道中转站设置（vision / image，不含 Key，schema 2.1）
  secrets.json           视觉 Key 与生图 Key（0600）
  history.json           历史索引
  tasks/<id>/
    task.json            状态机、表单、预算、蒙版/背景/导出记录
    scene_analysis.json  模型原始结论 + raw_text
    scene_review.json    人工审核结论 + confirmed 标记
    composition.json     Canvas 参数
    assets/              参考图 / 商品图 / 抠图 / 蒙版 / 背景
    exports/             导出 PNG
    logs/relay.jsonl     每次中转站调用的脱敏记录
```

## 状态机

```
created → analyzing → scene_review → mask_review → background_review → editing → exporting → done
                 ↘ remote_outcome_unknown（超时，可能已计费，不自动重试）
任意活动态 → failed / cancelled；mask_review ⇄ mask_rejected
```

## 开发

```bash
pnpm build:client          # src/client/*.js → client.js（无打包器，纯拼接）
node tests/schema.test.mjs # 场景/组合 schema 与归一化
node tests/relay.test.mjs  # 双通道配置、迁移、四种视觉协议、三种生图协议、Key 隔离
node tests/image.test.mjs  # PNG 编解码 + 合成几何
node tests/host.test.mjs   # Host 全流程（假中转站，含超时/401/预算/门禁）
node tests/host-apply.test.mjs # 路由注册、Origin/Host 信任、销毁
node tests/client.test.mjs # Client 半加载与 Slot 注册
node tests/render.test.mjs # 无浏览器渲染全部阶段（迷你渲染器 + 真实 Host 快照）
pnpm release               # 上面全部 + 打包 dist/ai-replica-2.1.0.zip
```

Client 源码是按顺序拼接的片段：`src/client/00-header.js` → `10-core.js`（i18n / API / UI 原语）→ 各阶段 → `90-app.js`（外壳与 Slot 注册）。**改片段后必须 `pnpm build:client`**，`client.js` 是生成物。

### 客户端怎么在没有浏览器的情况下被验证

`tests/render.test.mjs` 用一个约百行的迷你 React（`createElement` 产出普通对象、`useState/useEffect/useMemo/useCallback/useRef` 带槽位存储、类组件支持 `render()`）+ 假 DOM 全局，把真实的 `client.js` 跑起来，再把 App 外壳和每个阶段都渲染一遍：

- 快照不是手写假数据，而是 `tests/support/fixtures.mjs` 用**真实 Host 处理器**离线跑完整流水线（视觉与生图接口被桩掉，其余全真：存储、schema 校验、抠图落盘、背景标准化、合成、PNG 导出、验收）后抓取的，含 `analyzed / reviewed / background / editing / exported / done / history / settings` 八种状态。
- 套件自带两个对照用例：会抛错的组件必须被捕获，异步 effect 里的 `setState` 必须真的触发下一轮渲染——否则"全绿"没有意义。
- 断言既看"不许抛异常"，也看渲染出的文字（如设置页出现"中转站/模型"、历史页出现任务号），避免渲染出空壳。

这套东西抓不到的东西：真实字体度量、Canvas 像素、浏览器事件；这些只能靠打开页面对着看。

## 契约

- [`docs/contracts.md`](docs/contracts.md)：运行时映射、数据契约、17 条精确路由、模块 API。
- [`schemas/scene.schema.json`](schemas/scene.schema.json) / [`schemas/composition.schema.json`](schemas/composition.schema.json)：文档级 JSON Schema（运行时校验以 `lib/schema.js` 为准）。

## 验证记录（2.1.0）

自动：`pnpm release` → 7 个套件 246 条断言全绿（schema 27 / relay 69 / image 22 / host 41 / host-apply 20 / client 12 / render 55），产物 `dist/ai-replica-2.1.0.zip` 112.2 KB。

真机（在运行中的 DSH 进程里直接打插件路由，`http://127.0.0.1:52434/api/ai-replica/*`）：

| 探测 | 结果 |
| --- | --- |
| `GET /health` | `200`，`version 2.1.0`、`compositor host-node`、`cutout local-browser` |
| `GET /settings` | `200`，返回 `vision` / `image` 两套配置 + `relay` 枚举 + `vision.has_key` / `image.has_key` |
| `POST /tasks`（4:5 / 1024） | `200`，`state scene_review`，画布 `1024×1280` |
| `POST /analyze?id=`（未配中转站） | `409 provider-missing`（不会空跑付费调用） |
| `PUT /scene-review?id=`（无分析结果） | `409 scene-missing` |
| `POST /export?id=`（未确认蒙版） | `409 mask-unconfirmed` |
| `DELETE /task?id=&confirm=1` | `200`，测试数据已清空 |

未验证：真实中转站的付费链路（需要 API Key）、真实浏览器里的字体与 Canvas 像素。

## 已知边界

- 本地抠图是"边缘泛洪 + 色彩距离"，复杂背景（纹理、同色商品、强投影）需要人工修边；这正是不允许跳过蒙版确认的原因。
- 文字层在浏览器渲染成 PNG overlay，再由 Host 合成——同一套参数、同一台机器，字体缺失会退化成系统字体。
- 一次任务默认 1 次视觉 + 1 次生图调用；想多试背景就把 `background_count` 调成 2。
