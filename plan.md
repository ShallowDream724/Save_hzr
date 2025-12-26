# Tiku AI 功能开发文档（实现说明与规范）

本文档用于说明并指导实现「题目快捷问 AI」「书内拍照导入」「全站风控队列」「多端同步的历史对话」等能力。当前仓库已落地基础版本；本文件作为后续迭代的长期规范与设计参考。

> 现状速览（方便定位接入点）
> - 前端题卡渲染：`web/src/app-internal/12-chapter-view.js:25`（`createQuestionCard`）
> - 前端 API 封装：`web/src/app-internal/07-cloud-sync.js:73`（`apiFetch` 自动带 JWT）
> - Home/开书动画（保护区）：`web/src/app-internal/11-book-ui.js`（`openBookWithAnimation` / `cleanupBookOpenAnim`）
> - 后端入口：`server/src/server.js:1`（Express + SQLite + JWT）
> - Gemini 参考实现（你搬来的 AMC/All-Model-Chat）：`All-Model-Chat/all-model-chat/services/api/baseApi.ts:78`、`All-Model-Chat/all-model-chat/utils/domainUtils.ts:245`

---

## 0. 快速开始（本地开发 / 自检）

### 0.1 安装依赖
```bash
cd server
npm install --omit=dev
```

### 0.2 配置环境变量（保护 Key：只在后端用）
```bash
cd ..
cp .env.example .env
```
然后在 `.env` 里设置：`JWT_SECRET`、`GEMINI_API_KEY`（以及可选的 `AI_IMPORT_*` 参数）。
如果你在中国大陆本机开发，建议同时设置 `AI_HTTP_PROXY`（或 `HTTPS_PROXY`），否则后端可能无法访问 Google/Gemini。

### 0.3 启动本地服务（推荐）
```bash
node dev.mjs
```

> Windows/多 Node 版本提示（重要）
> - `server/` 使用 `better-sqlite3`（原生模块），**Node 主版本不匹配会直接启动失败**。
> - 推荐使用 Node 20 LTS 启动（与你当前 `server/node_modules` 编译版本一致）。
> - 若你用的是更高版本 Node（例如 22/24），请执行 `cd server && npm rebuild better-sqlite3` 重新编译，或显式用系统 Node 20 启动：`& "C:\\Program Files\\nodejs\\node.exe" dev.mjs`。

### 0.4 运行冒烟测试（不调用 Gemini）
```bash
node dev.mjs --smoke
```

### 0.5 本地验证 Gemini Key（会真实计费/消耗 RPM）
1) 打开 `http://localhost:8787`，注册/登录（云同步）。
2) 进入一本书（确保该书已上传到云端）。
3) 测试两条链路：
   - 题目卡片点「问AI」发送问题（SSE 流式）。
   - 顶部点「AI 拍照导入」上传 1-9 张图片并观察队列/进度/结果写入。

## 1. 总目标（必须满足）

### 1.1 题目级问答（与拍照导入互不干扰）
- 每道题都有「问 AI」按钮，打开不跳转的对话窗（手机/平板/电脑适配）。
- 选中文字弹出「问 AI」快捷引用按钮（类似 AMC）。
- 支持多轮对话、历史保存、跨设备同步；并提供一个独立入口查看「全部 AI 历史」并继续对话。
- 重要：用户再次点「问 AI」时，如果该题已存在历史对话，**优先打开并展示上次对话**（而不是新建空会话）。
- 题目对话自动注入上下文：题干/选项/答案/解析/知识点；选中引用时额外注入用户选中文本。
- 支持 Markdown + LaTeX 渲染；最好题干/解析页面也能复用同一套渲染器（更安全、更一致）。
- 流式输出：优先用 **SSE/fetch streaming**（实现成本最低、最稳）；如果后续你确认更偏好 WS，再切 WS。

