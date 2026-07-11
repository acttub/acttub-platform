from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from scripts.ai_pipeline_e2e import controller, mcp_bridge, mcp_queries, secure_state


HEX_A = "a" * 64
HEX_B = "b" * 64
HEX_C = "c" * 64
HEX_D = "d" * 64
HEX_E = "e" * 64
HMAC_A = "hmac-sha256:" + HEX_A
HMAC_B = "hmac-sha256:" + HEX_B
HMAC_C = "hmac-sha256:" + HEX_C
HMAC_D = "hmac-sha256:" + HEX_D
HMAC_E = "hmac-sha256:" + HEX_E
GENESIS = "0" * 64
NODE = shutil.which("node") or "node"


@contextmanager
def private_regular_fd():
    with tempfile.TemporaryDirectory() as directory:
        os.chmod(directory, 0o700)
        path = Path(directory) / "ledger"
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags, 0o600)
        try:
            os.chmod(path, 0o600)
            yield fd
        finally:
            os.close(fd)


def mcp_entry(
    sequence: int,
    previous_hash: str,
    *,
    operation: str,
    postcondition_hash: str,
    request_hash: str,
    permit_hash: str | None = None,
    success: bool = True,
    safe_code: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "schemaVersion": "protected-mcp-attestation.v1",
        "operation": operation,
        "targetHmac": HMAC_A,
        "permitHash": None if permit_hash is None else "sha256:" + permit_hash,
        "requestHash": "sha256:" + request_hash,
        "responseHmac": HMAC_B,
        "preconditionHash": HMAC_C,
        "postconditionHash": postcondition_hash,
        "success": success,
        "schemaValid": True,
        "developmentMatch": True,
        "productionAction": False,
        "safeCode": safe_code,
    }
    core = {"sequence": sequence, "previousHash": previous_hash, "payload": payload}
    digest = hashlib.sha256(controller.canonical_json(core).encode("ascii")).hexdigest()
    return {**core, "hash": digest}


def full_migration_chain() -> tuple[dict[str, object], ...]:
    specifications = (
        ("list_projects", HMAC_A, HEX_A, None),
        ("inspect_migrations", HMAC_A, HEX_B, None),
        ("apply_migration", HMAC_B, HEX_C, HEX_A),
        ("sql_check", HMAC_B, HEX_D, None),
        ("inspect_migrations", HMAC_C, HEX_E, None),
        ("apply_migration", HMAC_D, HEX_A, HEX_B),
        ("sql_check", HMAC_D, HEX_B, None),
        ("inspect_migrations", HMAC_E, HEX_C, None),
    )
    previous = GENESIS
    entries: list[dict[str, object]] = []
    for sequence, (operation, postcondition, request_hash, permit_hash) in enumerate(specifications):
        entry = mcp_entry(
            sequence,
            previous,
            operation=operation,
            postcondition_hash=postcondition,
            request_hash=request_hash,
            permit_hash=permit_hash,
        )
        entries.append(entry)
        previous = str(entry["hash"])
    return tuple(entries)


def rechain(entries: list[dict[str, object]]) -> tuple[dict[str, object], ...]:
    previous = GENESIS
    output: list[dict[str, object]] = []
    for sequence, entry in enumerate(entries):
        core = {"sequence": sequence, "previousHash": previous, "payload": entry["payload"]}
        digest = hashlib.sha256(controller.canonical_json(core).encode("ascii")).hexdigest()
        output.append({**core, "hash": digest})
        previous = digest
    return tuple(output)


class ManifestCoverageTests(unittest.TestCase):
    def test_manifest_is_the_exact_operational_harness_tree(self) -> None:
        harness_root = Path(__file__).resolve().parents[1]
        repository_root = harness_root.parents[1]
        expected = {
            path.relative_to(repository_root).as_posix()
            for path in harness_root.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix in {".json", ".mjs", ".py"}
        }
        expected.add("docs/AI_PIPELINE_E2E_RUNBOOK.md")
        self.assertEqual(controller.REQUIRED_HARNESS_FILES, frozenset(expected))


class MutationDispatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = b"architect-regression-mcp-key-material"
        self.target = mcp_bridge.project_ref_hmac(self.key, "a" * 20)

    def broker(self, step: str, call_tool_result: dict[str, object]) -> dict[str, object]:
        raw = json.dumps(call_tool_result, separators=(",", ":")).encode("ascii")
        with tempfile.TemporaryFile() as input_file, tempfile.TemporaryFile() as key_file:
            input_file.write(raw)
            input_file.flush()
            key_file.write(self.key)
            key_file.flush()
            return mcp_bridge.broker_call_tool_result(
                step,
                expected_project_ref_hmac=self.target,
                input_fd=input_file.fileno(),
                mac_key_fd=key_file.fileno(),
            )

    def test_apply_is_error_is_unknown_but_read_only_error_is_failed(self) -> None:
        error_result = {
            "content": [{"type": "text", "text": "redacted"}],
            "isError": True,
        }
        self.assertEqual(
            self.broker("apply_migration_009", error_result),
            {"safeCode": "MCP_ACTION_UNKNOWN"},
        )
        self.assertEqual(
            self.broker("postcondition_009", error_result),
            {"safeCode": "MCP_OPERATION_FAILED"},
        )

    def run_adapter(self, *, failure: str) -> dict[str, object]:
        source = mcp_bridge.render_functions_exec_adapter(
            "apply_migration_009",
            request_session_id=11,
            broker_session_id=12,
        )
        request: dict[str, object] = {
            "schemaVersion": mcp_bridge.ADAPTER_SCHEMA_VERSION,
            "step": "apply_migration_009",
            "projectId": "a" * 20,
            "targetProjectHmac": self.target,
        }
        if "permitHash" in source:
            request.update(
                {
                    "action": "apply_migration_009",
                    "permitHash": HEX_A,
                    "consumeHash": HEX_B,
                    "payloadSha256": mcp_queries.MIGRATIONS["009"].sha256,
                    "developmentTargetHmac": self.target,
                }
            )
        harness = f"""
const output = [];
let applyCalls = 0;
const request = {json.dumps(request, separators=(",", ":"))};
const failure = {json.dumps(failure)};
const text = (value) => output.push(String(value));
const tools = {{
  write_stdin: async (input) => {{
    if (input.session_id === 11) {{
      if (failure === "pre") throw new Error("pre");
      return {{output: JSON.stringify(request) + "\\n"}};
    }}
    return {{output: '{{"safeCode":"MCP_ACTION_UNKNOWN"}}\\n'}};
  }},
  mcp__supabase__apply_migration: async () => {{
    applyCalls += 1;
    if (failure === "post") throw new Error("post");
    return {{content:[{{type:"text",text:"redacted"}}],isError:true}};
  }},
}};
{source}
process.stdout.write(JSON.stringify({{output,applyCalls}}));
"""
        completed = subprocess.run(
            (NODE, "--input-type=module"),
            input=harness.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.defpath},
            check=False,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr.decode("utf-8", "replace"))
        self.assertEqual(completed.stderr, b"")
        return json.loads(completed.stdout)

    def test_pre_dispatch_failure_is_failed_and_post_dispatch_exception_is_unknown(self) -> None:
        before = self.run_adapter(failure="pre")
        self.assertEqual(before["applyCalls"], 0)
        self.assertEqual(before["output"], ['{"safeCode":"MCP_OPERATION_FAILED"}'])

        after = self.run_adapter(failure="post")
        self.assertEqual(after["applyCalls"], 1)
        self.assertEqual(after["output"], ['{"safeCode":"MCP_ACTION_UNKNOWN"}'])

    def test_apply_source_requires_exact_consumed_permit_payload_step_and_target_binding(self) -> None:
        source = mcp_bridge.render_functions_exec_adapter(
            "apply_migration_009",
            request_session_id=21,
            broker_session_id=22,
        )
        required_fields = {
            "action": "action",
            "permit_hash": "permitHash",
            "consume_hash": "consumeHash",
            "payload_sha256": "payloadSha256",
            "development_target_hmac": "developmentTargetHmac",
            "pinned_migration_digest": mcp_queries.MIGRATIONS["009"].sha256,
        }
        for label, required in required_fields.items():
            self.assertTrue(required in source, f"missing_apply_binding:{label}")
        dispatch = source.index("await tools.mcp__supabase__apply_migration")
        for required in ("permitHash", "consumeHash", "payloadSha256", "developmentTargetHmac"):
            self.assertLess(source.index(required), dispatch)

        read_only = mcp_bridge.render_functions_exec_adapter(
            "postcondition_009",
            request_session_id=23,
            broker_session_id=24,
        )
        for mutation_only in ("permitHash", "consumeHash"):
            self.assertNotIn(mutation_only, read_only)

    def test_permit_is_single_use_and_exactly_bound_before_dispatch(self) -> None:
        with private_regular_fd() as ledger_fd, tempfile.TemporaryFile() as key_file:
            key_file.write(self.key)
            key_file.flush()
            ledger = secure_state.MutationPermitLedger(ledger_fd)
            issue = {
                "operation": "apply_migration",
                "action": "apply_migration_009",
                "development_target_hmac": self.target,
                "payload_sha256": mcp_queries.MIGRATIONS["009"].sha256,
                "case_id": "DB-02",
                "idempotency_hmac": HMAC_E,
                "required_state": "migration_009_prepared",
                "controller_state_hash": HEX_D,
                "controller_state_sequence": 8,
                "ttl_ns": 60_000_000_000,
                "mac_key_fd": key_file.fileno(),
            }
            permit_hash = ledger.issue(**issue)
            consume = {
                "operation": issue["operation"],
                "action": issue["action"],
                "development_target_hmac": issue["development_target_hmac"],
                "payload_sha256": issue["payload_sha256"],
                "case_id": issue["case_id"],
                "idempotency_hmac": issue["idempotency_hmac"],
                "controller_state": issue["required_state"],
                "controller_state_hash": issue["controller_state_hash"],
                "controller_state_sequence": issue["controller_state_sequence"],
                "mac_key_fd": key_file.fileno(),
            }
            ledger.consume(permit_hash, **consume)
            with self.assertRaisesRegex(ValueError, "mutation_permit_unavailable"):
                ledger.consume(permit_hash, **consume)
            for mismatch in (
                {"action": "apply_migration_010"},
                {"development_target_hmac": HMAC_A},
                {"payload_sha256": mcp_queries.MIGRATIONS["010"].sha256},
            ):
                with self.subTest(mismatch=tuple(mismatch)):
                    with self.assertRaises(ValueError):
                        ledger.verify_consumption(
                            ledger.entries()[1]["hash"],
                            operation=consume["operation"],
                            action=mismatch.get("action", consume["action"]),
                            development_target_hmac=mismatch.get(
                                "development_target_hmac", consume["development_target_hmac"]
                            ),
                            payload_sha256=mismatch.get("payload_sha256", consume["payload_sha256"]),
                            case_id=consume["case_id"],
                            idempotency_hmac=consume["idempotency_hmac"],
                            controller_state=consume["controller_state"],
                            controller_state_hash=consume["controller_state_hash"],
                            controller_state_sequence=consume["controller_state_sequence"],
                            mac_key_fd=key_file.fileno(),
                        )


