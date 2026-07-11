from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import socket
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.ai_pipeline_e2e import controller, sanitizer, secure_state, service_bootstrap


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
REAL_ATTESTATION_KEY = hashlib.sha256(b"offline-real-attestation-fixture-key").digest()
REAL_PROVIDER_MAC_DOMAIN = b"acttub-protected-real-provider.v1\0"
REAL_MEDIA_MAC_DOMAIN = b"acttub-protected-real-media.v1\0"
EXPECTED_CASES = (
    "SAFE-01",
    "SRC-01",
    "DB-01",
    "DB-02",
    "GUARD-01",
    "GUARD-02",
    "GUARD-03",
    "MEDIA-01",
    "MEDIA-02",
    "MEDIA-03",
    "LEGACY-01",
    "BLOCKED-01",
    "PAUSE-01",
    "MANUAL-01",
    "BOUNDARY-05",
    "BOUNDARY-10R",
    "BOUNDARY-10N",
    "COUNT-01",
    "REPORT-01",
    "REAL-01",
    "LINEAGE-01",
    "REPLAY-01",
    "RLS-01",
    "DELETE-01",
    "UI-01",
)


def real_attestation_fixture(
    key: bytes = REAL_ATTESTATION_KEY,
    *,
    provider_call_count: int = 3,
    media_byte_count: int = 1_048_576,
) -> dict[str, object]:
    provider_event_count = provider_call_count + 3
    provider_event_tail_hmac = HMAC_B
    provider_event_aggregate_hmac = HMAC_C
    media_content_hmac = HMAC_A
    provider_core: dict[str, object] = {
        "schemaVersion": "protected-real-attestation.v1",
        "serviceModes": {"summary": "real", "agent": "real", "report": "real"},
        "providerCredentialFdOnly": True,
        "providerCallCount": provider_call_count,
        "providerStagesObserved": ["summary", "agent", "report"],
        "providerEventCount": provider_event_count,
        "providerEventTailHmac": provider_event_tail_hmac,
        "providerEventAggregateHmac": provider_event_aggregate_hmac,
    }
    media_core: dict[str, object] = {
        "schemaVersion": "protected-real-attestation.v1",
        "mediaReadFromFd": True,
        "mediaByteCount": media_byte_count,
        "mediaContentHmac": media_content_hmac,
    }
    return {
        **provider_core,
        "mediaReadFromFd": True,
        "mediaByteCount": media_byte_count,
        "mediaContentHmac": media_content_hmac,
        "providerAttestationHmac": "hmac-sha256:"
        + hmac.new(
            key,
            REAL_PROVIDER_MAC_DOMAIN + controller.canonical_json(provider_core).encode("ascii"),
            hashlib.sha256,
        ).hexdigest(),
        "mediaAttestationHmac": "hmac-sha256:"
        + hmac.new(
            key,
            REAL_MEDIA_MAC_DOMAIN + controller.canonical_json(media_core).encode("ascii"),
            hashlib.sha256,
        ).hexdigest(),
    }


def passing_evidence(
    case_id: str,
    *,
    assertion_hmacs: dict[str, str] | None = None,
) -> dict[str, object]:
    definition = sanitizer.CASE_BY_ID[case_id]
    assertions: list[dict[str, object]] = []
    for expected in definition["assertions"]:
        assertion: dict[str, object] = {"id": expected["id"], "passed": True}
        if expected["kind"] == "count":
            assertion["count"] = expected["equals"]
        elif expected["kind"] == "hmac":
            assertion["hmac"] = (assertion_hmacs or {}).get(expected["id"], HMAC_A)
        assertions.append(assertion)
    mode = "real" if definition["allowedModes"] == ["real"] else "scripted"
    return {
        "schemaVersion": sanitizer.EVIDENCE_SCHEMA_VERSION,
        "caseId": case_id,
        "mode": mode,
        "status": "pass",
        "assertions": assertions,
    }


def chain_entry(sequence: int, previous_hash: str, payload: dict[str, object]) -> dict[str, object]:
    core = {"sequence": sequence, "previousHash": previous_hash, "payload": payload}
    return {**core, "hash": hashlib.sha256(sanitizer.canonical_json(core).encode("ascii")).hexdigest()}


def evidence_chain_fixture() -> tuple[dict[str, object], ...]:
    attestation = real_attestation_fixture()
    real_assertion_hmacs = {
        "provider_attestation_hmac": str(attestation["providerAttestationHmac"]),
        "media_attestation_hmac": str(attestation["mediaAttestationHmac"]),
    }
    previous_hash = "0" * 64
    entries: list[dict[str, object]] = []
    for sequence, case_id in enumerate(sanitizer.CASE_IDS):
        entry = chain_entry(
            sequence,
            previous_hash,
            passing_evidence(
                case_id,
                assertion_hmacs=real_assertion_hmacs if case_id == "REAL-01" else None,
            ),
        )
        entries.append(entry)
        previous_hash = str(entry["hash"])
    return tuple(entries)


def mcp_entry_fixture(
    sequence: int,
    previous_hash: str,
    *,
    operation: str,
    permit_hash: str | None = None,
    consume_hash: str | None = None,
    dispatch_hash: str | None = None,
    safe_receipt_hmac: str | None = None,
    postcondition_hmac: str = HMAC_A,
    request_hash: str = HEX_A,
    success: bool = True,
    safe_code: str | None = None,
) -> dict[str, object]:
    mutation = operation == "apply_migration"
    if mutation:
        consume_hash = (consume_hash or request_hash).removeprefix("sha256:")
        dispatch_hash = (dispatch_hash or request_hash).removeprefix("sha256:")
        safe_receipt_hmac = safe_receipt_hmac or (
            "hmac-sha256:" + request_hash.removeprefix("sha256:")
        )
    payload: dict[str, object] = {
        "schemaVersion": "protected-mcp-attestation.v2",
        "operation": operation,
        "targetHmac": HMAC_A,
        "permitHash": None if permit_hash is None else "sha256:" + permit_hash.removeprefix("sha256:"),
        "consumeHash": None if consume_hash is None else "sha256:" + consume_hash,
        "dispatchHash": None if dispatch_hash is None else "sha256:" + dispatch_hash,
        "safeReceiptHmac": safe_receipt_hmac,
        "requestHash": "sha256:" + request_hash.removeprefix("sha256:"),
        "responseHmac": safe_receipt_hmac or HMAC_A,
        "preconditionHash": HMAC_A,
        "postconditionHash": postcondition_hmac,
        "success": success,
        "schemaValid": True,
        "developmentMatch": True,
        "productionAction": False,
        "safeCode": safe_code,
    }
    return chain_entry(sequence, previous_hash, payload)


def mcp_chain_fixture() -> tuple[dict[str, object], ...]:
    specifications = (
        ("list_projects", None, HEX_A, HMAC_A),
        ("inspect_migrations", None, HEX_A, HMAC_A),
        ("apply_migration", HEX_A, HEX_A, HMAC_A),
        ("sql_check", None, HEX_A, HMAC_A),
        ("inspect_migrations", None, HEX_A, HMAC_C),
        ("apply_migration", HEX_B, HEX_B, HMAC_B),
        ("sql_check", None, HEX_A, HMAC_B),
        ("inspect_migrations", None, HEX_A, HMAC_D),
        ("inspect_migrations", None, HEX_A, HMAC_D),
    )
    previous_hash = "0" * 64
    entries: list[dict[str, object]] = []
    for sequence, (operation, permit_hash, request_hash, postcondition_hmac) in enumerate(specifications):
        entry = mcp_entry_fixture(
            sequence,
            previous_hash,
            operation=operation,
            permit_hash=permit_hash,
            request_hash=request_hash,
            postcondition_hmac=postcondition_hmac,
        )
        entries.append(entry)
        previous_hash = str(entry["hash"])
    return tuple(entries)


def mcp_retry_chain_fixture() -> tuple[dict[str, object], ...]:
    specifications = (
        ("list_projects", None, HEX_A, HMAC_A, True, None),
        ("inspect_migrations", None, HEX_A, HMAC_A, True, None),
        ("apply_migration", HEX_A, HEX_A, HMAC_A, False, "MCP_ACTION_UNKNOWN"),
        ("sql_check", None, HEX_A, HMAC_A, True, None),
        ("inspect_migrations", None, HEX_A, HMAC_C, True, None),
        ("apply_migration", HEX_B, HEX_B, HMAC_A, True, None),
        ("sql_check", None, HEX_A, HMAC_A, True, None),
        ("inspect_migrations", None, HEX_A, HMAC_D, True, None),
        ("apply_migration", HEX_C, HEX_C, HMAC_B, True, None),
        ("sql_check", None, HEX_A, HMAC_B, True, None),
        ("inspect_migrations", None, HEX_A, HMAC_E, True, None),
        ("inspect_migrations", None, HEX_A, HMAC_E, True, None),
    )
    previous_hash = "0" * 64
    entries: list[dict[str, object]] = []
    for sequence, (operation, permit_hash, request_hash, postcondition_hmac, success, safe_code) in enumerate(
        specifications
    ):
        entry = mcp_entry_fixture(
            sequence,
            previous_hash,
            operation=operation,
            permit_hash=permit_hash,
            request_hash=request_hash,
            postcondition_hmac=postcondition_hmac,
            success=success,
            safe_code=safe_code,
        )
        entries.append(entry)
        previous_hash = str(entry["hash"])
    return tuple(entries)


def browser_chain_fixture() -> tuple[dict[str, object], ...]:
    payload: dict[str, object] = {
        "schemaVersion": "protected-browser-attestation.v1",
        "operation": "ui_probe",
        "resultHmac": HMAC_A,
        "success": True,
        "booleanCount": 3,
        "boundedCount": 2,
        "capturedArtifacts": 0,
    }
    return (chain_entry(0, "0" * 64, payload),)


def manifest_fixture() -> dict[str, object]:
    repositories = {
        name: {
            "branch": controller.EXPECTED_BRANCHES[name],
            "head": str(index + 1) * 40,
            "tree": str(index + 5) * 40,
            "clean": True,
            "upstreamEqual": True,
            "lockfileSha256": HEX_A,
            "detachedWorktree": {
                "head": str(index + 1) * 40,
                "tree": str(index + 5) * 40,
                "clean": True,
                "detached": True,
                "primaryWorktreeUntouched": True,
            },
        }
        for index, name in enumerate(controller.REPOSITORY_NAMES)
    }
    return controller.create_hash_manifest(
        repositories=repositories,
        migrations={version: HEX_A for version in controller.MIGRATION_PIN_VERSIONS},
        migration_ledger=HEX_A,
        harness_tree=HEX_A,
        sanitizer=HEX_A,
        case_ledger=HEX_A,
        acceptance={name: HEX_B for name in controller.ACCEPTANCE_NAMES},
    )


def controller_step(state: controller.ControllerState, event: dict[str, object]) -> controller.ControllerState:
    def validate_persisted_state(alias: str, record: object) -> None:
        if alias != "state":
            raise AssertionError("controller_state_alias_invalid")
        controller.restore_controller_state(record)

    return controller.transition_and_persist(state, event, validate_persisted_state)


def case_record_event(
    state: controller.ControllerState,
    case_id: str,
    *,
    real_attestation: dict[str, object] | None = None,
    mac_key_fd: int | None = None,
) -> dict[str, object]:
    assertion_hmacs = None
    if case_id == "REAL-01":
        if real_attestation is None or mac_key_fd is None:
            raise ValueError("real_case_fixture_missing")
        assertion_hmacs = {
            "provider_attestation_hmac": str(real_attestation["providerAttestationHmac"]),
            "media_attestation_hmac": str(real_attestation["mediaAttestationHmac"]),
        }
    evidence = passing_evidence(case_id, assertion_hmacs=assertion_hmacs)
    previous_hash = state.evidence_hashes[-1] if state.evidence_hashes else "0" * 64
    entry = chain_entry(state.next_case_index, previous_hash, evidence)
    event: dict[str, object] = {"type": "CASE_RECORDED", "evidence": evidence, "evidenceHash": entry["hash"]}
    if case_id == "REAL-01":
        event.update({"realAttestation": real_attestation, "macKeyFd": mac_key_fd})
    return event