### 1.2 书内拍照导入（严格风控 + 异步鲁棒）
- 入口在书内部：用户上传图片（一次最多 9 张）+ 附加文字。
- 后端异步队列处理：**1 张图 = 1 次 Gemini 请求 = 生成 1 个 chapter**（chapter 标题由 AI 起）。
- 默认写入该书的「根目录」（不自动建文件夹，不写 `layoutMap`；用户后续自己拖拽整理）。
- **题号保真（必须）**：如果照片里存在题号（如 12、(12)、12.），必须尽量提取并写入 `question.id`，后续 finalize/写库阶段都不得重编号；不确定则留空并回退为顺序号。
- **多用户全站共享 RPM**：Gemini 3 Pro 全局 `rpm=10`，Gemini 3 Flash 全局 `rpm=20`；超出则排队等待。
- 请求启动间隔：同一模型队列 **每次启动至少间隔 1s**（避免过密）。
- 429 优雅处理：尊重 `Retry-After`；否则指数退避 + jitter；绝不立刻重试。
- 每页（每张图）最多重试 3 次（中间留足等待时间）；只有最终失败才提示用户失败项。
- 用户关页/断网/多端切换：任务照跑；用户回来能看到完成后的结果与失败信息。

---

## 2. 风控与队列（核心：多用户全站共享）

### 2.1 两类限流规则（必须分开）

#### A) 拍照导入（全站全局共享 RPM，按模型区分）
- 模型队列分两条（“启动速率”由 `rpm` 控制；“在途并发”由 `maxInFlight` 控制）：
  - `import.flash`：全局 `rpm=20`，启动间隔≥1s，`maxInFlight` 建议 `20`（可调）
  - `import.pro`：全局 `rpm=10`，启动间隔≥1s，`maxInFlight` 建议 `10`（可调）
- 含义：任何用户的导入请求都要进入对应队列；后发用户排队等待。
- 关键点：**导入的“并发”不是串行跑完一张再跑下一张**。允许同一 job 的 9 张图在满足风控的前提下“依次启动并同时在途”，总耗时接近“单张图耗时”，而不是 9 倍。

#### B) 题目问答（按用户限流，和模型无关）
- 每位用户独立 `rpm=10`（不区分 Pro/Flash）。
- 目的是：允许多人并发提问，但每个人不会滥用。

> 注意：上面 B 的限流与 A 的队列完全隔离，拍照导入的拥堵不影响题目问答的可用性。

### 2.2 队列可视化（用户体验要求）
拍照导入需要让用户明确知道：
- 当前任务状态：`queued | running | finalizing | writing | done | done_with_errors | failed`
- 总进度：`已完成页数/总页数`（例如 3/9）
- 排队信息（至少提供一种）：
  - `aheadUsers`：前面有多少个「正在排队/处理中」的用户（同模型队列维度，去重）
  - `aheadJobs`：前面还有多少个“导入任务”
  - `aheadItems`：前面还有多少张“图片页”
  - `etaMin`：估算还要几分钟（误差 ≤2 分钟可接受）

实现建议：
- 服务端计算 `aheadUsers/aheadJobs/aheadItems/etaMin`（同模型队列维度），写入 `ai_jobs.progress_json`。
- `etaMin` 估算思路（先做“可解释的粗估”，后续再优化）：
  - 维护该模型最近一段时间的平均耗时 `avgDurationSec`（例如 EMA）
  - 在当前 `token bucket + minStartInterval + maxInFlight` 约束下，模拟该 job 的 N 个 page item 的“最早启动时间”
  - job 预计完成时间 = `max(start_i + avgDurationSec)`；展示成 `ceil((etaSec)/60)` 分钟
- 前端在书内导入弹窗展示进度条 + 排队人数。
- 多端同步：同用户在手机/平板/电脑打开时都能看到同一个 job 的实时状态。

### 2.3 防滥用补充（建议默认启用）
- 每个用户同时最多允许 **1 个导入 job** 处于 `queued/running`（第二个 job 直接排到该用户后面或拒绝并提示）。
- 单次上传图片上限 9 张（硬限制）。
- 未来可选：按日/按月配额（先留接口，不必第一版做死）。

补充：后端必须“硬拦截且不误杀”
- `POST /api/ai/book-import` 需要做到幂等：同用户存在 active job（`queued/running/...`）时，不再创建新 job，而是返回该 jobId（建议 `409` 或 `200 {jobId, reused:true}`）。
- 前端只负责隐藏/禁用入口，真正的限制以服务端为准（防止多端/脚本绕过）。

