# Firefly Deploy — Docker Compose 一键部署

> **萤火 Firefly** — 多 Agent 可观测性平台

## 快速开始

```bash
cd firefly/deploy

# 1. 配置环境变量
cp .env.example .env
nano .env   # 修改密码和 API Key

# 2. 一键启动
docker compose up -d

# 3. 查看状态
docker compose ps

# 4. 查看日志
docker compose logs -f backend

# 5. 访问
# 前端: http://localhost:3000
# 后端: http://localhost:8000/docs
```

## 服务清单

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (Nginx) | :3000 | React SPA |
| 后端 (FastAPI) | :8000 | OTLP API + Swagger |
| PostgreSQL 17 | :5432 | 持久化存储 |

## 生产部署注意事项

1. **修改所有默认密码** — `.env` 中 `POSTGRES_PASSWORD` 和 `INGEST_API_KEY`
2. **HTTPS 配置** — 建议用 Traefik/Caddy 反代，加 TLS
3. **数据持久化** — `pgdata` 是 Docker 命名卷，默认存在 `/var/lib/docker/volumes/`
4. **备份** — `docker compose exec pgsql pg_dump -U firefly firefly > backup.sql`

## 停止/清理

```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（⚠️ 会丢失所有数据）
docker compose down -v
```