class PrivateRun:
    def __init__(self) -> None:
        self._temporary = tempfile.TemporaryDirectory(prefix="protected-e2e-offline-")
        os.chmod(self._temporary.name, 0o700)
        self.parent = self._temporary.name
        self.run_name = "run-offline01"
        self.state = secure_state.initialize_private_state(
            self.parent,
            self.run_name,
            repository_roots=(str(Path.cwd()),),
        )

    @property
    def root(self) -> Path:
        return Path(self.parent, self.run_name)

    def close(self) -> None:
        self.state.close()
        self._temporary.cleanup()


class SanitizerTests(unittest.TestCase):
    def test_case_ledger_is_exact_and_unique(self) -> None:
        self.assertEqual(sanitizer.CASE_IDS, EXPECTED_CASES)
        self.assertEqual(len(set(sanitizer.CASE_IDS)), 25)

    def test_allowlist_rejects_unknown_and_raw_fields(self) -> None:
        valid = passing_evidence("SAFE-01")
        self.assertEqual(sanitizer.sanitize_evidence(valid), valid)
        with self.assertRaises((TypeError, ValueError)):
            sanitizer.sanitize_evidence({**valid, "content": sanitizer.FORBIDDEN_CANARY})
        with self.assertRaises((TypeError, ValueError)):
            sanitizer.sanitize_evidence({**valid, "details": {"passed": True}})

    def test_forbidden_scan_detects_each_prohibited_shape(self) -> None:
        samples = {
            "canary": sanitizer.FORBIDDEN_CANARY,
            "url": "https://invalid.example/value",
            "jwt": "eyJabcdefgh.eyJabcdefgh.eyJabcdefgh",
            "uuid": "00000000-0000-4000-8000-000000000001",
            "absolute_path": "/Users/example/private-file",
            "signed_url": "X-Amz-Signature=value",
            "raw_payload_field": '{"content":"not allowed"}',
        }
        for code, sample in samples.items():
            with self.subTest(code=code):
                self.assertIn(code, sanitizer.scan_forbidden_text(sample))

    def test_canary_self_test_is_fail_closed(self) -> None:
        self.assertTrue(all(sanitizer.sanitizer_canary_self_test().values()))


class SecureStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.run = PrivateRun()

    def tearDown(self) -> None:
        self.run.close()

    def test_layout_permissions_cloexec_lock_and_no_secret_files(self) -> None:
        self.assertEqual(stat.S_IMODE(self.run.root.stat().st_mode), 0o700)
        names = {path.name for path in self.run.root.iterdir()}
        self.assertEqual(names, {"tmp", *(filename for filename, _initial in secure_state.PRIVATE_FILE_LAYOUT.values())})
        self.assertEqual(
            set(secure_state.PRIVATE_FILE_LAYOUT),
            {
                "run-mac-key",
                "state",
                "manifest",
                "mcp-attestations",
                "provider-attestations",
                "browser-attestations",
                "bridge-wal",
                "cleanup-vault",
                "mutation-permits",
                "evidence",
                "lock",
                "receipt",
            },
        )
        self.assertNotIn("platform-settings.json", names)
        self.assertNotIn("summary-settings.json", names)
        self.assertNotIn("agent-settings.json", names)
        self.assertNotIn("report-settings.json", names)
        for alias, (filename, _initial) in secure_state.PRIVATE_FILE_LAYOUT.items():
            info = (self.run.root / filename).stat()
            self.assertEqual(stat.S_IMODE(info.st_mode), 0o600, alias)
            self.assertEqual(info.st_nlink, 1, alias)
            fd = self.run.state.file_fd(alias)
            self.assertTrue(fcntl.fcntl(fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC, alias)
        competing = os.open(self.run.root / "run.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(competing)

    def test_run_mac_key_is_private_random_and_stable_across_reopen(self) -> None:
        key_fd = self.run.state.file_fd("run-mac-key")
        first_digest = hashlib.sha256(os.pread(key_fd, secure_state.RUN_MAC_KEY_BYTES, 0)).digest()
        self.assertEqual(os.fstat(key_fd).st_size, secure_state.RUN_MAC_KEY_BYTES)
        self.run.state.close()
        resumed = secure_state.reopen_private_state(
            self.run.parent,
            self.run.run_name,
            repository_roots=(str(Path.cwd()),),
        )
        self.run.state = resumed
        resumed_fd = resumed.file_fd("run-mac-key")
        second_digest = hashlib.sha256(os.pread(resumed_fd, secure_state.RUN_MAC_KEY_BYTES, 0)).digest()
        self.assertEqual(first_digest, second_digest)

    def test_reopen_rejects_truncated_run_mac_key(self) -> None:
        self.run.state.close()
        key_path = self.run.root / secure_state.PRIVATE_FILE_LAYOUT["run-mac-key"][0]
        key_path.write_bytes(b"short")
        key_path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "run_mac_key_invalid"):
            secure_state.reopen_private_state(
                self.run.parent,
                self.run.run_name,
                repository_roots=(str(Path.cwd()),),
            )
        key_path.write_bytes(b"k" * secure_state.RUN_MAC_KEY_BYTES)
        key_path.chmod(0o600)
        self.run.state = secure_state.reopen_private_state(
            self.run.parent,
            self.run.run_name,
            repository_roots=(str(Path.cwd()),),
        )

    def test_active_run_cannot_be_reopened_then_closed_run_can_resume(self) -> None:
        with self.assertRaises(BlockingIOError):
            secure_state.reopen_private_state(
                self.run.parent,
                self.run.run_name,
                repository_roots=(str(Path.cwd()),),
            )
        self.run.state.close()
        resumed = secure_state.reopen_private_state(
            self.run.parent,
            self.run.run_name,
            repository_roots=(str(Path.cwd()),),
        )
        self.run.state = resumed
        self.assertEqual(stat.S_IMODE(os.fstat(resumed.root_fd).st_mode), 0o700)

    def test_owner_only_parent_and_outside_repository_are_required(self) -> None:
        with tempfile.TemporaryDirectory(prefix="protected-e2e-parent-") as parent:
            os.chmod(parent, 0o770)
            with self.assertRaises(ValueError):
                secure_state.initialize_private_state(
                    parent,
                    "run-rejected1",
                    repository_roots=(str(Path.cwd()),),
                )
        with self.assertRaises(ValueError):
            secure_state.initialize_private_state(
                self.run.parent,
                "run-rejected2",
                repository_roots=(self.run.parent,),
            )

    def test_private_regular_file_rejects_hardlinks(self) -> None:
        evidence_path = self.run.root / secure_state.PRIVATE_FILE_LAYOUT["evidence"][0]
        hardlink = self.run.root / "evidence-hardlink"
        os.link(evidence_path, hardlink)
        try:
            with self.assertRaises(ValueError):
                secure_state.EvidenceChain(self.run.state.files["evidence"])
        finally:
            hardlink.unlink()

    def test_private_regular_file_rejects_foreign_owner(self) -> None:
        fd = self.run.state.file_fd("evidence")
        info = os.fstat(fd)
        foreign_owner = mock.Mock(
            st_mode=info.st_mode,
            st_uid=os.geteuid() + 1,
            st_nlink=info.st_nlink,
        )
        with mock.patch.object(secure_state.os, "fstat", return_value=foreign_owner):
            with self.assertRaises(ValueError):
                secure_state._require_private_regular_fd(fd)

    def test_atomic_record_write_and_replay_rejection(self) -> None:
        record = {"schemaVersion": "protected-e2e-receipt.v1", "phase": "sealed", "caseCount": 25}
        self.run.state.write_record_atomic("receipt", record)
        self.assertEqual(secure_state.read_private_record(self.run.state.file_fd("receipt")), record)
        with self.assertRaises((FileExistsError, ValueError)):
            self.run.state.write_record_atomic("receipt", record)

    def test_evidence_chain_binds_order_payload_and_tail(self) -> None:
        chain = secure_state.EvidenceChain(self.run.state.file_fd("evidence"))
        first = chain.append(passing_evidence("SAFE-01"))
        second = chain.append(passing_evidence("SRC-01"))
        self.assertEqual(second["sequence"], 1)
        self.assertEqual(second["previousHash"], first["hash"])
        self.assertEqual(chain.entries()[-1]["hash"], second["hash"])
        chain.assert_forbidden_scan_clean()
        os.pwrite(self.run.state.file_fd("evidence"), b"x", 0)
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            chain.entries()

    def test_cleanup_wal_and_vault_support_fd_only_crash_recovery(self) -> None:
        vault = secure_state.CleanupVault(self.run.state.file_fd("cleanup-vault"))
        locator = b"non-sensitive-test-locator"
        key = b"offline-test-key"
        locator_hmac = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
        with tempfile.TemporaryFile() as locator_file, tempfile.TemporaryFile() as key_file:
            locator_file.write(locator)
            key_file.write(key)
            locator_file.flush()
            key_file.flush()
            plan_hash = vault.plan(
                resource_alias="transient-session",
                resource_kind="practice_session",
                action="delete_session",
                locator_hmac=locator_hmac,
                locator_fd=locator_file.fileno(),
                hmac_key_fd=key_file.fileno(),
            )
        with tempfile.TemporaryFile() as recovered:
            vault.copy_locator(plan_hash, recovered.fileno())
            recovered.seek(0)
            self.assertEqual(recovered.read(), locator)
        with self.assertRaises(ValueError):
            vault.assert_complete()
        vault.complete(plan_hash, "deleted")
        vault.assert_complete()

    def test_cleanup_vault_recovers_partial_tail_before_append(self) -> None:
        vault = secure_state.CleanupVault(self.run.state.file_fd("cleanup-vault"))
        locator = b"crash-recovery-locator"
        key = b"crash-recovery-key"
        locator_hmac = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
        with tempfile.TemporaryFile() as locator_file, tempfile.TemporaryFile() as key_file:
            locator_file.write(locator)
            key_file.write(key)
            locator_file.flush()
            key_file.flush()
            plan_hash = vault.plan(
                resource_alias="transient-session",
                resource_kind="practice_session",
                action="delete_session",
                locator_hmac=locator_hmac,
                locator_fd=locator_file.fileno(),
                hmac_key_fd=key_file.fileno(),
            )
        os.lseek(self.run.state.file_fd("cleanup-vault"), 0, os.SEEK_END)
        os.write(self.run.state.file_fd("cleanup-vault"), b'{"kind":"removed"')
        recovered = secure_state.CleanupVault(self.run.state.file_fd("cleanup-vault"))
        recovered.complete(plan_hash, "deleted")
        recovered.assert_complete()

    def test_every_hash_chain_recovers_only_an_unterminated_crash_tail(self) -> None:
        chain_specs = (
            ("evidence", secure_state.EvidenceChain),
            ("mcp-attestations", secure_state.McpAttestationChain),
            ("browser-attestations", secure_state.BrowserAttestationChain),
            ("mutation-permits", secure_state.MutationPermitLedger),
            ("cleanup-vault", secure_state.CleanupVault),
        )
        for alias, chain_type in chain_specs:
            with self.subTest(alias=alias):
                fd = self.run.state.file_fd(alias)
                os.lseek(fd, 0, os.SEEK_END)
                os.write(fd, b'{"crashTail"')
                recovered = chain_type(fd)
                self.assertEqual(recovered.entries(), ())

                os.lseek(fd, 0, os.SEEK_END)
                os.write(fd, b'{}\n')
                with self.assertRaises((TypeError, ValueError)):
                    chain_type(fd)

    def test_cleanup_vault_rejects_unsafe_ingress_and_accepts_typed_storage_locator(self) -> None:
        vault = secure_state.CleanupVault(self.run.state.file_fd("cleanup-vault"))
        key = b"cleanup-boundary-key-material-32b"
        with tempfile.TemporaryFile() as key_file, tempfile.TemporaryFile() as locator_file:
            key_file.write(key)
            locator_file.write(b"storage-object:v1:bucket/object")
            key_file.flush()
            locator_file.flush()
            with self.assertRaises((TypeError, ValueError)):
                vault.plan(
                    resource_alias="run-storage-object",
                    resource_kind="storage_object",
                    action="delete_storage_object",
                    locator_hmac=HMAC_A,
                    locator_fd=0,
                    hmac_key_fd=key_file.fileno(),
                )
            with self.assertRaises((TypeError, ValueError)):
                vault.plan(
                    resource_alias="run-storage-object",
                    resource_kind="storage_object",
                    action="delete_storage_object",
                    locator_hmac=HMAC_A,
                    locator_fd=locator_file.fileno(),
                    hmac_key_fd=2,
                )

            forbidden_locators = (
                b"https://invalid.example/storage-object",
                b"Bearer synthetic-credential",
                b"/private/local/storage-object",
                sanitizer.FORBIDDEN_CANARY.encode("ascii"),
            )
            for locator in forbidden_locators:
                with self.subTest(locator_kind=hashlib.sha256(locator).hexdigest()[:8]):
                    with tempfile.TemporaryFile() as forbidden_file:
                        forbidden_file.write(locator)
                        forbidden_file.flush()
                        locator_hmac = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
                        with self.assertRaises(ValueError):
                            vault.plan(
                                resource_alias="run-storage-object",
                                resource_kind="storage_object",
                                action="delete_storage_object",
                                locator_hmac=locator_hmac,
                                locator_fd=forbidden_file.fileno(),
                                hmac_key_fd=key_file.fileno(),
                            )

            typed_locator = b"storage-object:v1:run-bucket/object-0001"
            with tempfile.TemporaryFile() as typed_file:
                typed_file.write(typed_locator)
                typed_file.flush()
                locator_hmac = "hmac-sha256:" + hmac.new(key, typed_locator, hashlib.sha256).hexdigest()
                plan_hash = vault.plan(
                    resource_alias="run-storage-object",
                    resource_kind="storage_object",
                    action="delete_storage_object",
                    locator_hmac=locator_hmac,
                    locator_fd=typed_file.fileno(),
                    hmac_key_fd=key_file.fileno(),
                )
            with self.assertRaises((TypeError, ValueError)):
                vault.copy_locator(plan_hash, 1)
            with tempfile.TemporaryFile() as recovered:
                vault.copy_locator(plan_hash, recovered.fileno())
                recovered.seek(0)
                self.assertEqual(recovered.read(), typed_locator)
            vault.complete(plan_hash, "deleted")
            vault.assert_complete()

    def test_cleanup_vault_enforces_exact_plan_cross_products_and_action_outcomes(self) -> None:
        expected_plan_types = {
            "temporary-rls-account": ("auth_user", "delete_auth_user"),
            "run-provider-file": ("provider_file", "delete_provider_file"),
            "real-success-session": ("practice_session", "retain_session"),
            "transient-session": ("practice_session", "delete_session"),
            "run-upload-intent": ("upload_intent", "delete_upload_intent"),
            "run-storage-object": ("storage_object", "delete_storage_object"),
            "run-deletion-request": ("deletion_request", "reconcile_deletion_request"),
            "run-ai-run": ("ai_run", "delete_ai_run"),
            "run-session-bundle": ("session_bundle", "reconcile_session_bundle"),
        }
        expected_outcomes = {
            "delete_auth_user": frozenset({"deleted", "absent", "not_created"}),
            "delete_provider_file": frozenset({"deleted", "absent", "not_created"}),
            "delete_session": frozenset({"deleted", "absent", "not_created"}),
            "delete_storage_object": frozenset({"deleted", "absent", "not_created"}),
            "delete_upload_intent": frozenset({"deleted", "absent", "not_created"}),
            "delete_ai_run": frozenset({"deleted", "absent", "not_created"}),
            "reconcile_deletion_request": frozenset({"reconciled", "absent"}),
            "reconcile_session_bundle": frozenset(
                {"retained", "deleted", "absent", "not_created"}
            ),
            "retain_session": frozenset({"retained"}),
        }
        self.assertEqual(dict(secure_state.CLEANUP_PLAN_TYPES), expected_plan_types)
        self.assertEqual(dict(secure_state.CLEANUP_ALLOWED_OUTCOMES), expected_outcomes)

        vault = secure_state.CleanupVault(self.run.state.file_fd("cleanup-vault"))
        key = hashlib.sha256(b"offline-cleanup-mapping-key").digest()
        all_outcomes = frozenset(outcome for outcomes in expected_outcomes.values() for outcome in outcomes)

        def plan(
            alias: str,
            resource_kind: str,
            action: str,
            locator: bytes,
            key_fd: int,
        ) -> str:
            locator_hmac = "hmac-sha256:" + hmac.new(key, locator, hashlib.sha256).hexdigest()
            with tempfile.TemporaryFile() as locator_file:
                locator_file.write(locator)
                locator_file.flush()
                return vault.plan(
                    resource_alias=alias,
                    resource_kind=resource_kind,
                    action=action,
                    locator_hmac=locator_hmac,
                    locator_fd=locator_file.fileno(),
                    hmac_key_fd=key_fd,
                )

        with tempfile.TemporaryFile() as key_file:
            key_file.write(key)
            key_file.flush()
            all_pairs = set(expected_plan_types.values())
            for alias, (resource_kind, action) in expected_plan_types.items():
                for wrong_kind, wrong_action in all_pairs - {(resource_kind, action)}:
                    with self.subTest(alias=alias, wrong_kind=wrong_kind, wrong_action=wrong_action):
                        with self.assertRaises(ValueError):
                            plan(
                                alias,
                                wrong_kind,
                                wrong_action,
                                f"cleanup:v1:{alias}:cross-product".encode("ascii"),
                                key_file.fileno(),
                            )

                for outcome in sorted(expected_outcomes[action]):
                    with self.subTest(alias=alias, action=action, outcome=outcome):
                        plan_hash = plan(
                            alias,
                            resource_kind,
                            action,
                            f"cleanup:v1:{alias}:{outcome}".encode("ascii"),
                            key_file.fileno(),
                        )
                        wrong_outcome = sorted(all_outcomes - expected_outcomes[action])[0]
                        with self.assertRaisesRegex(ValueError, "cleanup_vault_outcome_invalid"):
                            vault.complete(plan_hash, wrong_outcome)
                        vault.complete(plan_hash, outcome)
        vault.assert_complete()

    def test_mutation_permit_is_mac_bound_durable_and_single_use(self) -> None:
        permits = secure_state.MutationPermitLedger(self.run.state.file_fd("mutation-permits"))
        key = b"K" * 32
        nonce = b"N" * 32
        idempotency_hmac = "hmac-sha256:" + HEX_B
        issued_at = 50_000_000_000
        ttl_ns = 5_000_000_000
        with tempfile.TemporaryFile() as key_file:
            key_file.write(key)
            key_file.flush()
            with (
                mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at),
                mock.patch.object(secure_state.os, "urandom", return_value=nonce),
            ):
                permit_hash = permits.issue(
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    required_state="migration_009_prepared",
                    controller_state_hash=HEX_B,
                    controller_state_sequence=7,
                    ttl_ns=ttl_ns,
                    mac_key_fd=key_file.fileno(),
                )
            issue = permits.entries()[0]["payload"]
            self.assertEqual(issue["kind"], "issue")
            self.assertRegex(issue["permitMac"], r"^hmac-sha256:[a-f0-9]{64}$")
            self.assertRegex(issue["nonceCommitment"], r"^sha256:[a-f0-9]{64}$")
            wal = os.pread(
                self.run.state.file_fd("mutation-permits"),
                os.fstat(self.run.state.file_fd("mutation-permits")).st_size,
                0,
            )
            self.assertNotIn(key, wal)
            self.assertNotIn(nonce, wal)
            self.assertNotIn(nonce.hex().encode("ascii"), wal)

            real_fsync = os.fsync
            with (
                mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at + 1),
                mock.patch.object(secure_state.os, "fsync", wraps=real_fsync) as fsync_spy,
            ):
                consume_hash = permits.consume(
                    permit_hash,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    controller_state="migration_009_prepared",
                    controller_state_hash=HEX_B,
                    controller_state_sequence=7,
                    mac_key_fd=key_file.fileno(),
                )
            self.assertTrue(any(call.args == (self.run.state.file_fd("mutation-permits"),) for call in fsync_spy.mock_calls))
            with self.assertRaises(ValueError):
                permits.consume(
                    permit_hash,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    controller_state="migration_009_prepared",
                    controller_state_hash=HEX_B,
                    controller_state_sequence=7,
                    mac_key_fd=key_file.fileno(),
                )
            with mock.patch.object(
                secure_state.time, "monotonic_ns", return_value=issued_at + 2
            ):
                dispatch = permits.authorize_dispatch(
                    consume_hash,
                    permit_hash=permit_hash,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    controller_state="migration_009_prepared",
                    controller_state_hash=HEX_B,
                    controller_state_sequence=7,
                    mac_key_fd=key_file.fileno(),
                )
                self.assertRegex(dispatch["dispatchHash"], r"^[a-f0-9]{64}$")
                with self.assertRaisesRegex(ValueError, "mutation_dispatch_unavailable"):
                    permits.authorize_dispatch(
                        consume_hash,
                        permit_hash=permit_hash,
                        operation="apply_migration",
                        action="apply_migration_009",
                        development_target_hmac=HMAC_A,
                        development_target_capability_hmac=HMAC_A,
                        payload_sha256=HEX_A,
                        case_id="DB-02",
                        idempotency_hmac=idempotency_hmac,
                        controller_state="migration_009_prepared",
                        controller_state_hash=HEX_B,
                        controller_state_sequence=7,
                        mac_key_fd=key_file.fileno(),
                    )
        with tempfile.TemporaryFile() as outcome_key_file:
            outcome_key_file.write(key)
            outcome_key_file.flush()
            permits.record_outcome(
                consume_hash,
                "unknown",
                dispatch_hash=dispatch["dispatchHash"],
                safe_receipt_hmac=HMAC_A,
                mac_key_fd=outcome_key_file.fileno(),
            )
        permits.reconcile(consume_hash, effect_present=False)

    def test_mutation_permit_rejects_every_binding_mismatch(self) -> None:
        permits = secure_state.MutationPermitLedger(self.run.state.file_fd("mutation-permits"))
        key = b"A" * 32
        wrong_key = b"B" * 32
        issued_at = 70_000_000_000
        idempotency_hmac = "hmac-sha256:" + HEX_B
        with tempfile.TemporaryFile() as key_file, tempfile.TemporaryFile() as wrong_key_file:
            key_file.write(key)
            wrong_key_file.write(wrong_key)
            key_file.flush()
            wrong_key_file.flush()
            with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at):
                permit_hash = permits.issue(
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    required_state="migration_009_prepared",
                    controller_state_hash=HEX_B,
                    controller_state_sequence=11,
                    ttl_ns=10_000_000_000,
                    mac_key_fd=key_file.fileno(),
                )
            valid = {
                "operation": "apply_migration",
                "action": "apply_migration_009",
                "development_target_hmac": HMAC_A,
                "development_target_capability_hmac": HMAC_A,
                "payload_sha256": HEX_A,
                "case_id": "DB-02",
                "idempotency_hmac": idempotency_hmac,
                "controller_state": "migration_009_prepared",
                "controller_state_hash": HEX_B,
                "controller_state_sequence": 11,
                "mac_key_fd": key_file.fileno(),
            }
            mismatches = (
                {"operation": "sql_check"},
                {"action": "apply_migration_010", "controller_state": "migration_010_prepared"},
                {"development_target_hmac": "hmac-sha256:" + HEX_B},
                {"development_target_capability_hmac": "hmac-sha256:" + HEX_B},
                {"payload_sha256": HEX_B},
                {"case_id": "DB-01"},
                {"idempotency_hmac": "hmac-sha256:" + ("c" * 64)},
                {"controller_state": "migration_009_retry_prepared"},
                {"controller_state_hash": HEX_A},
                {"controller_state_sequence": 12},
                {"mac_key_fd": wrong_key_file.fileno()},
            )
            for mismatch in mismatches:
                with self.subTest(mismatch=tuple(mismatch)):
                    with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at + 1):
                        with self.assertRaises((TypeError, ValueError)):
                            permits.consume(permit_hash, **{**valid, **mismatch})

    def test_mutation_permit_expiry_ttl_idempotency_and_mac_tamper_fail_closed(self) -> None:
        permits = secure_state.MutationPermitLedger(self.run.state.file_fd("mutation-permits"))
        key = b"C" * 32
        issued_at = 90_000_000_000
        ttl_ns = secure_state.MIN_MUTATION_PERMIT_TTL_NS
        issue_args = {
            "operation": "apply_migration",
            "action": "apply_migration_009",
            "development_target_hmac": HMAC_A,
            "development_target_capability_hmac": HMAC_A,
            "payload_sha256": HEX_A,
            "case_id": "DB-02",
            "idempotency_hmac": "hmac-sha256:" + HEX_B,
            "required_state": "migration_009_prepared",
            "controller_state_hash": HEX_B,
            "controller_state_sequence": 21,
        }
        with tempfile.TemporaryFile() as key_file:
            key_file.write(key)
            key_file.flush()
            with tempfile.TemporaryFile() as weak_key_file:
                weak_key_file.write(b"too-short")
                weak_key_file.flush()
                with self.assertRaises(ValueError):
                    permits.issue(
                        **issue_args,
                        ttl_ns=ttl_ns,
                        mac_key_fd=weak_key_file.fileno(),
                    )
            for invalid_ttl in (
                secure_state.MIN_MUTATION_PERMIT_TTL_NS - 1,
                secure_state.MAX_MUTATION_PERMIT_TTL_NS + 1,
            ):
                with self.subTest(invalid_ttl=invalid_ttl):
                    with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at):
                        with self.assertRaises(ValueError):
                            permits.issue(**issue_args, ttl_ns=invalid_ttl, mac_key_fd=key_file.fileno())
            with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at):
                permit_hash = permits.issue(**issue_args, ttl_ns=ttl_ns, mac_key_fd=key_file.fileno())
            consume_args = {
                "operation": issue_args["operation"],
                "action": issue_args["action"],
                "development_target_hmac": issue_args["development_target_hmac"],
                "development_target_capability_hmac": issue_args[
                    "development_target_capability_hmac"
                ],
                "payload_sha256": issue_args["payload_sha256"],
                "case_id": issue_args["case_id"],
                "idempotency_hmac": issue_args["idempotency_hmac"],
                "controller_state": issue_args["required_state"],
                "controller_state_hash": issue_args["controller_state_hash"],
                "controller_state_sequence": issue_args["controller_state_sequence"],
                "mac_key_fd": key_file.fileno(),
            }
            for invalid_now in (issued_at - 1, issued_at + ttl_ns):
                with self.subTest(invalid_now=invalid_now):
                    with mock.patch.object(secure_state.time, "monotonic_ns", return_value=invalid_now):
                        with self.assertRaises(ValueError):
                            permits.consume(permit_hash, **consume_args)
            with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at + 1):
                with self.assertRaises(ValueError):
                    permits.issue(
                        **{
                            **issue_args,
                            "action": "apply_migration_010",
                            "required_state": "migration_010_prepared",
                            "controller_state_sequence": 22,
                        },
                        ttl_ns=ttl_ns,
                        mac_key_fd=key_file.fileno(),
                    )
                with self.assertRaises(ValueError):
                    permits.issue(
                        **{
                            **issue_args,
                            "action": "apply_migration_010",
                            "idempotency_hmac": "hmac-sha256:" + ("c" * 64),
                            "required_state": "migration_010_prepared",
                        },
                        ttl_ns=ttl_ns,
                        mac_key_fd=key_file.fileno(),
                    )

            original = permits.entries()[0]
            tampered_payload = {**original["payload"], "permitMac": "hmac-sha256:" + HEX_A}
            core = {
                "sequence": original["sequence"],
                "previousHash": original["previousHash"],
                "payload": tampered_payload,
            }
            tampered = {**core, "hash": hashlib.sha256(sanitizer.canonical_json(core).encode("ascii")).hexdigest()}
            fd = self.run.state.file_fd("mutation-permits")
            os.ftruncate(fd, 0)
            os.lseek(fd, 0, os.SEEK_SET)
            os.write(fd, (sanitizer.canonical_json(tampered) + "\n").encode("ascii"))
            os.fsync(fd)
            with mock.patch.object(secure_state.time, "monotonic_ns", return_value=issued_at + 1):
                with self.assertRaises(ValueError):
                    permits.consume(tampered["hash"], **consume_args)


