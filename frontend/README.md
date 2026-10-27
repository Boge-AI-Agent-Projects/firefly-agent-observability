# Firefly Frontend

Agent Observability Dashboard — "Light up every trace."

## Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite** bundler
- **Tailwind CSS v4** (dark theme)
- **React Router v7** (client-side routing)
- **TanStack React Query v5** (data fetching)
- **Lucide React** (icons)

## Getting Started

```bash
npm install
npm run dev
```

Dashboard opens at `http://localhost:5173`.

## Backend

The API target is controlled by Vite env:

```bash
VITE_FIREFLY_API_URL=http://localhost:8000
```

The frontend uses the signed-in user's bearer token for query and workspace APIs.
Do not expose `INGEST_API_KEY` through a `VITE_*` variable: Vite variables are
compiled into browser assets. Agent adapters send telemetry to the backend directly.

## Pages

| Path            | Description                    |
| --------------- | ------------------------------ |
| `/`             | Dashboard — stats overview     |
| `/traces`       | Trace list with filters        |
| `/trace/:id`    | Trace detail — spans + transcript |

## Build

```bash
npm run build
```

Output in `dist/`. Serve with any static file server.
