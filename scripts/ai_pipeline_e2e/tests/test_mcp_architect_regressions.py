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
    consume_hash: str | None = None,
    dispatch_hash: str | None = None,
    safe_receipt_hmac: str | None = None,
    success: bool = True,
    safe_code: str | None = None,
) -> dict[str, object]:
    mutation = operation == "apply_migration"
    if mutation:
        consume_hash = consume_hash or request_hash
        dispatch_hash = dispatch_hash or request_hash
        safe_receipt_hmac = safe_receipt_hmac or ("hmac-sha256:" + request_hash)
    payload: dict[str, object] = {
        "schemaVersion": "protected-mcp-attestation.v2",
        "operation": operation,
        "targetHmac": HMAC_A,
        "permitHash": None if permit_hash is None else "sha256:" + permit_hash,
        "consumeHash": None if consume_hash is None else "sha256:" + consume_hash,
        "dispatchHash": None if dispatch_hash is None else "sha256:" + dispatch_hash,
        "safeReceiptHmac": safe_receipt_hmac,
        "requestHash": "sha256:" + request_hash,
        "responseHmac": safe_receipt_hmac or HMAC_B,
        "preconditionHash": HMAC_B,
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
        ("inspect_migrations", HMAC_E, HEX_D, None),
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
            "targetCapabilityHmac": HMAC_D,
        }
        if "permitHash" in source:
            request.update(
                {
                    "action": "apply_migration_009",
                    "permitHash": HEX_A,
                    "consumeHash": HEX_B,
                    "dispatchHash": HEX_C,
                    "payloadSha256": mcp_queries.MIGRATIONS["009"].sha256,
                    "developmentTargetHmac": self.target,
                }
            )
            request["unknownReceipt"] = {
                "safeCode": "MCP_ACTION_UNKNOWN",
                "productionActionCount": 0,
                "targetProjectHmac": self.target,
                "developmentTargetHmac": self.target,
                "targetCapabilityHmac": HMAC_D,
                "permitHash": "sha256:" + HEX_A,
                "consumeHash": "sha256:" + HEX_B,
                "dispatchHash": "sha256:" + HEX_C,
                "payloadSha256": "sha256:" + mcp_queries.MIGRATIONS["009"].sha256,
                "resultHmac": HMAC_E,
            }
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
      if (failure === "validation") request.schemaVersion = "invalid";
      return {{output: JSON.stringify(request) + "\\n"}};
    }}
    if (failure === "broker") throw new Error("broker");
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
        receipt = json.loads(after["output"][0])
        self.assertEqual(receipt["safeCode"], "MCP_ACTION_UNKNOWN")
        self.assertEqual(receipt["consumeHash"], "sha256:" + HEX_B)
        self.assertEqual(receipt["dispatchHash"], "sha256:" + HEX_C)

        for failure in ("validation", "broker"):
            with self.subTest(failure=failure):
                failed = self.run_adapter(failure=failure)
                receipt = json.loads(failed["output"][0])
                self.assertEqual(receipt["safeCode"], "MCP_ACTION_UNKNOWN")
                self.assertEqual(receipt["permitHash"], "sha256:" + HEX_A)
                self.assertEqual(receipt["payloadSha256"], "sha256:" + mcp_queries.MIGRATIONS["009"].sha256)
                self.assertEqual(receipt["targetCapabilityHmac"], HMAC_D)
                self.assertEqual(receipt["developmentTargetHmac"], self.target)

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
            "dispatch_hash": "dispatchHash",
            "payload_sha256": "payloadSha256",
            "development_target_hmac": "developmentTargetHmac",
            "target_capability_hmac": "targetCapabilityHmac",
            "pinned_migration_digest": mcp_queries.MIGRATIONS["009"].sha256,
        }
        for label, required in required_fields.items():
            self.assertTrue(required in source, f"missing_apply_binding:{label}")
        dispatch = source.index("await tools.mcp__supabase__apply_migration")
        for required in (
            "permitHash",
            "consumeHash",
            "dispatchHash",
            "payloadSha256",
            "developmentTargetHmac",
            "targetCapabilityHmac",
        ):
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
                "development_target_capability_hmac": HMAC_D,
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
                "development_target_capability_hmac": issue[
                    "development_target_capability_hmac"
                ],
                "payload_sha256": issue["payload_sha256"],
                "case_id": issue["case_id"],
                "idempotency_hmac": issue["idempotency_hmac"],
                "controller_state": issue["required_state"],
                "controller_state_hash": issue["controller_state_hash"],
                "controller_state_sequence": issue["controller_state_sequence"],
                "mac_key_fd": key_file.fileno(),
            }
            consume_hash = ledger.consume(permit_hash, **consume)
            with self.assertRaisesRegex(ValueError, "mutation_permit_unavailable"):
                ledger.consume(permit_hash, **consume)
            dispatch = ledger.authorize_dispatch(
                consume_hash,
                permit_hash=permit_hash,
                **consume,
            )
            self.assertTrue(dispatch["verified"])
            reopened = secure_state.MutationPermitLedger(ledger_fd)
            with self.assertRaisesRegex(ValueError, "mutation_dispatch_unavailable"):
                reopened.authorize_dispatch(
                    consume_hash,
                    permit_hash=permit_hash,
                    **consume,
                )
            verified_dispatch = reopened.verify_dispatch(
                dispatch["dispatchHash"],
                consume_hash=consume_hash,
                permit_hash=permit_hash,
                operation=consume["operation"],
                action=consume["action"],
                development_target_hmac=consume["development_target_hmac"],
                development_target_capability_hmac=consume[
                    "development_target_capability_hmac"
                ],
                payload_sha256=consume["payload_sha256"],
                mac_key_fd=consume["mac_key_fd"],
            )
            self.assertEqual(verified_dispatch["dispatchHash"], dispatch["dispatchHash"])
            for mismatch in (
                {"action": "apply_migration_010"},
                {"development_target_hmac": HMAC_A},
                {"development_target_capability_hmac": HMAC_A},
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
                            development_target_capability_hmac=mismatch.get(
                                "development_target_capability_hmac",
                                consume["development_target_capability_hmac"],
                            ),
                            payload_sha256=mismatch.get("payload_sha256", consume["payload_sha256"]),
                            case_id=consume["case_id"],
                            idempotency_hmac=consume["idempotency_hmac"],
                            controller_state=consume["controller_state"],
                            controller_state_hash=consume["controller_state_hash"],
                            controller_state_sequence=consume["controller_state_sequence"],
                            mac_key_fd=key_file.fileno(),
                        )
            ledger.record_outcome(
                consume_hash,
                "unknown",
                dispatch_hash=dispatch["dispatchHash"],
                safe_receipt_hmac=HMAC_E,
                mac_key_fd=key_file.fileno(),
            )
            verified_outcome = ledger.verify_outcome(
                consume_hash,
                "unknown",
                mac_key_fd=key_file.fileno(),
            )
            self.assertEqual(verified_outcome["dispatchHash"], dispatch["dispatchHash"])
            self.assertEqual(verified_outcome["safeReceiptHmac"], HMAC_E)

            entries = json.loads(json.dumps(ledger.entries()))
            entries[-1]["payload"]["safeReceiptHmac"] = HMAC_A
            core = {
                "sequence": entries[-1]["sequence"],
                "previousHash": entries[-1]["previousHash"],
                "payload": entries[-1]["payload"],
            }
            entries[-1]["hash"] = hashlib.sha256(
                controller.canonical_json(core).encode("ascii")
            ).hexdigest()
            encoded = "".join(
                controller.canonical_json(entry) + "\n" for entry in entries
            ).encode("ascii")
            os.lseek(ledger_fd, 0, os.SEEK_SET)
            os.ftruncate(ledger_fd, 0)
            os.write(ledger_fd, encoded)
            os.fsync(ledger_fd)
            with self.assertRaisesRegex(ValueError, "mutation_outcome_not_verified"):
                ledger.verify_outcome(
                    consume_hash,
                    "unknown",
                    mac_key_fd=key_file.fileno(),
                )

    def test_dispatch_authorization_rejects_a_permit_that_expired_after_consumption(self) -> None:
        issued_at = 25_000_000_000
        ttl_ns = secure_state.MIN_MUTATION_PERMIT_TTL_NS
        with private_regular_fd() as ledger_fd, tempfile.TemporaryFile() as key_file:
            key_file.write(self.key)
            key_file.flush()
            ledger = secure_state.MutationPermitLedger(ledger_fd)
            binding = {
                "operation": "apply_migration",
                "action": "apply_migration_009",
                "development_target_hmac": self.target,
                "development_target_capability_hmac": HMAC_D,
                "payload_sha256": mcp_queries.MIGRATIONS["009"].sha256,
                "case_id": "DB-02",
                "idempotency_hmac": HMAC_E,
                "controller_state_hash": HEX_D,
                "controller_state_sequence": 8,
                "mac_key_fd": key_file.fileno(),
            }
            with mock.patch.object(
                secure_state.time, "monotonic_ns", return_value=issued_at
            ):
                permit_hash = ledger.issue(
                    required_state="migration_009_prepared",
                    ttl_ns=ttl_ns,
                    **binding,
                )
            with mock.patch.object(
                secure_state.time, "monotonic_ns", return_value=issued_at + 1
            ):
                consume_hash = ledger.consume(
                    permit_hash,
                    controller_state="migration_009_prepared",
                    **binding,
                )
            with mock.patch.object(
                secure_state.time,
                "monotonic_ns",
                return_value=issued_at + ttl_ns,
            ):
                with self.assertRaisesRegex(ValueError, "mutation_dispatch_time_invalid"):
                    ledger.authorize_dispatch(
                        consume_hash,
                        permit_hash=permit_hash,
                        controller_state="migration_009_prepared",
                        **binding,
                    )
            self.assertEqual(
                [entry["payload"]["kind"] for entry in ledger.entries()],
                ["issue", "consume"],
            )

    def test_unknown_reconciliation_catalog_is_exact_and_read_only_for_both_versions(self) -> None:
        for version in ("009", "010"):
            for effect_present in (False, True):
                with self.subTest(version=version, effect_present=effect_present):
                    requests = mcp_queries.build_reconciliation_requests(
                        version,
                        "a" * 20,
                        effect_present=effect_present,
                    )
                    self.assertEqual(len(requests), 2)
                    self.assertEqual(
                        tuple(request.step for request in requests),
                        mcp_queries.RECONCILIATION_STEPS[version][effect_present],
                    )
                    self.assertTrue(
                        all(not mcp_queries.CATALOG[request.step].mutation for request in requests)
                    )
                    self.assertEqual(
                        {request.tool for request in requests},
                        {"execute_sql", "list_migrations"},
                    )


