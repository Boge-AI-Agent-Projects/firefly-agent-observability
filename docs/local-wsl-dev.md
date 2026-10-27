# Local WSL Development Topology

This guide shows one way to run the backend in WSL and the frontend on Windows.
Replace `<WSL_IP>` with the address reported by `hostname -I` inside WSL.

## OpenClaw Integration Path

Local OpenClaw sends telemetry to the Firefly backend running inside WSL:

```text
Local OpenClaw
  -> diagnostics-otel
  -> http://<WSL_IP>:8000
  -> WSL Firefly backend
  -> WSL Docker container: pgsql
  -> PostgreSQL database: firefly
```

This keeps PostgreSQL and the API inside WSL while adapters run on the host.

## Windows Local Development Path

Windows local backend is only a UI/backend development sandbox:

```text
Windows Firefly frontend
  -> http://127.0.0.1:5173
  -> VITE_FIREFLY_API_URL
```

Point `frontend/.env.local` to WSL:

```text
VITE_FIREFLY_API_URL=http://<WSL_IP>:8000
```

`backend/firefly.db` is an optional local SQLite sandbox and is not committed.

## Known Database Locations

- WSL integration database: Docker `pgsql`, PostgreSQL database `firefly`.
- Optional Windows development database: `backend/firefly.db` (SQLite).
- Backend development Compose: `backend/docker-compose.yml`.
- Deployment Compose: `deploy/docker-compose.yml`.

## Sanity Checks

Check the WSL Firefly backend:

```powershell
curl.exe http://<WSL_IP>:8000/health
```

Check that the Windows frontend dev server has loaded the WSL URL:

```powershell
curl.exe http://127.0.0.1:5173/src/api/client.ts | Select-String VITE_FIREFLY_API_URL
```

If `frontend/.env.local` changes, restart the Vite dev server.