### 2.4 多端状态同步（导入进度 + 对话历史）
- 目标：同一用户在手机/平板/电脑同时在线时，看到一致的 job 状态与对话列表。
- 建议实现：
  - 默认：SSE 推送（更实时、对移动端更友好）
  - 兜底：前端轮询（网络环境差/SSE 被代理缓冲时仍可用）
- 防滥用：服务端以 DB 状态为准，前端只是展示；所有“创建 job/发送消息”都必须通过 JWT 鉴权与限流。

---

## 3. 异步任务系统（鲁棒性第一位）

### 3.1 任务必须落库（可恢复）
SQLite 继续可用（现有就是 SQLite）。任务系统要求：
- 服务器重启后能继续处理：worker 从 DB 里捞 `queued/running` 的 item 继续跑。
- 每个 item 都要有状态机与尝试次数，避免卡死与重复写入。

### 3.2 建议表结构（初版）

#### `ai_jobs`
- `id`（jobId）
- `user_id`
- `type`：`book_import | ...`
- `model`：`flash | pro`
- `status`
- `payload_json`：原始输入（bookId、noteText、images 元信息…）
- `progress_json`：队列位置、当前页、成功/失败统计、最后更新时间等
- `result_json`：最终写入摘要（新建 chapters 列表、失败列表）
- `error`：job 级别错误（比如写库失败）
- `created_at/updated_at`

#### `ai_job_items`
- `id`
- `job_id`
- `idx`（0..N-1）
- `status`：`queued | running | retry_wait | succeeded | failed | canceled`
- `attempt`（1..3）
- `delayed_until`（重试/429 退避用）
- `input_path/input_mime`（图片落盘路径）
- `result_json`（该页解析出的 chapter 数据）
- `error`（该页失败原因）
- `started_at/finished_at`

### 3.3 Worker 执行策略（关键点）
- 导入采用“**调度器 + 多在途**”而不是“单线程串行”：
  - `rpm` 使用 **token bucket**（容量=rpm，支持 burst），保证单个 job（<=9 图）在队列空闲时可在 ~9 秒内完成全部请求启动。
  - `minStartIntervalMs=1000`：同模型两次“启动”至少间隔 1s（你要求的）。
  - `maxInFlight`：限制同模型同时在途请求数，防止服务器/Key 被并发拖垮（默认见 2.1，可调）。
- 选择下一个可启动 item（同模型队列）：
  1) `status in (queued, retry_wait)` 且 `delayed_until <= now`
  2) 按 `created_at`、`job_id`、`idx` 排序（保证公平 + 页顺序）
  3) 满足 `token >= 1` 且 `inFlight < maxInFlight` 且距离上次启动≥1s -> 立即启动
  4) 否则等待：直到下一个 token 或 `delayed_until` 到期或间隔满足
- 完成顺序允许乱序：每页结果带 `pageIndex` 与 `sourceRef`，最终写入时再按顺序归并。
- 429/重试：见第 5.4 章（每页最多 3 次，且写 `delayed_until`）。

---

## 4. AI 对话历史（必须单独存，不进大 JSON）

你的明确要求：AI 历史单独存，不塞进 `libraries.data_json`。

### 4.1 数据模型建议
#### `ai_conversations`
- `id`
- `user_id`
- `scope`：`general | book | question`（用于分类展示，不作为权限隔离）
- `book_id` / `chapter_id` / `question_id`（可为空；用于“来源/过滤”，但不限制继续对话）
- `question_key`（可选字符串；用于在前端难以获得稳定 question_id 时兜底，例如 `${bookId}:${chapterId}:${questionIndex}`）
- `title`（可为空）
- `model_pref`（pro/flash，允许用户改）
- `created_at/updated_at/last_message_at`

#### `ai_messages`
- `id`
- `conversation_id`
- `role`：`user | assistant | system`
- `content_text`
- `content_json`（可选：工具调用、引用块、结构化元数据）
- `created_at`

> 这样可以：题目对话窗直接定位到某个 conversation；“全部历史”页面按时间列 conversation；多端实时同步只需要订阅 conversation/job 的更新。

