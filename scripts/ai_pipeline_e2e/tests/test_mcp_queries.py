from __future__ import annotations

import hashlib
import inspect
import re
import unittest
from dataclasses import FrozenInstanceError

from scripts.ai_pipeline_e2e import mcp_queries


class McpQueryCatalogTests(unittest.TestCase):
    def test_catalog_is_closed_exact_and_marks_only_apply_steps_mutating(self) -> None:
        self.assertEqual(
            tuple(mcp_queries.CATALOG),
            (
                "inventory_projects",
                "migration_ledger_pre",
                "apply_migration_009",
                "postcondition_009",
                "migration_ledger_after_009",
                "apply_migration_010",
                "postcondition_010",
                "migration_ledger_post",
            ),
        )
        self.assertEqual(
            {key for key, value in mcp_queries.CATALOG.items() if value.mutation},
            {"apply_migration_009", "apply_migration_010"},
        )
        self.assertEqual(
            {value.tool for value in mcp_queries.CATALOG.values()},
            {"list_projects", "list_migrations", "apply_migration", "execute_sql"},
        )
        with self.assertRaises(TypeError):
            mcp_queries.CATALOG["caller_sql"] = object()  # type: ignore[index]
        with self.assertRaises(FrozenInstanceError):
            mcp_queries.CATALOG["postcondition_009"].query = "select true"  # type: ignore[misc]

    def test_migration_sources_are_exact_named_and_hash_pinned(self) -> None:
        expected = {
            "009": (
                "009_ai_pipeline_contract_hardening",
                "52b3bb57ad2eefdb1a22f928489049b9657bb1bff30fa37c55cc3d6ece7c60ff",
            ),
            "010": (
                "010_ai_pipeline_optional_note",
                "b57909e6ff63d3d564de35881a5c21cd46687bb5c1b3d1f5c0eabd98678dc89b",
            ),
        }
        for version, (name, digest) in expected.items():
            with self.subTest(version=version):
                source = mcp_queries.MIGRATIONS[version]
                self.assertEqual(source.logical_version, version)
                self.assertEqual(source.name, name)
                request = mcp_queries.build_private_request(
                    f"apply_migration_{version}", "a" * 20
                )
                self.assertEqual(request.name, name)
                self.assertEqual(hashlib.sha256(request.query.encode()).hexdigest(), digest)
                self.assertEqual(
                    request.tool_arguments(),
                    {"project_id": "a" * 20, "name": name, "query": request.query},
                )

    def test_ledgers_are_exact_and_logical_versions_match_names(self) -> None:
        self.assertEqual(len(mcp_queries.MIGRATION_PRE_LEDGER), 8)
        self.assertEqual(len(mcp_queries.MIGRATION_AFTER_009_LEDGER), 9)
        self.assertEqual(len(mcp_queries.MIGRATION_POST_LEDGER), 10)
        for ordinal, name in enumerate(mcp_queries.MIGRATION_POST_LEDGER, 1):
            self.assertTrue(name.startswith(f"{ordinal:03d}_"), name)
        self.assertEqual(
            mcp_queries.expected_ledger("migration_ledger_pre"),
            mcp_queries.MIGRATION_PRE_LEDGER,
        )
        self.assertEqual(
            mcp_queries.expected_ledger("migration_ledger_after_009"),
            mcp_queries.MIGRATION_AFTER_009_LEDGER,
        )
        self.assertEqual(
            mcp_queries.expected_ledger("migration_ledger_post"),
            mcp_queries.MIGRATION_POST_LEDGER,
        )
        with self.assertRaisesRegex(mcp_queries.CatalogRejected, "^MCP_CATALOG_INVALID$"):
            mcp_queries.expected_ledger("apply_migration_009")

    def test_postconditions_are_read_only_fixed_shape_catalog_queries(self) -> None:
        forbidden = re.compile(
            r"\b(?:alter|call|comment|copy|create|delete|do|drop|grant|insert|merge|reindex|"
            r"revoke|truncate|update|vacuum)\b",
            re.IGNORECASE,
        )
        for step, required_markers in (
            (
                "postcondition_009",
                (
                    "ai_runs_request_payload_fingerprint_lower_hex",
                    "acttub_claim_ai_run",
                    "acttub_complete_summary_run",
                    "acttub_complete_report_run",
                    "acttub_fail_ai_run",
                    "has_function_privilege",
                ),
            ),
            (
                "postcondition_010",
                (
                    "interview_turns_optional_note_shape_check",
                    "interview_turns_one_optional_note_per_session_idx",
                    "acttub_put_optional_note",
                    "has_function_privilege",
                ),
            ),
        ):
            with self.subTest(step=step):
                query = mcp_queries.CATALOG[step].query
                self.assertIsInstance(query, str)
                self.assertIsNone(forbidden.search(query))
                self.assertTrue(query.rstrip().endswith("from checks"))
                self.assertIn("as passed", query)
                self.assertIn("as row_count", query)
                for marker in required_markers:
                    self.assertIn(marker, query)
                request = mcp_queries.build_private_request(step, "a" * 20)
                self.assertEqual(request.tool_arguments(), {"project_id": "a" * 20, "query": query})

    def test_callers_cannot_supply_sql_names_paths_or_unknown_steps(self) -> None:
        signature = inspect.signature(mcp_queries.build_private_request)
        self.assertEqual(tuple(signature.parameters), ("step", "project_id"))
        for bad_ref in (None, "", "A" * 20, "a" * 19, "a" * 21, "../private-value"):
            with self.subTest(kind=type(bad_ref).__name__, length=len(bad_ref or "")):
                with self.assertRaises(mcp_queries.CatalogRejected) as captured:
                    mcp_queries.build_private_request("postcondition_009", bad_ref)
                if bad_ref:
                    self.assertNotIn(str(bad_ref), str(captured.exception))
        with self.assertRaisesRegex(mcp_queries.CatalogRejected, "^MCP_CATALOG_INVALID$"):
            mcp_queries.build_private_request("execute_caller_sql", "a" * 20)
        with self.assertRaisesRegex(mcp_queries.CatalogRejected, "^MCP_CATALOG_INVALID$"):
            mcp_queries.build_private_request("inventory_projects", "a" * 20)

    def test_private_request_repr_redacts_project_and_query(self) -> None:
        marker = "b" * 20
        request = mcp_queries.build_private_request("postcondition_010", marker)
        rendered = repr(request)
        self.assertNotIn(marker, rendered)
        self.assertNotIn("select", rendered.casefold())
        self.assertNotIn("query=", rendered)
        self.assertIn("postcondition_010", rendered)


if __name__ == "__main__":
    unittest.main()
