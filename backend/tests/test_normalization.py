"""Regression tests for Firefly trace classification."""

import unittest

from app.services.normalization import trace_category_for_name_and_span_categories


class TraceCategoryTests(unittest.TestCase):
    def test_trace_without_spans_remains_user_visible(self) -> None:
        self.assertEqual(
            trace_category_for_name_and_span_categories("agent-turn", set()),
            "user_request",
        )

    def test_explicit_system_name_remains_hidden(self) -> None:
        self.assertEqual(
            trace_category_for_name_and_span_categories("openclaw.heartbeat", set()),
            "system",
        )


if __name__ == "__main__":
    unittest.main()