题目会话复用策略（避免“同一题问一次就丢”）
- 服务端提供“创建/复用”接口：当 `scope=question` 且 `(book_id, chapter_id, question_id)` 或 `question_key` 相同，返回已有 `conversationId`。
- DB 层建议加唯一约束（择一实现）：
  - `UNIQUE(user_id, book_id, chapter_id, question_id)`（如果 question_id 稳定可用）
  - 或 `UNIQUE(user_id, question_key)`（如果以 index 兜底为主）

### 4.2 对话标题生成（flash-lite，便宜，且不计入用户 rpm=10）
- 新建对话后，后台异步触发 “title generation”：
  - 模型：`gemini-2.5-flash-lite`（来自 AMC；可加 fallback：`models/gemini-flash-lite-latest`）
  - 不计入用户提问 rpm=10（避免体验被标题生成偷走额度）
  - 但仍建议加一个超轻的全局保护：例如 `maxInFlight=1` + 启动间隔（避免有人刷标题导致成本失控）

---

## 5. Gemini 调用规范（必须稳）

### 5.1 Key 与请求源
- Gemini Key 只放服务端 `.env`，绝不下发前端，日志里也不能出现 key。
- 用户在中国大陆、服务器在日本：所有请求从服务器发出（你要求的）。

### 5.2 分辨率与思考强度（按 AMC 规范）
- 只支持：`gemini-3-flash-preview` 与 `gemini-3-pro-preview`（后续再补）。
- 图片分辨率：
  - Gemini 3：**per-part** 注入 `MEDIA_RESOLUTION_ULTRA_HIGH`（参考 `All-Model-Chat/all-model-chat/utils/domainUtils.ts:245`）
  - 非 Gemini 3（未来扩展）：使用全局 `MEDIA_RESOLUTION_HIGH`
- 思考强度：Gemini 3 统一 `thinkingLevel: HIGH`（参考 `All-Model-Chat/all-model-chat/services/api/baseApi.ts:164`）

### 5.3 强制结构化输出：优先 function calling
拍照导入建议用工具调用，减少“模型输出一堆废话导致 parse 失败”。

#### 工具（建议最小集）
导入建议拆成 **两段式**（满足你“并行启动 9 页”+“跨页归并”的速度需求）：

1) `extract_page_bundle(args)`（每页一次，支持并行在途）
   - 返回该页的“中间产物”，包含 **头/中/尾**，用于跨页拼接与归位
2) `finalize_import_job(args)`（整章一次或分块多次）
   - 输入所有页 bundles + 服务端预拼接结果，输出最终 chapters（按页归属；跨页合并题默认归到上一页）

`extract_page_bundle(args)` 返回结构建议（配合你的“头/尾拼接规则”）：
- `pageIndex`: number（严格使用服务端传入的顺序，从 0 开始）
- `chapterTitleCandidate`: string（可选；最终以 finalize 为准）
- `head`: QuestionFragment | null（该页“头”，仅当**本页第一题明显是上一页续题残余**才输出；如果本页第一题完整，则必须为 null）
- `questions`: Question[]（该页中间的“完整题”数组）
- `tail`: QuestionTail（该页“尾”，**必须输出**：即便最后一题完整也要放在 tail 里；若续到下一页则输出 fragment）
- `warnings?`: string[]（可选：识别不清/页面质量差等）

`QuestionFragment`（允许不完整，便于拼接）：
- `sourceRef`: `{ pageIndex, kind: 'head'|'tail' }`
- `text?`: string
- `options?`: `{label, content}[]`
- `answer?`: string
- `continues?`: `'from_prev'|'to_next'|'none'`（模型尽量判断；不确定就 `none`）

`QuestionTail`（始终存在，且保证不重复）
- `kind`: `'complete' | 'fragment'`
- `question?`: Question（当 `kind='complete'`）
- `fragment?`: QuestionFragment（当 `kind='fragment'`，且通常 `continues='to_next'`）

重要约束（写进 prompt，服务端也校验）：
- `head` 若非 null，表示“本页开头不是一个完整新题”，因此该题 **不得** 同时出现在 `questions`。
- `tail` 的题 **不得** 同时出现在 `questions`（无论 complete 还是 fragment），避免去重困难。