class ControllerContractTests(unittest.TestCase):
    def test_migration_ledgers_are_exact(self) -> None:
        self.assertEqual(controller.validate_migration_ledger("pre", controller.MIGRATION_PRE_LEDGER)["count"], 8)
        self.assertEqual(controller.validate_migration_ledger("post", controller.MIGRATION_POST_LEDGER)["count"], 10)
        with self.assertRaises(ValueError):
            controller.validate_migration_ledger("pre", controller.MIGRATION_POST_LEDGER)
        with self.assertRaises(ValueError):
            controller.validate_migration_ledger("post", (*controller.MIGRATION_POST_LEDGER, "011_unreviewed"))

    def test_mcp_chain_rejects_target_changes_and_reused_migration_bindings(self) -> None:
        entries = mcp_chain_fixture()
        self.assertTrue(controller.verify_mcp_chain(entries)["verified"])

        def rechain(payloads: list[dict[str, object]]) -> tuple[dict[str, object], ...]:
            previous_hash = "0" * 64
            result: list[dict[str, object]] = []
            for sequence, payload in enumerate(payloads):
                entry = chain_entry(sequence, previous_hash, payload)
                result.append(entry)
                previous_hash = str(entry["hash"])
            return tuple(result)

        payloads = [dict(entry["payload"]) for entry in entries]
        target_changed = [dict(payload) for payload in payloads]
        target_changed[3]["targetHmac"] = HMAC_B
        with self.assertRaises(ValueError):
            controller.verify_mcp_chain(rechain(target_changed))

        for field in ("permitHash", "requestHash", "postconditionHash"):
            with self.subTest(reused_field=field):
                reused = [dict(payload) for payload in payloads]
                reused[5][field] = reused[2][field]
                with self.assertRaises(ValueError):
                    controller.verify_mcp_chain(rechain(reused))

    def test_retry_chain_seals_and_verifies_receipt_with_fresh_mutation_bindings(self) -> None:
        mcp_entries = mcp_retry_chain_fixture()
        self.assertEqual(controller.verify_mcp_chain(mcp_entries)["successfulMigrationCount"], 2)

        def rechain(payloads: list[dict[str, object]]) -> tuple[dict[str, object], ...]:
            previous_hash = "0" * 64
            entries: list[dict[str, object]] = []
            for sequence, payload in enumerate(payloads):
                entry = chain_entry(sequence, previous_hash, payload)
                entries.append(entry)
                previous_hash = str(entry["hash"])
            return tuple(entries)

        payloads = [dict(entry["payload"]) for entry in mcp_entries]
        changed_retry_binding = [dict(payload) for payload in payloads]
        changed_retry_binding[5]["postconditionHash"] = HMAC_C
        with self.assertRaises(ValueError):
            controller.verify_mcp_chain(rechain(changed_retry_binding))

        changed_reconciliation_binding = [dict(payload) for payload in payloads]
        changed_reconciliation_binding[3]["postconditionHash"] = HMAC_C
        with self.assertRaisesRegex(ValueError, "mcp_chain_postcondition_invalid"):
            controller.verify_mcp_chain(rechain(changed_reconciliation_binding))

        duplicate_retry_permit = [dict(payload) for payload in payloads]
        duplicate_retry_permit[5]["permitHash"] = duplicate_retry_permit[2]["permitHash"]
        with self.assertRaisesRegex(ValueError, "mcp_chain_migration_binding_reused"):
            controller.verify_mcp_chain(rechain(duplicate_retry_permit))

        evidence_entries = evidence_chain_fixture()
        browser_entries = browser_chain_fixture()
        manifest = manifest_fixture()
        attestation = real_attestation_fixture()
        state = controller.ControllerState(
            phase="cleanup_verified",
            next_case_index=len(sanitizer.CASE_IDS),
            completed_cases=sanitizer.CASE_IDS,
            evidence_hashes=tuple(str(entry["hash"]) for entry in evidence_entries),
            manifest_verified=True,
            production_negative_verified=True,
            actual_gemini_observed=True,
            actual_media_observed=True,
            manifest_digest=controller.manifest_digest(manifest),
            development_mcp_attestation_hash=str(mcp_entries[0]["hash"]),
            consumed_permit_hashes=(HEX_A, HEX_B, HEX_C),
            migration_attestation_hashes=(str(mcp_entries[7]["hash"]), str(mcp_entries[10]["hash"])),
            development_target_hmac=HMAC_A,
            development_target_capability_hmac=HMAC_A,
            mcp_sequence=len(mcp_entries) - 1,
            mcp_tail_hash=str(mcp_entries[-1]["hash"]),
            scripted_phase_cleaned=True,
            real_phase_started=True,
            cleanup_vault_complete=True,
            retention_verified=True,
            transition_sequence=70,
            provider_attestation_hmac=str(attestation["providerAttestationHmac"]),
            media_attestation_hmac=str(attestation["mediaAttestationHmac"]),
        )
        sealed = controller_step(
            state,
            {
                "type": "EVIDENCE_SEALED",
                "evidenceEntries": evidence_entries,
                "mcpEntries": mcp_entries,
                "browserEntries": browser_entries,
                "manifest": manifest,
            },
        )
        self.assertEqual(sealed.phase, "evidence_sealed")
        completed_state = controller_step(sealed, {"type": "COMPLETE"})
        self.assertEqual(completed_state.phase, "completed")

        with tempfile.TemporaryFile() as receipt_key_file:
            receipt_key_file.write(hashlib.sha256(b"offline-retry-receipt-key").digest())
            receipt_key_file.flush()
            receipt = controller.controller_receipt(completed_state, receipt_key_file.fileno())
            verified = controller.verify_controller_receipt(
                receipt,
                mac_key_fd=receipt_key_file.fileno(),
                evidence_entries=evidence_entries,
                mcp_entries=mcp_entries,
                browser_entries=browser_entries,
                manifest=manifest,
            )
            self.assertTrue(verified["verified"])

    def test_boolean_values_are_rejected_for_exact_count_contracts(self) -> None:
        target_entry = mcp_entry_fixture(
            0,
            "0" * 64,
            operation="list_projects",
            postcondition_hmac=HMAC_A,
        )
        proof: dict[str, object] = {
            "source": "supabase_mcp",
            "environment": "development",
            "expectedProjectHmac": HMAC_A,
            "urlDerivedProjectHmac": HMAC_A,
            "inventoryProjectHmac": HMAC_A,
            "productionProjectHmac": HMAC_B,
            "inventoryProjectCount": 1,
            "deniedOtherProjectCount": 0,
            "productionActionCount": 0,
            "mcpAttestationHash": target_entry["hash"],
        }
        for field, value in (
            ("inventoryProjectCount", True),
            ("deniedOtherProjectCount", False),
            ("productionActionCount", False),
        ):
            with self.subTest(development_count=field):
                with self.assertRaises(ValueError):
                    controller.assert_development_target({**proof, field: value}, (target_entry,))

        mcp_target = {
            "operation": "target",
            "developmentVerified": True,
            "productionNegativeVerified": True,
            "productionActions": 0,
            "projectHmac": HMAC_A,
        }
        self.assertEqual(controller.sanitize_mcp_adapter_result(mcp_target), mcp_target)
        with self.assertRaises(ValueError):
            controller.sanitize_mcp_adapter_result({**mcp_target, "productionActions": False})

        prepare_state = controller.ControllerState(
            phase="migration_009_prepare_required",
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX_A,
            development_target_hmac=HMAC_A,
            development_target_capability_hmac=HMAC_A,
        )
        prepare_event = {
            "type": "MIGRATION_PREPARED",
            "version": "009",
            "targetHmac": HMAC_A,
            "payloadSha256": HEX_A,
            "payloadBindingHmac": HMAC_B,
            "mcpOnly": True,
            "productionActionCount": 0,
        }
        with self.assertRaises(ValueError):
            controller.transition(prepare_state, {**prepare_event, "productionActionCount": False})
        self.assertEqual(controller.transition(prepare_state, prepare_event).phase, "migration_009_prepared")

        run = PrivateRun()
        try:
            ledger_fd = run.state.file_fd("mutation-permits")
            in_flight = controller.ControllerState(
                phase="migration_009_in_flight",
                manifest_verified=True,
                production_negative_verified=True,
                manifest_digest="sha256:" + HEX_A,
                prepared_version="009",
                prepared_target_hmac=HMAC_A,
                prepared_payload_sha256="sha256:" + HEX_A,
                current_consume_hash=HEX_A,
                current_permit_hash=HEX_B,
                consumed_permit_hashes=(HEX_B,),
                development_target_hmac=HMAC_A,
                development_target_capability_hmac=HMAC_A,
                mcp_sequence=1,
                mcp_tail_hash=HEX_A,
                prepared_payload_binding_hmac=HMAC_B,
            )
            attested_entry = mcp_entry_fixture(
                2,
                HEX_A,
                operation="apply_migration",
                permit_hash=HEX_B,
                consume_hash=HEX_A,
                dispatch_hash=HEX_C,
                safe_receipt_hmac=HMAC_D,
                postcondition_hmac=HMAC_B,
                request_hash=HEX_B,
            )
            attested_postcondition = mcp_entry_fixture(
                3,
                str(attested_entry["hash"]),
                operation="sql_check",
                postcondition_hmac=HMAC_B,
                request_hash=HEX_C,
            )
            attested_ledger = mcp_entry_fixture(
                4,
                str(attested_postcondition["hash"]),
                operation="inspect_migrations",
                postcondition_hmac=HMAC_C,
                request_hash=HEX_D,
            )
            attested_event = {
                "type": "MIGRATION_ATTESTED",
                "version": "009",
                "consumeHash": HEX_A,
                "dispatchHash": HEX_C,
                "safeReceiptHmac": HMAC_D,
                "targetHmac": HMAC_A,
                "applyMcpEntry": attested_entry,
                "postconditionMcpEntry": attested_postcondition,
                "ledgerMcpEntry": attested_ledger,
                "effectPresent": True,
                "ledger": controller.MIGRATION_AFTER_009_LEDGER,
                "ledgerHmac": HMAC_C,
                "targetMatched": True,
                "payloadMatched": True,
                "permitLedgerFd": ledger_fd,
                "macKeyFd": ledger_fd,
                "productionActionCount": 0,
            }
            with mock.patch.object(
                secure_state.MutationPermitLedger,
                "verify_outcome",
                return_value={
                    "verified": True,
                    "dispatchHash": HEX_C,
                    "safeReceiptHmac": HMAC_D,
                },
            ):
                with self.assertRaises(ValueError):
                    controller.transition(in_flight, {**attested_event, "productionActionCount": False})
                for mismatch in (
                    {"consumeHash": HEX_D},
                    {"dispatchHash": HEX_D},
                    {"safeReceiptHmac": HMAC_E},
                ):
                    with self.subTest(mismatch=tuple(mismatch)):
                        with self.assertRaises(ValueError):
                            controller.transition(in_flight, {**attested_event, **mismatch})
                self.assertEqual(controller.transition(in_flight, attested_event).phase, "migration_009_attested")

            unknown = controller.ControllerState(
                **{
                    **in_flight.__dict__,
                    "phase": "migration_009_unknown",
                }
            )
            reconciled_entry = mcp_entry_fixture(
                2,
                HEX_A,
                operation="sql_check",
                postcondition_hmac=HMAC_B,
                request_hash=HEX_B,
            )
            reconciled_ledger = mcp_entry_fixture(
                3,
                str(reconciled_entry["hash"]),
                operation="inspect_migrations",
                postcondition_hmac=HMAC_C,
                request_hash=HEX_C,
            )
            reconciled_event = {
                "type": "MIGRATION_RECONCILED",
                "version": "009",
                "consumeHash": HEX_A,
                "dispatchHash": HEX_C,
                "safeReceiptHmac": HMAC_D,
                "targetHmac": HMAC_A,
                "postconditionMcpEntry": reconciled_entry,
                "ledgerMcpEntry": reconciled_ledger,
                "effectPresent": False,
                "ledger": controller.MIGRATION_PRE_LEDGER,
                "ledgerHmac": HMAC_C,
                "permitLedgerFd": ledger_fd,
                "macKeyFd": ledger_fd,
                "productionActionCount": 0,
            }
            with mock.patch.object(
                secure_state.MutationPermitLedger,
                "verify_reconciliation",
                return_value={
                    "verified": True,
                    "dispatchHash": HEX_C,
                    "safeReceiptHmac": HMAC_D,
                },
            ):
                with self.assertRaises(ValueError):
                    controller.transition(unknown, {**reconciled_event, "productionActionCount": False})
                self.assertEqual(
                    controller.transition(unknown, reconciled_event).phase,
                    "migration_009_retry_required",
                )
        finally:
            run.close()

    def test_controller_state_round_trip_atomic_sequence_and_tamper_rejection(self) -> None:
        run = PrivateRun()
        try:
            state = controller.new_controller()
            offline_event = {
                "type": "OFFLINE_FOUNDATION_VERIFIED",
                "manifestVerified": True,
                "manifestDigest": HEX_A,
                "sanitizerSelfTestPassed": True,
            }
            state = controller.transition_and_persist(state, offline_event, run.state.write_record_atomic)
            self.assertEqual(state.transition_sequence, 1)
            persisted = secure_state.read_private_record(run.state.file_fd("state"))
            self.assertEqual(controller.restore_controller_state(persisted), state)

            state = controller.transition_and_persist(
                state,
                {
                    "type": "PRIVATE_STATE_INITIALIZED",
                    "permissionsVerified": True,
                    "fdContractVerified": True,
                },
                run.state.write_record_atomic,
            )
            self.assertEqual(state.transition_sequence, 2)
            self.assertEqual(controller.restore_controller_state(secure_state.read_private_record(run.state.file_fd("state"))), state)

            tampered_records = (
                {**controller.controller_state_record(state), "transitionSequence": -1},
                {**controller.controller_state_record(state), "phase": "completed"},
                {**controller.controller_state_record(state), "nextCaseIndex": 1},
            )
            for tampered in tampered_records:
                with self.subTest(field_delta=tuple(key for key, value in tampered.items() if value != persisted.get(key))):
                    with self.assertRaises((TypeError, ValueError)):
                        controller.restore_controller_state(tampered)

            original = controller.new_controller()

            def fail_atomic_write(_alias: str, _record: object) -> None:
                raise OSError("synthetic_atomic_write_failure")

            with self.assertRaises(OSError):
                controller.transition_and_persist(original, offline_event, fail_atomic_write)
            self.assertEqual(original.transition_sequence, 0)
            self.assertEqual(original.phase, "created")
        finally:
            run.close()

    def test_controller_requires_real_permit_wal_mac_state_digest_and_fresh_retry(self) -> None:
        run = PrivateRun()
        try:
            ledger_fd = run.state.file_fd("mutation-permits")
            ledger = secure_state.MutationPermitLedger(ledger_fd)
            prepared = controller.ControllerState(
                phase="migration_009_prepared",
                manifest_verified=True,
                production_negative_verified=True,
                manifest_digest="sha256:" + HEX_A,
                development_target_hmac=HMAC_A,
                development_target_capability_hmac=HMAC_A,
                prepared_version="009",
                prepared_target_hmac=HMAC_A,
                prepared_payload_sha256="sha256:" + HEX_A,
                prepared_payload_binding_hmac="hmac-sha256:" + HEX_B,
                mcp_sequence=1,
                mcp_tail_hash=HEX_B,
                transition_sequence=10,
            )
            key = b"controller-permit-mac-key-material"
            wrong_key = b"controller-wrong-mac-key-material"
            with tempfile.TemporaryFile() as key_file, tempfile.TemporaryFile() as wrong_key_file:
                key_file.write(key)
                wrong_key_file.write(wrong_key)
                key_file.flush()
                wrong_key_file.flush()

                def permit_event(consume_hash: str, mac_key_fd: int, idempotency_hmac: str) -> dict[str, object]:
                    return {
                        "type": "MIGRATION_PERMIT_CONSUMED",
                        "version": "009",
                        "action": "apply_migration_009",
                        "consumeHash": consume_hash,
                        "targetHmac": HMAC_A,
                        "payloadSha256": HEX_A,
                        "caseId": "DB-02",
                        "idempotencyHmac": idempotency_hmac,
                        "permitLedgerFd": ledger_fd,
                        "macKeyFd": mac_key_fd,
                    }

                with self.assertRaises(ValueError):
                    controller.transition(prepared, permit_event(HEX_A, key_file.fileno(), "hmac-sha256:" + HEX_A))

                wrong_idempotency = "hmac-sha256:" + HEX_B
                wrong_permit = ledger.issue(
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=wrong_idempotency,
                    required_state=prepared.phase,
                    controller_state_hash=HEX_A,
                    controller_state_sequence=prepared.transition_sequence - 1,
                    ttl_ns=60_000_000_000,
                    mac_key_fd=key_file.fileno(),
                )
                wrong_consume = ledger.consume(
                    wrong_permit,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=wrong_idempotency,
                    controller_state=prepared.phase,
                    controller_state_hash=HEX_A,
                    controller_state_sequence=prepared.transition_sequence - 1,
                    mac_key_fd=key_file.fileno(),
                )
                with self.assertRaises(ValueError):
                    controller.transition(prepared, permit_event(wrong_consume, key_file.fileno(), wrong_idempotency))

                idempotency_hmac = "hmac-sha256:" + ("c" * 64)
                state_digest = controller.controller_state_digest(prepared)
                permit_hash = ledger.issue(
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    required_state=prepared.phase,
                    controller_state_hash=state_digest,
                    controller_state_sequence=prepared.transition_sequence,
                    ttl_ns=60_000_000_000,
                    mac_key_fd=key_file.fileno(),
                )
                consume_hash = ledger.consume(
                    permit_hash,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    controller_state=prepared.phase,
                    controller_state_hash=state_digest,
                    controller_state_sequence=prepared.transition_sequence,
                    mac_key_fd=key_file.fileno(),
                )
                with self.assertRaises(ValueError):
                    controller.transition(prepared, permit_event(consume_hash, wrong_key_file.fileno(), idempotency_hmac))

                in_flight = controller_step(prepared, permit_event(consume_hash, key_file.fileno(), idempotency_hmac))
                self.assertEqual(in_flight.phase, "migration_009_in_flight")
                self.assertEqual(in_flight.current_permit_hash, permit_hash)
                dispatch = ledger.authorize_dispatch(
                    consume_hash,
                    permit_hash=permit_hash,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=idempotency_hmac,
                    controller_state=prepared.phase,
                    controller_state_hash=state_digest,
                    controller_state_sequence=prepared.transition_sequence,
                    mac_key_fd=key_file.fileno(),
                )
                ledger.record_outcome(
                    consume_hash,
                    "unknown",
                    dispatch_hash=dispatch["dispatchHash"],
                    safe_receipt_hmac=HMAC_A,
                    mac_key_fd=key_file.fileno(),
                )
                unknown_mcp = mcp_entry_fixture(
                    in_flight.mcp_sequence + 1,
                    in_flight.mcp_tail_hash,
                    operation="apply_migration",
                    permit_hash=permit_hash,
                    consume_hash=consume_hash,
                    dispatch_hash=dispatch["dispatchHash"],
                    safe_receipt_hmac=HMAC_A,
                    postcondition_hmac=in_flight.prepared_payload_binding_hmac,
                    success=False,
                    safe_code="MCP_ACTION_UNKNOWN",
                )
                unknown = controller_step(
                    in_flight,
                    {
                        "type": "MIGRATION_UNKNOWN",
                        "version": "009",
                        "consumeHash": consume_hash,
                        "dispatchHash": dispatch["dispatchHash"],
                        "safeReceiptHmac": HMAC_A,
                        "reconciliationRequired": True,
                        "mcpEntry": unknown_mcp,
                        "permitLedgerFd": ledger_fd,
                        "macKeyFd": key_file.fileno(),
                    },
                )
                self.assertEqual(unknown.phase, "migration_009_unknown")

                ledger.reconcile(consume_hash, effect_present=False)
                reconciliation_mcp = mcp_entry_fixture(
                    unknown.mcp_sequence + 1,
                    unknown.mcp_tail_hash,
                    operation="sql_check",
                    postcondition_hmac=unknown.prepared_payload_binding_hmac,
                )
                reconciliation_ledger = mcp_entry_fixture(
                    unknown.mcp_sequence + 2,
                    str(reconciliation_mcp["hash"]),
                    operation="inspect_migrations",
                    postcondition_hmac=HMAC_C,
                    request_hash=HEX_C,
                )
                self.assertIsNone(reconciliation_mcp["payload"]["permitHash"])
                retry_required = controller_step(
                    unknown,
                    {
                        "type": "MIGRATION_RECONCILED",
                        "version": "009",
                        "consumeHash": consume_hash,
                        "dispatchHash": dispatch["dispatchHash"],
                        "safeReceiptHmac": HMAC_A,
                        "targetHmac": HMAC_A,
                        "postconditionMcpEntry": reconciliation_mcp,
                        "ledgerMcpEntry": reconciliation_ledger,
                        "effectPresent": False,
                        "ledger": controller.MIGRATION_PRE_LEDGER,
                        "ledgerHmac": HMAC_C,
                        "permitLedgerFd": ledger_fd,
                        "macKeyFd": key_file.fileno(),
                        "productionActionCount": 0,
                    },
                )
                self.assertEqual(retry_required.phase, "migration_009_retry_required")
                retry_prepared = controller_step(
                    retry_required,
                    {
                        "type": "MIGRATION_PREPARED",
                        "version": "009",
                        "targetHmac": HMAC_A,
                        "payloadSha256": HEX_A,
                        "payloadBindingHmac": "hmac-sha256:" + HEX_B,
                        "mcpOnly": True,
                        "productionActionCount": 0,
                    },
                )
                fresh_idempotency = "hmac-sha256:" + ("d" * 64)
                fresh_digest = controller.controller_state_digest(retry_prepared)
                fresh_permit = ledger.issue(
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=fresh_idempotency,
                    required_state=retry_prepared.phase,
                    controller_state_hash=fresh_digest,
                    controller_state_sequence=retry_prepared.transition_sequence,
                    ttl_ns=60_000_000_000,
                    mac_key_fd=key_file.fileno(),
                )
                fresh_consume = ledger.consume(
                    fresh_permit,
                    operation="apply_migration",
                    action="apply_migration_009",
                    development_target_hmac=HMAC_A,
                    development_target_capability_hmac=HMAC_A,
                    payload_sha256=HEX_A,
                    case_id="DB-02",
                    idempotency_hmac=fresh_idempotency,
                    controller_state=retry_prepared.phase,
                    controller_state_hash=fresh_digest,
                    controller_state_sequence=retry_prepared.transition_sequence,
                    mac_key_fd=key_file.fileno(),
                )
                retried = controller_step(
                    retry_prepared,
                    permit_event(fresh_consume, key_file.fileno(), fresh_idempotency),
                )
                self.assertEqual(retried.phase, "migration_009_in_flight")
                self.assertNotEqual(fresh_permit, permit_hash)
                self.assertEqual(retried.consumed_permit_hashes, (permit_hash, fresh_permit))
        finally:
            run.close()

    def test_exact_case_ledger_enforces_scripted_real_isolated_and_ui_phase_order(self) -> None:
        state = controller.ControllerState(
            phase="services_ready",
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX_A,
            migration_attestation_hashes=(HEX_A, HEX_B),
            transition_sequence=30,
        )
        state = controller_step(
            state,
            {
                "type": "BEGIN_SCRIPTED_CASES",
                "providerCredentialPresent": False,
                "scriptedPortsIsolated": True,
                "cleanupPlanned": True,
                "outputsDiscarded": True,
            },
        )
        self.assertEqual(state.phase, "scripted_cases_running")
        for case_id in sanitizer.CASE_IDS[: controller.SCRIPTED_CASE_COUNT]:
            state = controller_step(state, case_record_event(state, case_id))
        self.assertEqual(state.phase, "scripted_cleanup_pending")
        state = controller_step(
            state,
            {
                "type": "SCRIPTED_PHASE_CLEANED",
                "processesStopped": True,
                "providerCredentialAbsent": True,
                "scriptedSessionsRemoved": True,
                "cleanupVaultConsistent": True,
            },
        )
        self.assertEqual(state.phase, "real_start_required")
        state = controller_step(
            state,
            {
                "type": "BEGIN_REAL_CASES",
                "scriptedProcessesStopped": True,
                "settingsFdsValidated": True,
                "mediaFdValidated": True,
                "portsDisjoint": True,
                "explicitSettings": True,
                "outputsDiscarded": True,
            },
        )
        self.assertEqual(state.phase, "real_cases_running")
        attestation = real_attestation_fixture()
        with tempfile.TemporaryFile() as real_key_file:
            real_key_file.write(REAL_ATTESTATION_KEY)
            real_key_file.flush()
            for case_id in sanitizer.CASE_IDS[controller.SCRIPTED_CASE_COUNT : controller.REAL_PROVIDER_CASE_END]:
                event = (
                    case_record_event(
                        state,
                        case_id,
                        real_attestation=attestation,
                        mac_key_fd=real_key_file.fileno(),
                    )
                    if case_id == "REAL-01"
                    else case_record_event(state, case_id)
                )
                state = controller_step(state, event)
        self.assertEqual(state.phase, "real_provider_cleanup_pending")
        state = controller_step(
            state,
            {
                "type": "REAL_PROVIDER_PHASE_CLEANED",
                "processesStopped": True,
                "providerCredentialAbsent": True,
                "portsReleased": True,
                "outputsDiscarded": True,
            },
        )
        self.assertEqual(state.phase, "isolated_data_cases_running")
        for case_id in sanitizer.CASE_IDS[controller.REAL_PROVIDER_CASE_END : controller.ISOLATED_DATA_CASE_END]:
            state = controller_step(state, case_record_event(state, case_id))
        self.assertEqual(state.phase, "ui_probe_start_required")
        state = controller_step(
            state,
            {
                "type": "BEGIN_UI_PROBE",
                "platformRunning": True,
                "aiServicesStopped": True,
                "browserCaptureDisabled": True,
            },
        )
        self.assertEqual(state.phase, "ui_case_running")
        for case_id in sanitizer.CASE_IDS[controller.ISOLATED_DATA_CASE_END :]:
            state = controller_step(state, case_record_event(state, case_id))
        self.assertEqual(state.phase, "cleanup_pending")
        self.assertEqual(state.completed_cases, sanitizer.CASE_IDS)
        self.assertEqual(state.next_case_index, 25)
        self.assertTrue(state.scripted_phase_cleaned)
        self.assertTrue(state.real_phase_started)
        self.assertTrue(state.actual_gemini_observed)
        self.assertTrue(state.actual_media_observed)
        self.assertEqual(state.provider_attestation_hmac, attestation["providerAttestationHmac"])
        self.assertEqual(state.media_attestation_hmac, attestation["mediaAttestationHmac"])

    def test_real_case_attestation_is_domain_mac_bound_and_persisted(self) -> None:
        real_index = sanitizer.CASE_IDS.index("REAL-01")
        prior_entries = evidence_chain_fixture()[:real_index]
        state = controller.ControllerState(
            phase="real_cases_running",
            next_case_index=real_index,
            completed_cases=sanitizer.CASE_IDS[:real_index],
            evidence_hashes=tuple(str(entry["hash"]) for entry in prior_entries),
            manifest_verified=True,
            production_negative_verified=True,
            manifest_digest="sha256:" + HEX_A,
            migration_attestation_hashes=(HEX_A, HEX_B),
            scripted_phase_cleaned=True,
            real_phase_started=True,
            transition_sequence=40,
        )
        attestation = real_attestation_fixture()
        with tempfile.TemporaryFile() as key_file, tempfile.TemporaryFile() as wrong_key_file:
            key_file.write(REAL_ATTESTATION_KEY)
            wrong_key_file.write(hashlib.sha256(b"different-offline-fixture-key").digest())
            key_file.flush()
            wrong_key_file.flush()
            event = case_record_event(
                state,
                "REAL-01",
                real_attestation=attestation,
                mac_key_fd=key_file.fileno(),
            )

            for hmac_field in ("providerAttestationHmac", "mediaAttestationHmac"):
                with self.subTest(hmac_field=hmac_field):
                    tampered_attestation = {**attestation, hmac_field: HMAC_A}
                    with self.assertRaises(ValueError):
                        controller.transition(state, {**event, "realAttestation": tampered_attestation})

            with self.assertRaises(ValueError):
                controller.transition(state, {**event, "macKeyFd": wrong_key_file.fileno()})

            mismatched_evidence = passing_evidence("REAL-01")
            mismatched_entry = chain_entry(
                state.next_case_index,
                state.evidence_hashes[-1],
                mismatched_evidence,
            )
            with self.assertRaises(ValueError):
                controller.transition(
                    state,
                    {**event, "evidence": mismatched_evidence, "evidenceHash": mismatched_entry["hash"]},
                )

            for count_field, invalid_attestation in (
                ("providerCallCount", real_attestation_fixture(provider_call_count=True)),
                ("mediaByteCount", real_attestation_fixture(media_byte_count=True)),
            ):
                with self.subTest(count_field=count_field):
                    invalid_event = case_record_event(
                        state,
                        "REAL-01",
                        real_attestation=invalid_attestation,
                        mac_key_fd=key_file.fileno(),
                    )
                    with self.assertRaises(ValueError):
                        controller.transition(state, invalid_event)

            persisted = controller_step(state, event)
            self.assertEqual(persisted.provider_attestation_hmac, attestation["providerAttestationHmac"])
            self.assertEqual(persisted.media_attestation_hmac, attestation["mediaAttestationHmac"])
            self.assertEqual(controller.restore_controller_state(controller.controller_state_record(persisted)), persisted)

    def test_controller_receipt_binds_evidence_mcp_manifest_and_mac(self) -> None:
        evidence_entries = evidence_chain_fixture()
        mcp_entries = mcp_chain_fixture()
        browser_entries = browser_chain_fixture()
        attestation = real_attestation_fixture()
        manifest = manifest_fixture()
        state = controller.ControllerState(
            phase="completed",
            next_case_index=len(sanitizer.CASE_IDS),
            completed_cases=sanitizer.CASE_IDS,
            evidence_hashes=tuple(str(entry["hash"]) for entry in evidence_entries),
            manifest_verified=True,
            production_negative_verified=True,
            actual_gemini_observed=True,
            actual_media_observed=True,
            manifest_digest=controller.manifest_digest(manifest),
            consumed_permit_hashes=(HEX_A, HEX_B),
            migration_attestation_hashes=(str(mcp_entries[2]["hash"]), str(mcp_entries[3]["hash"])),
            development_target_hmac=HMAC_A,
            development_target_capability_hmac=HMAC_A,
            mcp_sequence=len(mcp_entries) - 1,
            mcp_tail_hash=str(mcp_entries[-1]["hash"]),
            scripted_phase_cleaned=True,
            real_phase_started=True,
            cleanup_vault_complete=True,
            retention_verified=True,
            transition_sequence=60,
            browser_attestation_hash=str(browser_entries[0]["hash"]),
            provider_attestation_hmac=str(attestation["providerAttestationHmac"]),
            media_attestation_hmac=str(attestation["mediaAttestationHmac"]),
        )
        key = b"controller-receipt-mac-key-value"
        with tempfile.TemporaryFile() as key_file:
            key_file.write(key)
            key_file.flush()
            receipt = controller.controller_receipt(state, key_file.fileno())
            verified = controller.verify_controller_receipt(
                receipt,
                mac_key_fd=key_file.fileno(),
                evidence_entries=evidence_entries,
                mcp_entries=mcp_entries,
                browser_entries=browser_entries,
                manifest=manifest,
            )
            self.assertTrue(verified["verified"])

            tampered_evidence = list(evidence_entries)
            tampered_evidence[0] = {**tampered_evidence[0], "hash": HEX_B}
            tampered_mcp = list(mcp_entries)
            tampered_mcp[1] = {**tampered_mcp[1], "hash": HEX_B}
            tampered_browser = [{**browser_entries[0], "hash": HEX_B}]
            browser_binding_mismatch = browser_chain_fixture()
            mismatch_payload = {**browser_binding_mismatch[0]["payload"], "resultHmac": HMAC_B}
            browser_binding_mismatch = (chain_entry(0, "0" * 64, mismatch_payload),)
            tampered_manifest = {**manifest, "harnessTree": "sha256:" + HEX_B}
            invalid_bindings = (
                {
                    "evidence_entries": evidence_entries[:-1],
                    "mcp_entries": mcp_entries,
                    "browser_entries": browser_entries,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": tampered_evidence,
                    "mcp_entries": mcp_entries,
                    "browser_entries": browser_entries,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": mcp_entries[:-1],
                    "browser_entries": browser_entries,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": tampered_mcp,
                    "browser_entries": browser_entries,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": mcp_entries,
                    "browser_entries": (),
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": mcp_entries,
                    "browser_entries": tampered_browser,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": mcp_entries,
                    "browser_entries": browser_binding_mismatch,
                    "manifest": manifest,
                },
                {
                    "evidence_entries": evidence_entries,
                    "mcp_entries": mcp_entries,
                    "browser_entries": browser_entries,
                    "manifest": tampered_manifest,
                },
            )
            for binding in invalid_bindings:
                with self.subTest(binding=tuple(len(value) if isinstance(value, (list, tuple)) else 1 for value in binding.values())):
                    with self.assertRaises(ValueError):
                        controller.verify_controller_receipt(
                            receipt,
                            mac_key_fd=key_file.fileno(),
                            **binding,
                        )
            with self.assertRaises(ValueError):
                controller.verify_controller_receipt(
                    {**receipt, "receiptMac": "hmac-sha256:" + HEX_A},
                    mac_key_fd=key_file.fileno(),
                    evidence_entries=evidence_entries,
                    mcp_entries=mcp_entries,
                    browser_entries=browser_entries,
                    manifest=manifest,
                )

    def test_harness_tree_requires_the_exact_tracked_file_set(self) -> None:
        expected_files = frozenset(
            {
                "docs/AI_PIPELINE_E2E_RUNBOOK.md",
                "scripts/ai_pipeline_e2e/__init__.py",
                "scripts/ai_pipeline_e2e/bridge_protocol.py",
                "scripts/ai_pipeline_e2e/browser_probe_runner.mjs",
                "scripts/ai_pipeline_e2e/browser_probe_source.mjs",
                "scripts/ai_pipeline_e2e/browser_session_broker.mjs",
                "scripts/ai_pipeline_e2e/cases.json",
                "scripts/ai_pipeline_e2e/controller.py",
                "scripts/ai_pipeline_e2e/development_target.mjs",
                "scripts/ai_pipeline_e2e/driver_cleanup_broker.py",
                "scripts/ai_pipeline_e2e/driver_cleanup_runtime.py",
                "scripts/ai_pipeline_e2e/live_runner.py",
                "scripts/ai_pipeline_e2e/mcp_bridge.py",
                "scripts/ai_pipeline_e2e/mcp_queries.py",
                "scripts/ai_pipeline_e2e/platform_bootstrap.mjs",
                "scripts/ai_pipeline_e2e/provider_attestation.py",
                "scripts/ai_pipeline_e2e/real_pipeline_driver.mjs",
                "scripts/ai_pipeline_e2e/repository_gate.py",
                "scripts/ai_pipeline_e2e/sanitizer.py",
                "scripts/ai_pipeline_e2e/secure_state.py",
                "scripts/ai_pipeline_e2e/service_bootstrap.py",
                "scripts/ai_pipeline_e2e/tests/test_bridge_protocol.py",
                "scripts/ai_pipeline_e2e/tests/test_browser_probe_runner.py",
                "scripts/ai_pipeline_e2e/tests/test_browser_probe_source.py",
                "scripts/ai_pipeline_e2e/tests/test_browser_session_broker.py",
                "scripts/ai_pipeline_e2e/tests/test_development_target.py",
                "scripts/ai_pipeline_e2e/tests/test_driver_cleanup_broker.py",
                "scripts/ai_pipeline_e2e/tests/test_driver_cleanup_runtime.py",
                "scripts/ai_pipeline_e2e/tests/test_harness.py",
                "scripts/ai_pipeline_e2e/tests/test_live_runner.py",
                "scripts/ai_pipeline_e2e/tests/test_mcp_architect_regressions.py",
                "scripts/ai_pipeline_e2e/tests/test_mcp_bridge.py",
                "scripts/ai_pipeline_e2e/tests/test_mcp_queries.py",
                "scripts/ai_pipeline_e2e/tests/test_provider_attestation.py",
                "scripts/ai_pipeline_e2e/tests/test_real_pipeline_driver.py",
                "scripts/ai_pipeline_e2e/tests/test_repository_gate.py",
            }
        )
        self.assertEqual(controller.REQUIRED_HARNESS_FILES, expected_files)
        entries = {name: name.encode("ascii") for name in expected_files}
        digest = controller.hash_harness_tree(entries)
        self.assertRegex(digest, r"^[a-f0-9]{64}$")
        missing = dict(entries)
        missing.pop("scripts/ai_pipeline_e2e/cases.json")
        with self.assertRaises(ValueError):
            controller.hash_harness_tree(missing)
        with self.assertRaises(ValueError):
            controller.hash_harness_tree({**entries, "__pycache__/unsafe.pyc": b"x"})

    def test_manifest_requires_four_clean_exact_branches_and_acceptance_pins(self) -> None:
        repositories = {
            name: {
                "branch": controller.EXPECTED_BRANCHES[name],
                "head": str(index + 1) * 40,
                "tree": str(index + 5) * 40,
                "clean": True,
                "upstreamEqual": True,
                "lockfileSha256": HEX_A,
                "detachedWorktree": {
                    "head": str(index + 1) * 40,
                    "tree": str(index + 5) * 40,
                    "clean": True,
                    "detached": True,
                    "primaryWorktreeUntouched": True,
                },
            }
            for index, name in enumerate(controller.REPOSITORY_NAMES)
        }
        manifest = controller.create_hash_manifest(
            repositories=repositories,
            migrations={version: HEX_A for version in controller.MIGRATION_PIN_VERSIONS},
            migration_ledger=HEX_A,
            harness_tree=HEX_A,
            sanitizer=HEX_A,
            case_ledger=HEX_A,
            acceptance={name: HEX_B for name in controller.ACCEPTANCE_NAMES},
        )
        self.assertTrue(controller.verify_hash_manifest(manifest, manifest)["matches"])
        dirty = {name: dict(pin) for name, pin in repositories.items()}
        dirty["platform"]["clean"] = False
        with self.assertRaises(ValueError):
            controller.create_hash_manifest(
                repositories=dirty,
                migrations={version: HEX_A for version in controller.MIGRATION_PIN_VERSIONS},
                migration_ledger=HEX_A,
                harness_tree=HEX_A,
                sanitizer=HEX_A,
                case_ledger=HEX_A,
                acceptance={name: HEX_B for name in controller.ACCEPTANCE_NAMES},
            )

    def test_adapter_sanitizers_accept_only_boolean_count_hmac(self) -> None:
        browser = {
            "reportSections": 6,
            "confirmedRendered": True,
            "notConfirmedRendered": True,
            "timestampSeekVerified": True,
            "refreshStable": True,
            "capturedArtifacts": 0,
            "resultHmac": HMAC_A,
        }
        self.assertEqual(controller.sanitize_browser_adapter_result(browser), browser)
        with self.assertRaises((TypeError, ValueError)):
            controller.sanitize_browser_adapter_result({**browser, "content": "not allowed"})
        target = {
            "operation": "target",
            "developmentVerified": True,
            "productionNegativeVerified": True,
            "productionActions": 0,
            "projectHmac": HMAC_A,
        }
        self.assertEqual(controller.sanitize_mcp_adapter_result(target), target)

    def test_child_environment_is_rebuilt_without_secret_or_proxy_inheritance(self) -> None:
        clean = controller.build_allowlisted_environment(
            {
                "PATH": "trusted-tool-path",
                "HOME": "/untrusted/home",
                "TMPDIR": "/untrusted/tmp",
                "LANG": "C.UTF-8",
                "GEMINI_API_KEY": "must-not-copy",
                "SUPABASE_SERVICE_ROLE_KEY": "must-not-copy",
                "HTTPS_PROXY": "must-not-copy",
                "NODE_OPTIONS": "must-not-copy",
                "PYTHONPATH": "must-not-copy",
            }
        )
        self.assertEqual(clean["PATH"], os.defpath)
        self.assertEqual(clean["LANG"], "C.UTF-8")
        for forbidden in (
            "HOME",
            "TMPDIR",
            "GEMINI_API_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "HTTPS_PROXY",
            "NODE_OPTIONS",
            "PYTHONPATH",
        ):
            self.assertNotIn(forbidden, clean)


