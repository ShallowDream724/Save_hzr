# 拯救Hzr：同步服务（Node + SQLite）

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
export PORT=8787
export DB_PATH=/var/lib/pharm-sync/app.db
export CORS_ORIGIN=https://qianmeng.me
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