`Question`（完整题，且必须带来源）：
- `sourceRef`: `{ pageIndex, localIndex }`（localIndex 从 0 开始，按该页题目出现顺序）
- 其余字段见下方 Question 定义

Question（对齐现有题卡字段，见 `web/src/app-internal/12-chapter-view.js:25`）
- `id`: string|number
- `text`: string（Markdown/纯文本）
- `options`: `{label, content}[]`
- `answer`: string
- `explanation?`: string（Markdown）
- `knowledgeTitle?`: string
- `knowledge?`: string（Markdown）

#### prompt 原则（必须写死在服务端）
- 系统提示词强调：
  - “只能通过 function call 返回结果；不要输出任何自然语言解释”
  - “字段必须完整且类型正确；不要新增字段”
  - “如果本页无法解析，返回 `questions=[]`，并在 `warnings` 写明原因（不要编造）”
- 服务端对 tool args 做 schema 校验：失败则判定该 attempt 失败并进入重试。

### 5.4 重试策略（每页最多 3 次）
- attempt 1：正常执行
- attempt 2：等待 `10s + jitter` 再试（且仍受全局队列节奏约束）
- attempt 3：等待 `30s + jitter` 再试（最后一次）
- 若遇 429：
  - 优先使用 `Retry-After`
  - 否则使用指数退避（上限例如 60s）并写入 `delayed_until`

用户反馈策略（你要求的）：
- 中间失败不打扰用户，只在 UI 里显示“正在重试/处理中…”
- 最终失败（3 次都失败）才在结果里列出失败页及原因
- 成功的页直接生成成果（chapters 写入书里），用户回来即可看到

### 5.5 API 契约（建议先定死，保证可维护）
#### 拍照导入（异步）
- `POST /api/ai/book-import`（JWT，`multipart/form-data`）
  - fields：`bookId`, `model` (`flash|pro`), `noteText`
  - files：`images[]`（<=9）
  - returns：`{ jobId }`
  - 若已存在 active job：返回 `{ jobId, reused: true }`（避免多端/重复点击产生多个 job）
- `GET /api/ai/jobs?bookId=...`（JWT）-> `{ items: [...] }`
- `GET /api/ai/jobs/:jobId`（JWT）-> `{ job, items }`
- `GET /api/ai/jobs/:jobId/events`（JWT，SSE，可选）-> 推送 `progress_json` 与 item 状态变化

#### 题目问答（多轮 + 流式）
- `POST /api/ai/conversations`（JWT）创建/复用会话 -> `{ conversationId, reused?: boolean }`
  - body（示例）：
    - `scope`: `general | book | question`
    - `bookId?`, `chapterId?`, `questionId?`, `questionKey?`
  - 约定：当 `scope=question` 且题目标识相同（`questionId` 或 `questionKey`），服务端必须复用旧会话并返回 `reused:true`
- `GET /api/ai/conversations`（JWT）列表（历史中心）
- `GET /api/ai/conversations/:id`（JWT）详情（messages）
- `POST /api/ai/conversations/:id/messages/stream`（JWT，SSE/fetch streaming）
  - body：`{ userMessage, selectedText?, contextRef? }`
  - response：流式 assistant 文本 + 结束时 usage/元信息（可选）

### 5.6 反代与流式（SSE / WS）
如果用 SSE/fetch streaming（推荐首版）：
- Nginx 需要关闭缓冲：`proxy_buffering off;`
- 建议增大超时：`proxy_read_timeout 300s;`

如果未来改用 WebSocket（目前不做）：
- Nginx 需要支持 Upgrade：
  - `proxy_set_header Upgrade $http_upgrade;`
  - `proxy_set_header Connection "upgrade";`

---

## 6. 跨页续题（上一页没完下一页继续）怎么处理？

你的关键诉求是：**导入必须快**（9 页不要 9 倍时间），但又要处理“跨页续题”。

因此导入采用「并行分页解析 + 归并」为默认路线（速度优先），并保留“串行更稳模式”作为兜底。

