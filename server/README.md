# 拯救Hzr：同步服务（Node + SQLite）

## 特性（防误操作）
- 自动存档：服务端每 **5 分钟**保存一次快照（`/api/revisions`）。
- 手动存档：支持命名/删除/恢复（`/api/archives`）。
- 多设备冲突：客户端默认无弹窗继续同步（以当前设备为准），服务端会把旧云端数据写入“冲突自动备份”存档，避免静默丢失。

## AI（Gemini，服务端调用）
- 题目「问AI」：多轮对话 + SSE 流式 + 历史落库（不塞进 library JSON）。
- 书内「AI 拍照导入」：<=9 张图，后端异步队列处理（全局 RPM + 1s 启动间隔 + 429 指数退避）。

## 1) Docker Compose（推荐）
1. 复制环境变量：把仓库根目录的 `.env.example` 复制为 `.env`，并设置强随机 `JWT_SECRET`。
2. 启动（需要 Docker Compose v2）：`docker compose up -d --build`
3. 访问：`http://localhost:8787`

数据默认落在 Docker volume：`pharm_sync_data`（容器内 `/data/app.db`）。

## 2) 纯 npm 启动（服务器上常用）
```bash
cd /path/to/Save_hzr/server
npm install --omit=dev
export JWT_SECRET='换成强随机'
export GEMINI_API_KEY='你的 key（只在服务端使用）'
export PORT=8787
export DB_PATH=/var/lib/pharm-sync/app.db
export CORS_ORIGIN=https://your-domain.example
node src/server.js
```

说明：`src/server.js` 会自动优先使用 `server/public`（Docker 里由 `COPY web ./public` 提供），否则回退到仓库根目录的 `web/`。
如需手动指定静态目录，可设置 `PUBLIC_DIR=/path/to/web`。

建议用 `pm2` 或 systemd 守护进程。

## 3) API（给前端用）
- `POST /api/auth/register` `{username,password}` -> `{token}`
- `POST /api/auth/login` `{username,password}` -> `{token}`
- `GET /api/library`（Bearer token）-> `{data, version, updatedAt}`
- `PUT /api/library`（Bearer token + 可选 `If-Match: <version>`）`{data}` -> `{ok, version, updatedAt}`
  - 强制覆盖：`PUT /api/library?force=1`（或 `X-Force: 1`），会额外生成一条“冲突自动备份”存档
- `GET /api/revisions?limit=20` -> `{items:[{version,savedAt}]}`
- `POST /api/revisions/:version/restore` -> `{ok, version, updatedAt}`
- `GET /api/archives?limit=50` -> `{items:[{id,name,createdAt}]}`
- `POST /api/archives` `{name?, data?}` -> `{ok, id, createdAt}`
- `DELETE /api/archives/:id` -> `{ok}`
- `POST /api/archives/:id/restore` -> `{ok, version, updatedAt}`

### AI
- `POST /api/ai/book-import`（Bearer token，multipart）
  - fields：`bookId`、`model=flash|pro`、`noteText?`
  - files：`images`（1-9 张）
- `GET /api/ai/jobs?bookId=...` -> `{items}`
- `GET /api/ai/jobs/:jobId` -> `{job, items}`
- `GET /api/ai/jobs/:jobId/events`（SSE）-> `snapshot` 事件（job+items）
- `POST /api/ai/conversations` -> `{conversationId, reused}`
- `GET /api/ai/conversations?scope=&bookId=` -> `{items}`
- `GET /api/ai/conversations/:id` -> `{conversation, messages}`
- `POST /api/ai/conversations/:id/messages/stream`（SSE）-> `delta|done|error`
