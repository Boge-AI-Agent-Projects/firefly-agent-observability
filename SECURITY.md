# Security Policy

## Supported version

Firefly is currently an early-stage MVP. Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private security advisory for this repository. Do not publish credentials, production URLs, customer data, prompts, model outputs, or exploit details in a public issue.

Include the affected component, reproduction steps, impact, and any suggested mitigation. Reports will be reviewed before public disclosure.

## Deployment guidance

- Replace every value in `.env.example`; never reuse the examples in production.
- Keep `INGEST_API_KEY` on trusted Agent runtimes. Never expose it in browser-side `VITE_*` variables.
- Put the API behind TLS and a trusted reverse proxy.
- Restrict CORS origins, database ports, and network access to the minimum required scope.
- Treat captured prompts, completions, tool arguments, and tool results as potentially sensitive data.
- Configure data retention, backup, access control, and secret rotation before production use.