### 方案 A（推荐，速度优先）：头/中/尾片段 + 最终归并
1) **并行分页解析（extract_page_bundle）**
   - 每页单独请求，依次启动（≥1s 间隔），允许并行在途。
   - 每页输出：`head`（可能是上一页续题残片）+ `questions`（完整题）+ `tail`（可能续到下一页）。
   - 每个元素都带 `sourceRef`（`pageIndex + localIndex/head/tail`），用于“归位”。

2) **顺序拼接（服务端 deterministic pre-merge）**
   - 按 `pageIndex` 排序，把所有页拼成一个有序序列。
   - 合并规则（**确定性、业务逻辑主导**）：
     - `head`：只在“本页第一题明显是上一页续题残余”时才应输出；否则必须为 `null`。
     - `tail`：**永远输出本页最后一题**（不判断完整/不完整，只负责把能看到的 `id/text/options/answer` 尽量填上）。
     - 丢弃规则：
       - **第一页 `head` 必丢弃**（没有上一页可拼）。
       - **最后一页 `tail` 必丢弃**（没有下一页可拼）。
       - 仅 1 页导入：为避免丢题，允许把该页 `tail` 当作普通题附加到本页末尾。
     - 拼接规则（从第一页开始，上一页归位）：
       - 若 `next.head != null`：合并 `prev.tail + next.head`，合并后的题 **插入 prev 页末尾**（跨页题归属上一页 chapter）。
       - 若 `next.head == null`：把 `prev.tail` 视为完整题，直接插入 prev 页末尾。
     - 断页/缺页：若 `pageIndex` 不相邻，**禁止跨缺口拼接**；把 `prev.tail` 当作完整题插入，且丢弃 `next.head`。

3) **最终归并与补全（finalize_import_job）**
   - 在所有页解析结束后，用用户选择的模型（Pro/Flash）做一次“生成解析/知识点（可选）+ 章节名润色”：
     - 输入：**服务端已拼好的完整题**（按页的 `questions`）+ `warnings`
     - 输出：仍是按页 `pages[]`（每页一个 chapter，默认放根目录），其中跨页合并题已由服务端归位到上一页，无需模型再处理断页。

> 你提出的方案（头/尾片段 + 结束后再调用一次合并）是可行的，关键在于：**中间产物必须带来源锚点（sourceRef），并且合并输出必须可校验**，否则很容易“拼错题/漏题/乱序”。

### 方案 B（兜底，质量优先但更慢）：串行 carry
如果遇到某些书跨页极多、且方案 A 频繁出现 `warnings`：
- 提供一个“质量优先”模式：按页顺序串行解析，并把上一页尾巴作为 `carry` 输入下一页。
- 这会显著拉长总时间，但准确率更高；只作为用户可选兜底，不作为默认。

### 上传顺序要求（必须在 UI 里解决）
- 默认按用户选图顺序作为 `pageIndex`。
- UI 必须支持“预览 + 拖拽排序”，并提示“请按书页顺序上传，否则跨页拼接可能出错”。

---

## 7. 前端 UI 方案（移动/平板优先，但电脑也要好用）

### 7.1 题目对话窗（不跳转）
- Desktop：右侧 Dock 面板（可切换为浮窗/全屏）
- Mobile/Tablet：底部 Bottom Sheet（三段高度：30/60/100），支持拖动改变高度
- 对话窗内：
  - 顶部可折叠“题目信息卡”（题干/解析/知识点/答案）
  - 消息区 Markdown+LaTeX 渲染
  - 输入区支持引用（选中文本后自动插入 quote block）

### 7.2 全部 AI 历史入口
AI 对话窗口需要在 **首页** 与 **书内** 都可打开：
- 首页：一个“新对话/历史”入口（通用聊天，不绑定题目）
- 书内：同样可新建对话（不强制隔离到某本书，但会自动打上 book 标签方便过滤）
 - 首版默认仅文本对话；图片/文件作为后续增强（若实现成本低再补）

历史中心建议在主界面增加一个入口（例如侧边栏底部或顶栏按钮）：
- 列表：conversation 标题/最近更新时间/关联题目（若有）
- 点击进入：继续多轮对话
- 同步：同账号多端共享（服务端存储 + SSE 更新）

