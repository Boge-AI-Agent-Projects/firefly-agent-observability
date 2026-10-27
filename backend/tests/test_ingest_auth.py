"""Focused security tests for the shared ingestion key."""

import unittest

from fastapi import HTTPException

from app.api import ingest_auth


class VerifyIngestKeyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_key = ingest_auth.settings.ingest_api_key
        ingest_auth.settings.ingest_api_key = "unit-test-ingest-key"

    def tearDown(self) -> None:
        ingest_auth.settings.ingest_api_key = self.original_key

    def test_accepts_matching_key(self) -> None:
        self.assertIsNone(ingest_auth.verify_ingest_key("unit-test-ingest-key"))

    def test_rejects_missing_key(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            ingest_auth.verify_ingest_key(None)
        self.assertEqual(caught.exception.status_code, 401)

    def test_rejects_wrong_key(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            ingest_auth.verify_ingest_key("wrong-key")
        self.assertEqual(caught.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
