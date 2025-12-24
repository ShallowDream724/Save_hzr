# 拯救Hzr（Save_hzr）

一个可自建部署的题库/复习小站：前端单页 + 后端同步服务（Node + SQLite + JWT）。支持手机/电脑/平板数据互通（每个用户独立数据）。

## 存档（防误操作）
- 自动存档：服务端每 **5 分钟**自动保存一次快照（可在“云同步 → 存档”里恢复）。
- 手动存档：你可随时点“新建存档”，并支持命名/删除/恢复。
- 多设备冲突：默认**以当前设备为准**继续同步；服务端会把旧云端自动存成“冲突自动备份”，不会悄悄丢数据。

## 端口
- 后端服务监听：`8787`（项目内默认）
- 建议仅绑定到本机：由 `docker-compose.yml` 已设置为 `127.0.0.1:8787:8787`，再用 Nginx 反代到公网域名

## 一键（Docker Compose，推荐）
```bash
cd /path/to/Save_hzr
cp .env.example .env
# 把 JWT_SECRET 换成强随机字符串（至少 32 位）
nano .env

docker compose up -d --build
curl -s http://127.0.0.1:8787/api/health
```

## 数据库会不会丢？
- 不会：只要你不删 `pharm_sync_data` volume，重新 `git pull/clone` + `docker compose up -d --build` 都不会影响数据库。
- 会丢的情况：`docker compose down -v`、`docker volume rm pharm_sync_data`、或你把 DB 改到别处但没迁移。

## 纯 npm 启动（不用 Docker）
```bash
cd /path/to/Save_hzr/server
npm install --omit=dev

export JWT_SECRET='换成强随机'
export PORT=8787
export DB_PATH=/var/lib/save_hzr/app.db
export CORS_ORIGIN=https://qianmeng.me

node src/server.js
```

## Nginx 部署（qianmeng.me）
1) 安装 Nginx（Ubuntu/Debian）
```bash
sudo apt update
sudo apt install -y nginx
```

2) 站点配置：`/etc/nginx/sites-available/qianmeng.me`
```nginx
server {
  listen 80;
  server_name qianmeng.me;

  # 如已配好 HTTPS，可把这里改成 301 跳转到 https
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

启用并重载：
```bash
sudo ln -sf /etc/nginx/sites-available/qianmeng.me /etc/nginx/sites-enabled/qianmeng.me
sudo nginx -t
sudo systemctl reload nginx
```

3) 配 HTTPS（可选但强烈建议，Certbot）
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d qianmeng.me
```

## CodePen（可选）
CodePen 也能用，但**默认只能本地保存**；想跨设备同步，需要把 `API_BASE` 指向你的服务：
- 在 HTML 里设置：`window.API_BASE = 'https://qianmeng.me';`
- 前端文件依赖：`web/index.html` 依赖 `web/style.css`、`web/app.js`、以及同源的 `web/presets.json`
