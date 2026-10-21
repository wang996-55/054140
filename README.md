# 爆款图复刻 · Replica Studio（`@local/ai-replica` 2.0.0）

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
8. **API Key 只存在 `secrets.json`（0600）**，或环境变量 `REPLICA_API_KEY`；不返回前端、不写日志、不进提示词。

## 安装

插件已经以 link 方式挂在 `desktop` profile：

- `%USERPROFILE%\.dsh\profiles\desktop\package.json`
  - `dependencies["@local/ai-replica"] = "link:E:/deepseek/ai-replica"`
  - `dsh.profile.bundles` 内含 `@local/ai-replica`（旧的 `@local/personal-workbench` 已移除）

改完 bundle 列表需要**重启 DSH** 才会加载 Host 半；重启后侧边栏出现「爆款图复刻」。

## 首次配置

插件右上角 →「设置」：

| 字段 | 说明 |
| --- | --- |
| 中转站地址 | 例如 `https://relay.example.com/v1`（`allow_localhost` 默认关闭，SSRF 防护要求显式开启才允许 127.0.0.1） |
| API Key | 保存后写入 `secrets.json`；页面只显示"已保存" |
| 视觉 / 生图模型 | 两个独立模型名 |
| 接口模式 | `openai_chat` / `openai_images` / `openai_edits` |
| 超时 | 视觉默认 90s，生图默认 120s；超时即 `provider-timeout-unknown` |
| 测试按钮 | **真实消耗一次请求**，必须二次确认 |

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
  settings.json          中转站与默认参数（不含 Key）
  secrets.json           API Key（0600）
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
node tests/image.test.mjs  # PNG 编解码 + 合成几何
node tests/host.test.mjs   # Host 全流程（假中转站，含超时/401/预算/门禁）
node tests/host-apply.test.mjs # 路由注册、Origin/Host 信任、销毁
node tests/client.test.mjs # Client 半加载与 Slot 注册
```

Client 源码是按顺序拼接的片段：`src/client/00-header.js` → `10-core.js`（i18n / API / UI 原语）→ 各阶段 → `90-app.js`（外壳与 Slot 注册）。**改片段后必须 `pnpm build:client`**，`client.js` 是生成物。

## 契约

- [`docs/contracts.md`](docs/contracts.md)：运行时映射、数据契约、26 条 Host 路由、模块 API。
- [`schemas/scene.schema.json`](schemas/scene.schema.json) / [`schemas/composition.schema.json`](schemas/composition.schema.json)：文档级 JSON Schema（运行时校验以 `lib/schema.js` 为准）。

## 已知边界

- 本地抠图是"边缘泛洪 + 色彩距离"，复杂背景（纹理、同色商品、强投影）需要人工修边；这正是不允许跳过蒙版确认的原因。
- 文字层在浏览器渲染成 PNG overlay，再由 Host 合成——同一套参数、同一台机器，字体缺失会退化成系统字体。
- 一次任务默认 1 次视觉 + 1 次生图调用；想多试背景就把 `background_count` 调成 2。
