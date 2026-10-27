"""In-memory API smoke test covering auth, workspace, ingestion, and query."""

from __future__ import annotations

import os
import unittest

os.environ["APP_ENV"] = "development"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["INGEST_API_KEY"] = "smoke-test-ingest-key"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class ApiSmokeTests(unittest.TestCase):
    def test_workspace_ingest_and_query_flow(self) -> None:
        with TestClient(app) as client:
            self.assertEqual(client.get("/health").status_code, 200)

            registration = client.post(
                "/api/v1/auth/register",
                json={"email": "smoke@example.com", "name": "Smoke User", "password": "smoke-password"},
            )
            self.assertEqual(registration.status_code, 201, registration.text)
            session_headers = {
                "Authorization": f"Bearer {registration.json()['access_token']}"
            }

            organization = client.post(
                "/api/v1/organizations",
                headers=session_headers,
                json={"name": "Smoke Organization"},
            )
            self.assertEqual(organization.status_code, 201, organization.text)

            project = client.post(
                "/api/v1/projects",
                headers=session_headers,
                json={
                    "organization_id": organization.json()["id"],
                    "name": "Smoke Project",
                },
            )
            self.assertEqual(project.status_code, 201, project.text)
            project_id = project.json()["id"]

            payload = {
                "project_id": project_id,
                "name": "smoke-agent-turn",
                "timestamp_start": "2026-01-01T00:00:00Z",
                "status": "ok",
                "spans": [],
            }
            rejected = client.post("/api/v1/ingest/trace", json=payload)
            self.assertEqual(rejected.status_code, 401, rejected.text)

            accepted = client.post(
                "/api/v1/ingest/trace",
                headers={"X-Firefly-Key": "smoke-test-ingest-key"},
                json=payload,
            )
            self.assertEqual(accepted.status_code, 202, accepted.text)

            traces = client.get(
                "/api/v1/traces",
                headers=session_headers,
                params={"project_id": project_id},
            )
            self.assertEqual(traces.status_code, 200, traces.text)
            self.assertEqual(traces.json()["total"], 1)

            otlp_without_key = client.post(
                "/v1/traces",
                headers={"X-Firefly-Project-ID": project_id},
                content=b"not-protobuf",
            )
            self.assertEqual(otlp_without_key.status_code, 401, otlp_without_key.text)


if __name__ == "__main__":
    unittest.main()