### 7.3 书内拍照导入弹窗
- 上传（<=9）+ 附加文字 + 模型选择（Pro/Flash）
- 选择图片方式（跨端）：
  - 电脑：文件选择 / 拖拽上传 / **Ctrl+V 粘贴剪贴板图片**（监听 `paste`，从 `clipboardData.items` 提取 image）
  - 手机/平板：调用相机或图库（`<input type="file" accept="image/*" capture>`，并提供“从相册选择”兜底）
- 提交后显示：
  - 队列信息（前面还有 X 个任务/页）
  - 进度条（页进度 + 总体状态）
  - 完成后：展示新建 chapters 列表（点击直接打开）
  - 若有失败：列出失败页及原因（只在最终失败时显示）

---

## 8. Markdown/LaTeX 渲染复用 + CSP 安全分析

### 8.1 为什么要做（不仅是“更好看”）
当前题卡渲染用 `innerHTML` 拼接（见 `web/src/app-internal/12-chapter-view.js:25`），如果未来题目内容来自 AI 导入，就存在 XSS 风险：模型可能输出 `<script>` 或危险属性。

把题干/解析/知识点统一走 “Markdown -> sanitize -> DOM” 能显著降低风险，且能复用到聊天窗口（你也希望复用）。

### 8.2 CSP 现状与建议
后端 CSP 在 `server/src/server.js:5`，当前策略倾向“只允许同源脚本”（较安全）。

我建议：
- **优先选择**：把渲染依赖（Markdown/KaTeX/sanitize）放进 `web/vendor/`，走同源静态资源
  - 优点：不需要放开 CSP 到多个 CDN；供应链风险更低；离线/内网也可用
- 若你坚持 CDN：
  - 必须固定版本 + SRI（`integrity`）+ `crossorigin`
  - CSP 只放行必要域名，不要 `*`
  - 仍需 sanitize（不要因为 KaTeX/Markdown 就省略）

---

## 9. 数据库是否要换？（先给结论与理由）

### 9.1 结论（建议）
第一阶段继续用 SQLite（已经在用，部署简单），但要做到：
- AI job 与对话历史的表都要建索引
- 写 `libraries.data_json` 需要事务与合并策略，避免覆盖用户并发修改
- 对大 JSON 更新要谨慎（未来若数据规模暴涨，再迁 PostgreSQL）

### 9.2 为什么暂时不立刻换 Postgres
- 当前项目已围绕 SQLite（better-sqlite3）写好部署与备份逻辑，换库会牵扯部署/迁移/运维成本。
- AI job 的写入频率不算高（rpm 受控），只要索引与事务做好，SQLite WAL 足够支撑早期多用户量。

### 9.3 什么时候必须换
出现以下任一情况就应迁移：
- 单库文件持续增大且频繁写大 JSON 导致锁竞争明显
- 需要多实例水平扩展（多台服务器跑同一个服务）
- 需要更复杂的查询/统计（例如全站搜索、推荐、审计）

为避免未来痛苦：所有 DB 操作放到 `server/src/db/*.js` 模块层，业务层不直接写 SQL（保证可替换性）。

---

## 10. 代码结构与封装性（为什么必须做）

### 10.1 当前风险点
- 旧版 `web/app.js` 的单文件大闭包风险已消除：前端已拆分为 `web/src/app-internal/*`（每文件 ≤ 500 行），并通过 `web/index.html` 串联加载。
- 仍需注意：题卡渲染与 Markdown/LaTeX 的渲染链路需要持续关注 XSS（同源脚本 + DOMPurify + 白名单策略）。

### 10.2 现代化重构路线（你已授权，推荐）
你明确表示可以重构、也偏好“2025 最现代”的工程化。我建议采用 **strangler** 方式：不一次性推翻现有功能，而是先把新模块工程化，然后逐步迁移旧代码。

Home/开书动画（必须保护）
- 把 Home 视图与 3D 开书动画当成 “legacy frozen zone”：未来重构时 **不改 DOM 结构、不改关键 CSS 选择器语义、不改 JS 的状态机**。
- 建议做法：将 Home 相关逻辑拆到单独的 `legacy-home.*`（或单独入口页面），新工程只通过桥接 API 调用“进入书/退出书”，避免任何 UI 库渲染干扰动画。

