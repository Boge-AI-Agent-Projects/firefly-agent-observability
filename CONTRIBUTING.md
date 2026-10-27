# Contributing

Thanks for helping improve Firefly.

1. Open an issue describing the problem, expected behavior, and proposed scope.
2. Keep changes focused and avoid committing secrets, runtime databases, logs, generated builds, or real telemetry.
3. Run the relevant checks before opening a pull request:

```bash
cd backend && python -m unittest discover -s tests
cd frontend && npm ci && npm run lint && npm run build
cd adapters/openclaw && npm ci && npm run build
```

4. Document security, schema, API, or configuration changes in the pull request.

By contributing, you agree that your contribution is licensed under Apache License 2.0.