class ServiceBootstrapTests(unittest.TestCase):
    class BootstrapRejected(Exception):
        pass

    @classmethod
    def bootstrap_namespace(cls) -> dict[str, object]:
        definitions = service_bootstrap.EXPLICIT_SETTINGS_BOOTSTRAP.split("def main():", 1)[0]
        namespace: dict[str, object] = {}
        exec(compile(definitions, "<protected-bootstrap-definitions>", "exec"), namespace)

        def reject() -> None:
            raise cls.BootstrapRejected("rejected")

        namespace["fail"] = reject
        return namespace

    @staticmethod
    def cleanup_channel(events: list[tuple[object, ...]]):
        acknowledgement = b'{"ok":true}'
        replies = bytearray(len(acknowledgement).to_bytes(4, "big") + acknowledgement)

        class CleanupChannel:
            def sendall(self, encoded: bytes) -> None:
                size = int.from_bytes(encoded[:4], "big")
                value = json.loads(encoded[4:])
                if size != len(encoded) - 4:
                    raise AssertionError("bad_test_frame")
                events.append(("cleanup", value["kind"], value["locator"]))
                replies.extend(len(acknowledgement).to_bytes(4, "big") + acknowledgement)

            def recv(self, size: int) -> bytes:
                result = bytes(replies[:size])
                del replies[:size]
                return result

        return CleanupChannel()

    def test_real_bootstrap_is_explicit_and_never_uses_default_loaders(self) -> None:
        source = service_bootstrap.EXPLICIT_SETTINGS_BOOTSTRAP
        compile(source, "<protected-bootstrap>", "exec")
        self.assertIn("Settings(", source)
        self.assertIn("create_app(client=client, settings=settings)", source)
        self.assertIn("class AttestedClient", source)
        self.assertIn("class CanonicalOnlyApp", source)
        self.assertIn('self._emit("files_upload"', source)
        self.assertIn("access_log=False", source)
        self.assertIn("log_config=None", source)
        self.assertNotIn("load_settings", source)
        self.assertNotIn("load_dotenv", source)
        self.assertNotIn("create_demo_app", source)

    def test_provider_file_cleanup_plan_is_acked_before_exact_named_upload_and_complete_follows_delete(self) -> None:
        namespace = self.bootstrap_namespace()
        key = hashlib.sha256(b"offline-provider-file-plan-key").digest()
        payload = b"offline-provider-file-media"
        expected_media_hmac = "hmac-sha256:" + hmac.new(
            key,
            b"acttub-protected-media-content.v1\0" + payload,
            hashlib.sha256,
        ).hexdigest()
        expected_locator = "files/" + hmac.new(
            key,
            b"acttub-protected-provider-file-name.v1\0" + expected_media_hmac.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()[:40]
        events: list[tuple[object, ...]] = []

        class Response:
            name = expected_locator

        class Delegate:
            def upload(self, **kwargs):
                events.append(("delegate", "upload", kwargs))
                return Response()

            def delete(self, **kwargs):
                events.append(("delegate", "delete", kwargs))
                return object()

        def emit(operation, *_args):
            events.append(("emit", operation))

        with tempfile.TemporaryDirectory(prefix="provider-file-plan-") as temporary:
            media = Path(temporary) / "media.bin"
            media.write_bytes(payload)
            files = namespace["AttestedFiles"](
                Delegate(),
                emit,
                self.cleanup_channel(events),
                key,
                expected_media_hmac,
            )
            response = files.upload(file=str(media))
            self.assertEqual(response.name, expected_locator)
            files.delete(name=response.name)

        self.assertRegex(expected_locator, r"^files/[a-f0-9]{40}$")
        self.assertEqual(events[0], ("cleanup", "plan", expected_locator))
        self.assertEqual(
            events[1],
            (
                "delegate",
                "upload",
                {"file": str(media), "config": {"name": expected_locator}},
            ),
        )
        self.assertEqual(events[2], ("emit", "files_upload"))
        self.assertEqual(events[3], ("delegate", "delete", {"name": expected_locator}))
        self.assertEqual(events[4], ("cleanup", "complete", expected_locator))
        self.assertEqual(events[5], ("emit", "files_delete"))

    def test_provider_file_upload_rejects_positional_or_caller_config_before_delegate(self) -> None:
        namespace = self.bootstrap_namespace()
        key = hashlib.sha256(b"offline-provider-file-argument-key").digest()
        payload = b"offline-provider-file-argument-media"
        expected_media_hmac = "hmac-sha256:" + hmac.new(
            key,
            b"acttub-protected-media-content.v1\0" + payload,
            hashlib.sha256,
        ).hexdigest()

        class Delegate:
            def upload(self, **_kwargs):
                raise AssertionError("delegate_must_not_run")

        with tempfile.TemporaryDirectory(prefix="provider-file-arguments-") as temporary:
            media = Path(temporary) / "media.bin"
            media.write_bytes(payload)
            for label, invoke in (
                ("positional", lambda files: files.upload(str(media))),
                ("config", lambda files: files.upload(file=str(media), config={})),
                ("unknown", lambda files: files.upload(file=str(media), unknown=True)),
            ):
                with self.subTest(label=label):
                    events: list[tuple[object, ...]] = []
                    files = namespace["AttestedFiles"](
                        Delegate(),
                        lambda *_args: events.append(("emit",)),
                        self.cleanup_channel(events),
                        key,
                        expected_media_hmac,
                    )
                    with self.assertRaises(self.BootstrapRejected):
                        invoke(files)
                    self.assertEqual(events, [])

    def test_provider_file_response_name_mismatch_fails_after_durable_plan_without_emit(self) -> None:
        namespace = self.bootstrap_namespace()
        key = hashlib.sha256(b"offline-provider-file-mismatch-key").digest()
        payload = b"offline-provider-file-mismatch-media"
        expected_media_hmac = "hmac-sha256:" + hmac.new(
            key,
            b"acttub-protected-media-content.v1\0" + payload,
            hashlib.sha256,
        ).hexdigest()
        expected_locator = namespace["provider_file_locator"](key, expected_media_hmac)
        events: list[tuple[object, ...]] = []

        class Delegate:
            def upload(self, **kwargs):
                events.append(("delegate", kwargs))
                return type("Response", (), {"name": "files/" + "f" * 40})()

        with tempfile.TemporaryDirectory(prefix="provider-file-mismatch-") as temporary:
            media = Path(temporary) / "media.bin"
            media.write_bytes(payload)
            files = namespace["AttestedFiles"](
                Delegate(),
                lambda *_args: events.append(("emit",)),
                self.cleanup_channel(events),
                key,
                expected_media_hmac,
            )
            with self.assertRaises(self.BootstrapRejected):
                files.upload(file=str(media))

        self.assertEqual(events[0], ("cleanup", "plan", expected_locator))
        self.assertEqual(events[1][0], "delegate")
        self.assertEqual(events[1][1]["config"], {"name": expected_locator})
        self.assertNotIn(("emit",), events)

    def test_provider_event_is_one_pipe_buf_bounded_write_and_partial_or_oversize_fails(self) -> None:
        namespace = self.bootstrap_namespace()
        client_type = namespace["AttestedClient"]
        key = hashlib.sha256(b"offline-provider-event-atomic-key").digest()

        class FakeOs:
            def __init__(self, *, partial: bool = False) -> None:
                self.partial = partial
                self.calls: list[tuple[int, bytes]] = []

            def write(self, fd: int, encoded: bytes) -> int:
                self.calls.append((fd, encoded))
                return len(encoded) - 1 if self.partial else len(encoded)

        def client():
            instance = object.__new__(client_type)
            instance._service = "summary"
            instance._event_fd = 91
            instance._key = key
            instance._ordinal = 0
            return instance

        normal_os = FakeOs()
        namespace["os"] = normal_os
        client()._emit("files_upload", (), object(), HMAC_A, 123)
        self.assertEqual(len(normal_os.calls), 1)
        self.assertLessEqual(len(normal_os.calls[0][1]), namespace["select"].PIPE_BUF)
        self.assertTrue(normal_os.calls[0][1].endswith(b"\n"))

        partial_os = FakeOs(partial=True)
        namespace["os"] = partial_os
        with self.assertRaises(self.BootstrapRejected):
            client()._emit("files_upload", (), object(), HMAC_A, 123)
        self.assertEqual(len(partial_os.calls), 1)

        oversized_os = FakeOs()
        namespace["os"] = oversized_os
        with self.assertRaises(self.BootstrapRejected):
            client()._emit("x" * (namespace["select"].PIPE_BUF + 1), (), object(), None, 0)
        self.assertEqual(oversized_os.calls, [])

    def test_real_plan_contains_only_fd_alias_and_discards_all_output(self) -> None:
        read_fd, write_fd = os.pipe()
        parent_socket, child_socket = socket.socketpair()
        try:
            with tempfile.TemporaryFile() as settings_file:
                settings_file.write(b'{"not":"executed"}')
                settings_file.flush()
                plan = service_bootstrap.build_real_service_plan(
                    "summary",
                    settings_fd=settings_file.fileno(),
                    port=43101,
                    attestation_fd=write_fd,
                    cleanup_fd=child_socket.fileno(),
                )
                self.assertEqual(plan.mode, "real")
                self.assertEqual(plan.output_disposition, "discard")
                self.assertFalse(plan.access_logs)
                self.assertEqual(plan.pass_fds, (write_fd, child_socket.fileno()))
                command = " ".join(plan.command)
                self.assertNotIn("not executed", command)
                self.assertNotIn("GEMINI_API_KEY=", command)
        finally:
            os.close(read_fd)
            os.close(write_fd)
            parent_socket.close()
            child_socket.close()

    def test_scripted_config_is_fd_only_request_digest_bound_and_not_started(self) -> None:
        body = b'{"safe":"request"}'
        config = {
            "schemaVersion": "protected-scripted-service.v1",
            "service": "agent",
            "exchanges": [
                {
                    "method": "POST",
                    "path": service_bootstrap.SERVICE_PATHS["agent"],
                    "requestSha256": hashlib.sha256(body).hexdigest(),
                    "status": 200,
                    "response": {"safe": True},
                }
            ],
        }
        with tempfile.TemporaryFile() as script_file:
            script_file.write(json.dumps(config).encode("utf-8"))
            script_file.flush()
            parsed = service_bootstrap.parse_scripted_config(script_file.fileno(), "agent")
            self.assertEqual(len(parsed), 1)
            plan = service_bootstrap.build_scripted_service_plan("agent", script_fd=script_file.fileno(), port=43102)
            self.assertEqual(plan.mode, "scripted")

    def test_spawn_contract_rejects_secret_environment_and_uses_fixed_stdin_fd_alias(self) -> None:
        read_fd, write_fd = os.pipe()
        parent_socket, child_socket = socket.socketpair()
        try:
            with tempfile.TemporaryFile() as settings_file:
                plan = service_bootstrap.build_real_service_plan(
                    "report",
                    settings_fd=settings_file.fileno(),
                    port=43103,
                    attestation_fd=write_fd,
                    cleanup_fd=child_socket.fileno(),
                )
                self.assertEqual(plan.pass_fds, (write_fd, child_socket.fileno()))
                with self.assertRaises((TypeError, ValueError)):
                    service_bootstrap.subprocess_options(plan, {"GEMINI_API_KEY": "forbidden"})
                clean = controller.build_allowlisted_environment({"PATH": "trusted-tool-path"})
                options = service_bootstrap.subprocess_options(plan, clean)
                self.assertEqual(options["stdin"], settings_file.fileno())
                self.assertEqual(options["stdout"], service_bootstrap.subprocess.DEVNULL)
                self.assertEqual(options["stderr"], service_bootstrap.subprocess.DEVNULL)
                self.assertEqual(options["pass_fds"], (write_fd, child_socket.fileno()))
        finally:
            os.close(read_fd)
            os.close(write_fd)
            parent_socket.close()
            child_socket.close()

    def test_platform_bootstrap_contract_exists_without_launching(self) -> None:
        self.assertTrue(hasattr(service_bootstrap, "build_platform_plan"))
        platform_source = Path(service_bootstrap.__file__).with_name("platform_bootstrap.mjs").read_text(encoding="utf-8")
        self.assertIn("fs.readSync(0", platform_source)
        self.assertIn("MAX_SETTINGS_BYTES + 1", platform_source)
        self.assertNotIn("readFileSync(0", platform_source)
        self.assertIn('process.env.NEXT_TELEMETRY_DISABLED = "1"', platform_source)
        self.assertNotIn("dotenv", platform_source)

    def test_platform_bootstrap_rejects_oversized_stdin_before_next_import(self) -> None:
        platform_source = Path(service_bootstrap.__file__).with_name("platform_bootstrap.mjs").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory(prefix="protected-platform-bootstrap-") as temporary:
            root = Path(temporary)
            bootstrap = root / "platform_bootstrap.mjs"
            bootstrap.write_text(platform_source, encoding="utf-8")
            fake_next = root / "node_modules" / "next"
            fake_module = fake_next / "dist" / "bin" / "next.mjs"
            fake_module.parent.mkdir(parents=True)
            (fake_next / "package.json").write_text(
                json.dumps(
                    {
                        "name": "next",
                        "type": "module",
                        "exports": {"./dist/bin/next": "./dist/bin/next.mjs"},
                    }
                ),
                encoding="utf-8",
            )
            fake_module.write_text(
                'import fs from "node:fs"; fs.writeFileSync(process.env.NEXT_IMPORT_SENTINEL, "imported");',
                encoding="utf-8",
            )
            sentinel = root / "next-imported"
            with tempfile.TemporaryFile() as settings_file:
                plan = service_bootstrap.build_platform_plan("build", settings_fd=settings_file.fileno())
            completed = service_bootstrap.subprocess.run(
                (plan.command[0], str(bootstrap), "build"),
                input=b"x" * (service_bootstrap.MAX_SETTINGS_BYTES + 1),
                stdout=service_bootstrap.subprocess.PIPE,
                stderr=service_bootstrap.subprocess.PIPE,
                cwd=root,
                env={"PATH": os.defpath, "NEXT_IMPORT_SENTINEL": str(sentinel)},
                check=False,
                timeout=5,
            )
            self.assertEqual(completed.returncode, 70)
            self.assertEqual(completed.stdout, b"")
            self.assertEqual(completed.stderr, b"")
            self.assertFalse(sentinel.exists())


class SourceHygieneTests(unittest.TestCase):
    def test_runbook_and_harness_contain_no_machine_specific_path_or_generated_bytecode(self) -> None:
        root = Path(__file__).resolve().parents[3]
        runbook = (root / "docs" / "AI_PIPELINE_E2E_RUNBOOK.md").read_text(encoding="utf-8")
        self.assertNotIn("/Users/", runbook)
        self.assertNotIn(".mp4", runbook)
        self.assertNotIn("GEMINI_API_KEY=", runbook)
        harness_root = root / "scripts" / "ai_pipeline_e2e"
        self.assertFalse(any(path.name == "__pycache__" for path in harness_root.rglob("__pycache__")))


if __name__ == "__main__":
    unittest.main()