推荐栈（可随时收敛，不必一步到位）：
- 前端：`Vite + TypeScript + React`（或 Preact/Solid 也可），配合 `Tailwind + Radix/shadcn` 做高级 UI/UX
- 状态/请求：`TanStack Query`（数据同步、轮询/SSE 状态维护会更舒服）
- Markdown/LaTeX：沿用 AMC 的 unified/rehype/KaTeX + sanitize 思路（但放在我们自己的 bundle 里）

“艺术感”可落地的实现方式（不牺牲可维护性）
- 先定一套设计语言：颜色/字体/圆角/阴影/动效曲线都用 CSS 变量（便于主题切换与统一）
- UI 组件基于 Radix（无样式、可访问性强），样式由 Tailwind + 自己的 token 控制（避免“买一堆 UI 库后期难改”）
- 动效用 `framer-motion`（或 `motion`）实现：底部 sheet、dock、列表切换、加载骨架、进度条等微交互
- 背景与品牌感：可选轻量 “shader/mesh gradient/噪声纹理” 背景（纯 CSS 或小 Canvas），但必须：
  - 支持弱性能设备降级
  - 不影响阅读（对比度/可访问性优先）
  - 不引入外链脚本（走同源 bundle）

迁移策略（尽量不伤现有功能）：
1) **先冻结 Home/开书动画为保护区**：不动 DOM/关键 CSS 语义/状态机（`web/src/app-internal/11-book-ui.js`）。
2) 前端已完成“按功能拆分小文件”（`web/src/app-internal/*`），后续可在不改变行为的前提下继续模块化与抽象。
3) 若未来引入 Vite/TS/React：建议只做构建与模块管理，不改变现有 DOM 结构；并把 bundle 输出与源代码隔离（避免把打包产物当源码维护）。
4) 等 AI 功能稳定后，再逐步改造题卡渲染链路（减少 `innerHTML` / 强化 sanitize / 统一 Markdown+LaTeX 渲染）。

这样你可以先私下测试新版本，成熟后再逐步替换旧实现，风险最小。

---

## 11. 里程碑（按依赖顺序）

0) **前端工程化底座（可与后端并行）**
   - 引入 `Vite + TypeScript`，先把 AI 模块独立出来（不改旧功能）
   - 确定 Markdown/LaTeX 渲染方案（同一套用于聊天 + 题干/解析）

1) **后端：AI 基础设施**
   - DB migrations：`ai_jobs/ai_job_items/ai_conversations/ai_messages`
   - 导入调度器（全局 rpm + burst + 1s 间隔 + maxInFlight + 429 + 3 次重试）
   - 对话 API（题目问答）+ per-user rpm=10

2) **前端：拍照导入 UI + 进度同步**
   - 上传弹窗（<=9）+ 展示排队人数/进度条
   - job 列表与详情（多端同步）

3) **前端：题目对话窗 + 选中引用**
   - Dock/BottomSheet 容器
   - 题目上下文注入与多轮对话
   - Markdown+LaTeX 渲染

4) **全局：历史对话中心**
   - 列表 + 继续对话
   - 标题生成（`gemini-2.5-flash-lite`）

5) **跨页续题增强**
   - 默认方案：头/中/尾片段 + finalize 归并（方案 A）
   - 可选兜底：串行 carry（方案 B）

---

## 12. GitHub 与敏感信息
- `.env` 必须保持在 `.gitignore`（当前已有）。
- `All-Model-Chat/` 必须保持 ignore（当前 `.gitignore` 已包含 `All-Model-Chat/`）。
- 任何日志禁止输出 Gemini Key、完整图片内容、用户隐私文本。

---

## 13. 待你确认的问题（写完文档后只留最关键的）
1) 导入默认采用“方案 A（头/中/尾片段 + finalize 归并）”，并保留“方案 B（串行 carry）”作为兜底开关，这样 OK 吗？
2) 导入是否默认生成 `explanation/knowledge`？（如果一章题太多，可能需要分块 finalize；也可以先只抽题+答案，解析后续按需生成）
3) `maxInFlight` 你希望保守还是激进？我默认建议：Pro=10、Flash=20（都仍受 rpm + 1s 启动间隔约束，可随时调小/调大）
