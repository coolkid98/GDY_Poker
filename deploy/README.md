# 公网 Docker 部署（推荐）

## 1. 前置条件

1. 一台公网 Linux 服务器（Ubuntu 22.04/24.04）。
2. 一个域名，并能配置 DNS。
3. DNS 解析：
   1. `GAME_DOMAIN` -> 服务器公网 IP
   2. `API_DOMAIN` -> 服务器公网 IP

## 2. 服务器安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 3. 拉取项目并配置部署变量

```bash
git clone <你的仓库地址> poker
cd poker
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`，至少改这 4 项：

```env
LETSENCRYPT_EMAIL=you@example.com
GAME_DOMAIN=game.example.com
API_DOMAIN=api.example.com
VITE_COLYSEUS_ENDPOINT=wss://api.example.com
```

## 4. 启动

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml up -d --build
```

首次启动会自动申请 HTTPS 证书（Caddy + Let's Encrypt）。

## 5. 验证

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml logs -f
```

浏览器访问：

1. `https://GAME_DOMAIN`
2. 后端健康检查：`https://API_DOMAIN/healthz`

## 6. 更新版本

```bash
git pull
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml up -d --build
```

## 7. 停止/重启

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml stop
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml start
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml restart
```

## 8. 防火墙建议

仅开放：

1. `22`（SSH）
2. `80`（HTTP）
3. `443`（HTTPS）

不要开放 `2567`，后端已在 Docker 内网，通过 Caddy 反代。