class MigrationAttestationTests(unittest.TestCase):
    def test_full_chain_requires_apply_postcondition_and_per_version_ledger(self) -> None:
        full = full_migration_chain()
        try:
            result = controller.verify_mcp_chain(full)
        except ValueError as error:
            self.fail(f"full_migration_attestation_rejected:{error}")
        self.assertTrue(result["verified"])
        self.assertEqual(result["successfulMigrationCount"], 2)

        for missing_index in (3, 4, 6):
            with self.subTest(missing_index=missing_index):
                incomplete = rechain([entry for index, entry in enumerate(full) if index != missing_index])
                with self.assertRaises(ValueError):
                    controller.verify_mcp_chain(incomplete)

    def test_legacy_apply_only_attestation_chain_is_rejected(self) -> None:
        full = full_migration_chain()
        apply_only = rechain([full[index] for index in (0, 1, 2, 5, 7)])
        with self.assertRaises(ValueError):
            controller.verify_mcp_chain(apply_only)

    def test_migration_attested_event_rejects_apply_receipt_without_postcondition_and_ledger(self) -> None:
        state = controller.ControllerState(
            phase="migration_009_in_flight",
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX_A,
            prepared_version="009",
            prepared_target_hmac=HMAC_A,
            prepared_payload_sha256="sha256:" + mcp_queries.MIGRATIONS["009"].sha256,
            prepared_payload_binding_hmac=HMAC_B,
            current_consume_hash=HEX_A,
            current_permit_hash=HEX_B,
            consumed_permit_hashes=(HEX_B,),
            development_target_hmac=HMAC_A,
            mcp_sequence=1,
            mcp_tail_hash=HEX_A,
        )
        apply_receipt = mcp_entry(
            2,
            HEX_A,
            operation="apply_migration",
            postcondition_hash=HMAC_B,
            request_hash=HEX_C,
            permit_hash=HEX_B,
        )
        event = {
            "type": "MIGRATION_ATTESTED",
            "version": "009",
            "consumeHash": HEX_A,
            "targetHmac": HMAC_A,
            "mcpEntry": apply_receipt,
            "effectPresent": True,
            "targetMatched": True,
            "payloadMatched": True,
            "permitLedgerFd": 9,
            "productionActionCount": 0,
        }
        with private_regular_fd() as ledger_fd:
            event["permitLedgerFd"] = ledger_fd
            with mock.patch.object(
                secure_state.MutationPermitLedger,
                "verify_outcome",
                return_value={"verified": True},
            ):
                with self.assertRaises((TypeError, ValueError)):
                    controller.transition(state, event)


if __name__ == "__main__":
    unittest.main()