class MigrationAttestationTests(unittest.TestCase):
    def test_mcp_attestation_schema_requires_exact_mutation_bindings(self) -> None:
        mutation = mcp_entry(
            0,
            GENESIS,
            operation="apply_migration",
            postcondition_hash=HMAC_C,
            request_hash=HEX_A,
            permit_hash=HEX_B,
            consume_hash=HEX_C,
            dispatch_hash=HEX_D,
            safe_receipt_hmac=HMAC_E,
        )["payload"]
        self.assertEqual(secure_state._sanitize_mcp_attestation(mutation), mutation)
        with self.assertRaisesRegex(ValueError, "mcp_attestation_invalid"):
            secure_state._sanitize_mcp_attestation(
                {**mutation, "schemaVersion": "protected-mcp-attestation.v1"}
            )
        for field in ("permitHash", "consumeHash", "dispatchHash", "safeReceiptHmac"):
            with self.subTest(field=field):
                with self.assertRaises((TypeError, ValueError)):
                    secure_state._sanitize_mcp_attestation({**mutation, field: None})
        with self.assertRaisesRegex(ValueError, "mcp_mutation_receipt_invalid"):
            secure_state._sanitize_mcp_attestation(
                {**mutation, "safeReceiptHmac": HMAC_D}
            )

        read_only = mcp_entry(
            0,
            GENESIS,
            operation="sql_check",
            postcondition_hash=HMAC_C,
            request_hash=HEX_A,
        )["payload"]
        with self.assertRaisesRegex(
            ValueError, "mcp_read_only_mutation_binding_forbidden"
        ):
            secure_state._sanitize_mcp_attestation(
                {**read_only, "consumeHash": "sha256:" + HEX_C}
            )

    def test_full_chain_requires_apply_postcondition_and_per_version_ledger(self) -> None:
        full = full_migration_chain()
        try:
            result = controller.verify_mcp_chain(full)
        except ValueError as error:
            self.fail(f"full_migration_attestation_rejected:{error}")
        self.assertTrue(result["verified"])
        self.assertEqual(result["successfulMigrationCount"], 2)

        with self.assertRaisesRegex(ValueError, "mcp_chain_count_invalid"):
            controller.verify_mcp_chain(full[:-1])

        changed_postflight = [dict(entry) for entry in full]
        changed_postflight[-1] = {
            **changed_postflight[-1],
            "payload": {
                **changed_postflight[-1]["payload"],
                "postconditionHash": HMAC_C,
            },
        }
        with self.assertRaisesRegex(ValueError, "mcp_chain_postflight_invalid"):
            controller.verify_mcp_chain(rechain(changed_postflight))

        changed_capability = [dict(entry) for entry in full]
        changed_capability[1] = {
            **changed_capability[1],
            "payload": {
                **changed_capability[1]["payload"],
                "preconditionHash": HMAC_C,
            },
        }
        with self.assertRaisesRegex(ValueError, "mcp_chain_target_capability_mismatch"):
            controller.verify_mcp_chain(rechain(changed_capability))

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
            development_target_capability_hmac=HMAC_B,
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
