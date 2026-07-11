"""Deterministic protected-run controller and offline gate contracts."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import stat
from dataclasses import dataclass, replace
from pathlib import PurePosixPath
from typing import Any, Callable, Mapping

try:
    from .sanitizer import CASE_IDS, canonical_json, require_sha256, sanitize_evidence
except ImportError:  # pragma: no cover - direct script import fallback
    from sanitizer import CASE_IDS, canonical_json, require_sha256, sanitize_evidence

REPOSITORY_NAMES = ("platform", "summary", "agent", "report")
MIGRATION_PIN_VERSIONS = ("004", "009", "010")
ACCEPTANCE_NAMES = ("task105", "task6")
EXPECTED_BRANCHES = {
    "platform": "feature/ai-pipeline-integration-20260711",
    "summary": "feature/platform-ai-pipeline-20260711",
    "agent": "feature/platform-ai-pipeline-20260711",
    "report": "feature/platform-ai-pipeline-20260711",
}
MIGRATION_PRE_LEDGER = (
    "001_acttub_slice1_schema",
    "002_remove_legacy_practice_generation",
    "003_atomic_dialogue_turn_append",
    "004_ai_pipeline_data_plane",
    "005_close_ai_table_select_privilege_gaps",
    "006_pipeline_security_advisor_hardening",
    "007_ai_pipeline_unknown_turn_count",
    "008_ai_pipeline_session_delete_upload_intent_cleanup",
)
MIGRATION_POST_LEDGER = MIGRATION_PRE_LEDGER + (
    "009_ai_pipeline_contract_hardening",
    "010_ai_pipeline_optional_note",
)
MIGRATION_AFTER_009_LEDGER = MIGRATION_POST_LEDGER[:-1]
_HEAD = re.compile(r"^[a-f0-9]{40}$")
_HMAC = re.compile(r"^hmac-sha256:[a-f0-9]{64}$")
_HASH = re.compile(r"^[a-f0-9]{64}$")
_ENV_ALLOWLIST = frozenset({"LANG", "LC_ALL", "TZ"})
_GENESIS_HASH = "0" * 64
SCRIPTED_CASE_COUNT = CASE_IDS.index("REAL-01")
REAL_PROVIDER_CASE_END = CASE_IDS.index("RLS-01")
ISOLATED_DATA_CASE_END = CASE_IDS.index("UI-01")
EXPECTED_CASE_MODES = {
    case_id: (
        "scripted"
        if index < SCRIPTED_CASE_COUNT or case_id in {"RLS-01", "DELETE-01"}
        else "real"
    )
    for index, case_id in enumerate(CASE_IDS)
}
REQUIRED_HARNESS_FILES = frozenset(
    {
        "docs/AI_PIPELINE_E2E_RUNBOOK.md",
        "scripts/ai_pipeline_e2e/__init__.py",
        "scripts/ai_pipeline_e2e/bridge_protocol.py",
        "scripts/ai_pipeline_e2e/browser_probe_source.mjs",
        "scripts/ai_pipeline_e2e/browser_session_broker.mjs",
        "scripts/ai_pipeline_e2e/cases.json",
        "scripts/ai_pipeline_e2e/controller.py",
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
        "scripts/ai_pipeline_e2e/tests/test_browser_probe_source.py",
        "scripts/ai_pipeline_e2e/tests/test_browser_session_broker.py",
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


def _exact_mapping(value: Any, keys: set[str] | frozenset[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != set(keys):
        raise TypeError(f"{label}_keys_invalid")
    return value


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_harness_tree(entries: Mapping[str, bytes]) -> str:
    """Hash relative tracked names and bytes without persisting an absolute path."""

    if not isinstance(entries, Mapping) or not entries:
        raise TypeError("harness_entries_invalid")
    if set(entries) != REQUIRED_HARNESS_FILES:
        raise ValueError("harness_file_set_invalid")
    normalized: list[dict[str, str]] = []
    for relative_name, content in entries.items():
        if not isinstance(relative_name, str) or not isinstance(content, bytes):
            raise TypeError("harness_entry_invalid")
        posix = PurePosixPath(relative_name)
        if posix.is_absolute() or not posix.parts or any(part in {"", ".", ".."} for part in posix.parts):
            raise ValueError("harness_relative_name_invalid")
        if "\\" in relative_name or str(posix) != relative_name:
            raise ValueError("harness_relative_name_invalid")
        normalized.append({"name": relative_name, "digest": _sha256(content)})
    normalized.sort(key=lambda item: item["name"])
    return _sha256(canonical_json(normalized).encode("ascii"))


def create_hash_manifest(
    *,
    repositories: Mapping[str, Mapping[str, Any]],
    migrations: Mapping[str, str],
    migration_ledger: str,
    harness_tree: str,
    sanitizer: str,
    case_ledger: str,
    acceptance: Mapping[str, str],
) -> dict[str, Any]:
    _exact_mapping(repositories, set(REPOSITORY_NAMES), "manifest_repositories")
    _exact_mapping(migrations, set(MIGRATION_PIN_VERSIONS), "manifest_migrations")
    _exact_mapping(acceptance, set(ACCEPTANCE_NAMES), "manifest_acceptance")
    normalized_repositories: dict[str, Any] = {}
    for name in REPOSITORY_NAMES:
        pin = _exact_mapping(
            repositories[name],
            {
                "branch",
                "head",
                "tree",
                "clean",
                "upstreamEqual",
                "lockfileSha256",
                "detachedWorktree",
            },
            f"repository_{name}",
        )
        detached = _exact_mapping(
            pin["detachedWorktree"],
            {"head", "tree", "clean", "detached", "primaryWorktreeUntouched"},
            f"repository_{name}_detached_worktree",
        )
        if (
            pin["branch"] != EXPECTED_BRANCHES[name]
            or not isinstance(pin["head"], str)
            or _HEAD.fullmatch(pin["head"]) is None
            or not isinstance(pin["tree"], str)
            or _HEAD.fullmatch(pin["tree"]) is None
            or detached["head"] != pin["head"]
            or detached["tree"] != pin["tree"]
        ):
            raise ValueError(f"repository_{name}_pin_invalid")
        if (
            pin["clean"] is not True
            or pin["upstreamEqual"] is not True
            or detached["clean"] is not True
            or detached["detached"] is not True
            or detached["primaryWorktreeUntouched"] is not True
        ):
            raise ValueError(f"repository_{name}_not_clean")
        normalized_repositories[name] = {
            "branch": pin["branch"],
            "head": pin["head"],
            "tree": pin["tree"],
            "clean": True,
            "upstreamEqual": True,
            "lockfileSha256": f"sha256:{require_sha256(pin['lockfileSha256'], f'repository_{name}_lockfile')}",
            "detachedWorktree": {
                "head": detached["head"],
                "tree": detached["tree"],
                "clean": True,
                "detached": True,
                "primaryWorktreeUntouched": True,
            },
        }
    normalized_migrations = {
        version: f"sha256:{require_sha256(migrations[version], f'migration_{version}')}"
        for version in MIGRATION_PIN_VERSIONS
    }
    normalized_acceptance = {
        name: f"sha256:{require_sha256(acceptance[name], f'acceptance_{name}')}" for name in ACCEPTANCE_NAMES
    }
    return {
        "schemaVersion": "protected-e2e-pin.v1",
        "repositories": normalized_repositories,
        "migrations": normalized_migrations,
        "migrationLedger": f"sha256:{require_sha256(migration_ledger, 'migration_ledger')}",
        "harnessTree": f"sha256:{require_sha256(harness_tree, 'harness_tree')}",
        "sanitizer": f"sha256:{require_sha256(sanitizer, 'sanitizer')}",
        "caseLedger": f"sha256:{require_sha256(case_ledger, 'case_ledger')}",
        "acceptance": normalized_acceptance,
    }


def _normalize_manifest(value: Any) -> dict[str, Any]:
    manifest = _exact_mapping(
        value,
        {
            "schemaVersion",
            "repositories",
            "migrations",
            "migrationLedger",
            "harnessTree",
            "sanitizer",
            "caseLedger",
            "acceptance",
        },
        "manifest",
    )
    if manifest["schemaVersion"] != "protected-e2e-pin.v1":
        raise ValueError("manifest_schema_invalid")
    return create_hash_manifest(
        repositories=manifest["repositories"],
        migrations=manifest["migrations"],
        migration_ledger=manifest["migrationLedger"],
        harness_tree=manifest["harnessTree"],
        sanitizer=manifest["sanitizer"],
        case_ledger=manifest["caseLedger"],
        acceptance=manifest["acceptance"],
    )


def manifest_digest(value: Any) -> str:
    return "sha256:" + _sha256(canonical_json(_normalize_manifest(value)).encode("ascii"))


def verify_hash_manifest(actual: Any, pinned: Any) -> dict[str, Any]:
    actual_digest = manifest_digest(actual)
    if not hmac.compare_digest(actual_digest, manifest_digest(pinned)):
        raise ValueError("hash_manifest_mismatch")
    return {"matches": True, "digest": actual_digest}


def assert_development_target(metadata: Any, mcp_chain_entries: Any) -> dict[str, Any]:
    item = _exact_mapping(
        metadata,
        {
            "source",
            "environment",
            "expectedProjectHmac",
            "urlDerivedProjectHmac",
            "inventoryProjectHmac",
            "productionProjectHmac",
            "inventoryProjectCount",
            "deniedOtherProjectCount",
            "productionActionCount",
            "mcpAttestationHash",
        },
        "development_target",
    )
    for key in (
        "expectedProjectHmac",
        "urlDerivedProjectHmac",
        "inventoryProjectHmac",
        "productionProjectHmac",
    ):
        if not isinstance(item[key], str) or _HMAC.fullmatch(item[key]) is None:
            raise ValueError("development_target_hmac_invalid")
    if not isinstance(mcp_chain_entries, (tuple, list)) or not mcp_chain_entries:
        raise ValueError("development_target_mcp_chain_missing")
    latest = mcp_chain_entries[-1]
    if (
        not isinstance(latest, Mapping)
        or latest.get("hash") != item["mcpAttestationHash"]
        or not isinstance(latest.get("payload"), Mapping)
        or latest["payload"].get("operation") != "list_projects"
        or latest["payload"].get("targetHmac") != item["inventoryProjectHmac"]
        or latest["payload"].get("success") is not True
        or latest["payload"].get("productionAction") is not False
    ):
        raise ValueError("development_target_mcp_chain_mismatch")
    if (
        item["source"] != "supabase_mcp"
        or item["environment"] != "development"
        or type(item["inventoryProjectCount"]) is not int
        or item["inventoryProjectCount"] < 1
        or type(item["deniedOtherProjectCount"]) is not int
        or item["deniedOtherProjectCount"] != item["inventoryProjectCount"] - 1
        or type(item["productionActionCount"]) is not int
        or item["productionActionCount"] != 0
        or not hmac.compare_digest(item["expectedProjectHmac"], item["urlDerivedProjectHmac"])
        or not hmac.compare_digest(item["urlDerivedProjectHmac"], item["inventoryProjectHmac"])
        or hmac.compare_digest(item["inventoryProjectHmac"], item["productionProjectHmac"])
    ):
        raise ValueError("development_target_not_proven")
    return {
        "developmentVerified": True,
        "productionNegativeVerified": True,
        "productionActionCount": 0,
        "mcpAttestationHash": item["mcpAttestationHash"],
        "mcpSequence": latest["sequence"],
        "targetHmac": item["inventoryProjectHmac"],
    }


def _validate_mcp_entry(
    entry: Any,
    *,
    sequence: int,
    previous_hash: str,
    operation: str,
    postcondition_hash: str,
    target_hmac: str,
    permit_hash: str | None = None,
    expected_success: bool = True,
    expected_safe_code: str | None = None,
) -> dict[str, Any]:
    item = _exact_mapping(entry, {"sequence", "previousHash", "payload", "hash"}, "mcp_chain_entry")
    payload = _exact_mapping(
        item["payload"],
        {
            "schemaVersion",
            "operation",
            "targetHmac",
            "permitHash",
            "requestHash",
            "responseHmac",
            "preconditionHash",
            "postconditionHash",
            "success",
            "schemaValid",
            "developmentMatch",
            "productionAction",
            "safeCode",
        },
        "mcp_chain_payload",
    )
    if (
        payload["schemaVersion"] != "protected-mcp-attestation.v1"
        or payload["operation"] != operation
        or payload["targetHmac"] != target_hmac
        or payload["permitHash"] != (None if permit_hash is None else "sha256:" + require_sha256(permit_hash, "mcp_permit_hash"))
        or not isinstance(payload["requestHash"], str)
        or not isinstance(payload["responseHmac"], str)
        or _HMAC.fullmatch(payload["responseHmac"]) is None
        or not isinstance(payload["preconditionHash"], str)
        or _HMAC.fullmatch(payload["preconditionHash"]) is None
        or payload["postconditionHash"] != postcondition_hash
        or type(payload["success"]) is not bool
        or payload["success"] is not expected_success
        or payload["schemaValid"] is not True
        or payload["developmentMatch"] is not True
        or payload["productionAction"] is not False
        or payload["safeCode"] != expected_safe_code
    ):
        raise ValueError("mcp_chain_payload_mismatch")
    require_sha256(payload["requestHash"], "mcp_request_hash")
    core = {"sequence": sequence, "previousHash": previous_hash, "payload": dict(payload)}
    expected_hash = _sha256(canonical_json(core).encode("ascii"))
    if item["sequence"] != sequence or item["previousHash"] != previous_hash or item["hash"] != expected_hash:
        raise ValueError("mcp_chain_entry_mismatch")
    return {**core, "hash": expected_hash}


def verify_evidence_chain(entries: Any) -> dict[str, Any]:
    if not isinstance(entries, (list, tuple)) or len(entries) != len(CASE_IDS):
        raise ValueError("evidence_chain_count_invalid")
    previous = _GENESIS_HASH
    for sequence, entry in enumerate(entries):
        item = _exact_mapping(entry, {"sequence", "previousHash", "payload", "hash"}, "evidence_chain_entry")
        payload = sanitize_evidence(item["payload"])
        expected_mode = EXPECTED_CASE_MODES[CASE_IDS[sequence]]
        if payload["caseId"] != CASE_IDS[sequence] or payload["mode"] != expected_mode or payload["status"] != "pass":
            raise ValueError("evidence_chain_case_invalid")
        core = {"sequence": sequence, "previousHash": previous, "payload": payload}
        expected_hash = _sha256(canonical_json(core).encode("ascii"))
        if item["sequence"] != sequence or item["previousHash"] != previous or item["hash"] != expected_hash:
            raise ValueError("evidence_chain_hash_invalid")
        previous = expected_hash
    return {"entryCount": len(entries), "tailHash": previous, "verified": True}


def verify_mcp_chain(entries: Any) -> dict[str, Any]:
    if not isinstance(entries, (list, tuple)) or not 8 <= len(entries) <= 20:
        raise ValueError("mcp_chain_count_invalid")
    previous = _GENESIS_HASH
    target_hmac: str | None = None
    payloads: list[dict[str, Any]] = []
    for sequence, entry in enumerate(entries):
        item = _exact_mapping(entry, {"sequence", "previousHash", "payload", "hash"}, "mcp_chain_entry")
        payload = _exact_mapping(
            item["payload"],
            {
                "schemaVersion",
                "operation",
                "targetHmac",
                "permitHash",
                "requestHash",
                "responseHmac",
                "preconditionHash",
                "postconditionHash",
                "success",
                "schemaValid",
                "developmentMatch",
                "productionAction",
                "safeCode",
            },
            "mcp_chain_payload",
        )
        if (
            payload["schemaVersion"] != "protected-mcp-attestation.v1"
            or payload["operation"] not in {"list_projects", "inspect_migrations", "apply_migration", "sql_check"}
            or not isinstance(payload["targetHmac"], str)
            or _HMAC.fullmatch(payload["targetHmac"]) is None
            or not isinstance(payload["responseHmac"], str)
            or _HMAC.fullmatch(payload["responseHmac"]) is None
            or not isinstance(payload["preconditionHash"], str)
            or _HMAC.fullmatch(payload["preconditionHash"]) is None
            or not isinstance(payload["postconditionHash"], str)
            or _HMAC.fullmatch(payload["postconditionHash"]) is None
            or type(payload["success"]) is not bool
            or payload["schemaValid"] is not True
            or payload["developmentMatch"] is not True
            or payload["productionAction"] is not False
        ):
            raise ValueError("mcp_chain_payload_invalid")
        if target_hmac is None:
            target_hmac = payload["targetHmac"]
        elif not hmac.compare_digest(payload["targetHmac"], target_hmac):
            raise ValueError("mcp_chain_target_changed")
        require_sha256(payload["requestHash"], "mcp_request_hash")
        if payload["operation"] == "apply_migration":
            if payload["permitHash"] is None:
                raise ValueError("mcp_chain_mutation_permit_missing")
            require_sha256(payload["permitHash"], "mcp_permit_hash")
        elif payload["permitHash"] is not None:
            raise ValueError("mcp_chain_read_only_permit_forbidden")
        if payload["success"]:
            if payload["safeCode"] is not None:
                raise ValueError("mcp_chain_success_code_invalid")
        elif payload["safeCode"] not in {"MCP_OPERATION_FAILED", "MCP_ACTION_UNKNOWN"}:
            raise ValueError("mcp_chain_failure_code_invalid")
        core = {"sequence": sequence, "previousHash": previous, "payload": dict(payload)}
        expected_hash = _sha256(canonical_json(core).encode("ascii"))
        if item["sequence"] != sequence or item["previousHash"] != previous or item["hash"] != expected_hash:
            raise ValueError("mcp_chain_entry_mismatch")
        previous = expected_hash
        payloads.append(dict(payload))
    if (
        payloads[0]["operation"] != "list_projects"
        or payloads[0]["success"] is not True
        or payloads[1]["operation"] != "inspect_migrations"
        or payloads[1]["success"] is not True
        or payloads[-1]["operation"] != "inspect_migrations"
        or payloads[-1]["success"] is not True
    ):
        raise ValueError("mcp_chain_operation_order_invalid")
    cursor = 2
    mutation_permits: list[str] = []
    mutation_requests: list[str] = []
    version_bindings: list[str] = []
    ledger_bindings: list[str] = []
    for _version in ("009", "010"):
        version_binding: str | None = None
        for attempt in range(3):
            if cursor + 2 >= len(payloads):
                raise ValueError("mcp_chain_migration_missing")
            mutation = payloads[cursor]
            if mutation["operation"] != "apply_migration":
                raise ValueError("mcp_chain_migration_order_invalid")
            if version_binding is None:
                version_binding = mutation["postconditionHash"]
            elif mutation["postconditionHash"] != version_binding:
                raise ValueError("mcp_chain_retry_binding_changed")
            mutation_permits.append(mutation["permitHash"])
            mutation_requests.append(mutation["requestHash"])
            cursor += 1
            if mutation["success"] is not True and mutation["safeCode"] != "MCP_ACTION_UNKNOWN":
                raise ValueError("mcp_chain_migration_failure_invalid")
            postcondition = payloads[cursor]
            if (
                postcondition["operation"] != "sql_check"
                or postcondition["success"] is not True
                or postcondition["safeCode"] is not None
                or postcondition["postconditionHash"] != version_binding
            ):
                raise ValueError("mcp_chain_postcondition_invalid")
            cursor += 1
            ledger = payloads[cursor]
            if (
                ledger["operation"] != "inspect_migrations"
                or ledger["success"] is not True
                or ledger["safeCode"] is not None
                or ledger["postconditionHash"] == version_binding
            ):
                raise ValueError("mcp_chain_ledger_invalid")
            ledger_bindings.append(ledger["postconditionHash"])
            cursor += 1
            if mutation["success"] is True:
                break
            retry_follows = (
                cursor < len(payloads)
                and payloads[cursor]["operation"] == "apply_migration"
                and payloads[cursor]["postconditionHash"] == version_binding
            )
            if not retry_follows:
                break
            if attempt == 2:
                raise ValueError("mcp_chain_retry_limit_exceeded")
        if version_binding is None:
            raise ValueError("mcp_chain_migration_binding_missing")
        version_bindings.append(version_binding)
    if cursor != len(payloads):
        raise ValueError("mcp_chain_trailing_operation_invalid")
    if (
        len(set(mutation_permits)) != len(mutation_permits)
        or len(set(mutation_requests)) != len(mutation_requests)
        or len(set(version_bindings)) != 2
        or len(set(ledger_bindings)) != len(ledger_bindings)
        or any(binding in set(version_bindings) for binding in ledger_bindings)
    ):
        raise ValueError("mcp_chain_migration_binding_reused")
    return {
        "entryCount": len(entries),
        "tailHash": previous,
        "successfulMigrationCount": 2,
        "verified": True,
    }


def verify_browser_chain(entries: Any, evidence_entries: Any) -> dict[str, Any]:
    if not isinstance(entries, (list, tuple)) or len(entries) != 1:
        raise ValueError("browser_chain_count_invalid")
    item = _exact_mapping(entries[0], {"sequence", "previousHash", "payload", "hash"}, "browser_chain_entry")
    payload = _exact_mapping(
        item["payload"],
        {
            "schemaVersion",
            "operation",
            "resultHmac",
            "success",
            "booleanCount",
            "boundedCount",
            "capturedArtifacts",
        },
        "browser_chain_payload",
    )
    if (
        payload["schemaVersion"] != "protected-browser-attestation.v1"
        or payload["operation"] != "ui_probe"
        or not isinstance(payload["resultHmac"], str)
        or _HMAC.fullmatch(payload["resultHmac"]) is None
        or payload["success"] is not True
        or type(payload["booleanCount"]) is not int
        or payload["booleanCount"] != 3
        or type(payload["boundedCount"]) is not int
        or payload["boundedCount"] != 2
        or type(payload["capturedArtifacts"]) is not int
        or payload["capturedArtifacts"] != 0
    ):
        raise ValueError("browser_chain_payload_invalid")
    core = {"sequence": 0, "previousHash": _GENESIS_HASH, "payload": dict(payload)}
    expected_hash = _sha256(canonical_json(core).encode("ascii"))
    if item["sequence"] != 0 or item["previousHash"] != _GENESIS_HASH or item["hash"] != expected_hash:
        raise ValueError("browser_chain_entry_invalid")
    evidence = verify_evidence_chain(evidence_entries)
    ui_payload = evidence_entries[-1]["payload"]
    ui_hmac = next(
        (
            assertion["hmac"]
            for assertion in ui_payload["assertions"]
            if assertion["id"] == "ui_result_hmac"
        ),
        None,
    )
    if ui_hmac != payload["resultHmac"] or evidence["entryCount"] != len(CASE_IDS):
        raise ValueError("browser_chain_evidence_binding_invalid")
    return {"entryCount": 1, "tailHash": expected_hash, "verified": True}


def validate_migration_ledger(phase: str, applied: Any) -> dict[str, Any]:
    if phase not in {"pre", "after_009", "post"} or not isinstance(applied, (list, tuple)) or not all(isinstance(item, str) for item in applied):
        raise TypeError("migration_ledger_input_invalid")
    expected = {
        "pre": MIGRATION_PRE_LEDGER,
        "after_009": MIGRATION_AFTER_009_LEDGER,
        "post": MIGRATION_POST_LEDGER,
    }[phase]
    if tuple(applied) != expected:
        raise ValueError(f"migration_{phase}_ledger_mismatch")
    return {"phase": phase, "exact": True, "count": len(expected)}


def assert_detached_worktree(attestation: Any) -> dict[str, bool]:
    item = _exact_mapping(
        attestation,
        {"detached", "clean", "headMatchesManifest", "primaryWorktreeUntouched"},
        "worktree_attestation",
    )
    if any(item[key] is not True for key in item):
        raise ValueError("detached_worktree_not_proven")
    return {"detached": True, "clean": True, "headMatchesManifest": True, "primaryWorktreeUntouched": True}


def build_allowlisted_environment(
    source: Mapping[str, str],
    *,
    private_home: str | None = None,
) -> dict[str, str]:
    """Build a fresh child environment; secret/provider/Supabase variables are never copied."""

    if not isinstance(source, Mapping):
        raise TypeError("environment_source_invalid")
    result: dict[str, str] = {
        key: value
        for key, value in source.items()
        if key in _ENV_ALLOWLIST and isinstance(value, str) and "\x00" not in value
    }
    result["PATH"] = os.defpath
    if private_home is not None:
        if not isinstance(private_home, str) or not os.path.isabs(private_home):
            raise TypeError("private_child_home_invalid")
        resolved_home = os.path.realpath(private_home)
        info = os.stat(resolved_home, follow_symlinks=False)
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise ValueError("private_child_home_not_owner_only")
        result["HOME"] = resolved_home
        result["TMPDIR"] = resolved_home
    result.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
            "PYTHONUTF8": "1",
            "UV_OFFLINE": "1",
            "NO_PROXY": "127.0.0.1,localhost",
        }
    )
    return result


def assert_retention_invariants(value: Any) -> dict[str, Any]:
    item = _exact_mapping(
        value,
        {
            "realSuccessesRetained",
            "scriptedSessionsRetained",
            "transientSessionsRemaining",
            "temporaryAuthUsersRemaining",
            "prohibitedVisualArtifacts",
            "productionActions",
            "actualGeminiObserved",
            "actualMediaObserved",
        },
        "retention",
    )
    expected_counts = {
        "realSuccessesRetained": 1,
        "scriptedSessionsRetained": 0,
        "transientSessionsRemaining": 0,
        "temporaryAuthUsersRemaining": 0,
        "prohibitedVisualArtifacts": 0,
        "productionActions": 0,
    }
    if any(type(item[key]) is not int or item[key] != expected for key, expected in expected_counts.items()):
        raise ValueError("retention_count_invariant_failed")
    if item["actualGeminiObserved"] is not True or item["actualMediaObserved"] is not True:
        raise ValueError("real_e2e_not_proven")
    return {**expected_counts, "actualGeminiObserved": True, "actualMediaObserved": True, "verified": True}


def sanitize_mcp_adapter_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or "operation" not in value:
        raise TypeError("mcp_adapter_result_invalid")
    operation = value["operation"]
    if operation == "target":
        item = _exact_mapping(
            value,
            {"operation", "developmentVerified", "productionNegativeVerified", "productionActions", "projectHmac"},
            "mcp_target_result",
        )
        if (
            item["developmentVerified"] is not True
            or item["productionNegativeVerified"] is not True
            or type(item["productionActions"]) is not int
            or item["productionActions"] != 0
            or not isinstance(item["projectHmac"], str)
            or _HMAC.fullmatch(item["projectHmac"]) is None
        ):
            raise ValueError("mcp_target_result_invalid")
    elif operation == "migration":
        item = _exact_mapping(
            value,
            {"operation", "version", "effectPresent", "rowCount", "targetHmac"},
            "mcp_migration_result",
        )
        if (
            item["version"] not in {"009", "010"}
            or type(item["effectPresent"]) is not bool
            or type(item["rowCount"]) is not int
            or item["rowCount"] < 0
            or not isinstance(item["targetHmac"], str)
            or _HMAC.fullmatch(item["targetHmac"]) is None
        ):
            raise ValueError("mcp_migration_result_invalid")
    elif operation == "query":
        item = _exact_mapping(value, {"operation", "passed", "count", "resultHmac"}, "mcp_query_result")
        if (
            type(item["passed"]) is not bool
            or type(item["count"]) is not int
            or item["count"] < 0
            or not isinstance(item["resultHmac"], str)
            or _HMAC.fullmatch(item["resultHmac"]) is None
        ):
            raise ValueError("mcp_query_result_invalid")
    else:
        raise ValueError("mcp_adapter_operation_invalid")
    return dict(item)


def sanitize_browser_adapter_result(value: Any) -> dict[str, Any]:
    item = _exact_mapping(
        value,
        {
            "reportSections",
            "confirmedRendered",
            "notConfirmedRendered",
            "timestampSeekVerified",
            "refreshStable",
            "capturedArtifacts",
            "resultHmac",
        },
        "browser_result",
    )
    if (
        item["reportSections"] != 6
        or item["confirmedRendered"] is not True
        or item["notConfirmedRendered"] is not True
        or item["timestampSeekVerified"] is not True
        or item["refreshStable"] is not True
        or type(item["capturedArtifacts"]) is not int
        or item["capturedArtifacts"] != 0
        or not isinstance(item["resultHmac"], str)
        or _HMAC.fullmatch(item["resultHmac"]) is None
    ):
        raise ValueError("browser_result_invalid")
    return dict(item)


_REAL_ATTESTATION_SCHEMA = "protected-real-attestation.v1"
_REAL_PROVIDER_MAC_DOMAIN = b"acttub-protected-real-provider.v1\0"
_REAL_MEDIA_MAC_DOMAIN = b"acttub-protected-real-media.v1\0"


def validate_real_attestation(value: Any, mac_key_fd: int) -> dict[str, str]:
    """Validate FD-origin provider/media facts without retaining raw media metadata."""

    item = _exact_mapping(
        value,
        {
            "schemaVersion",
            "serviceModes",
            "providerCredentialFdOnly",
            "providerCallCount",
            "providerStagesObserved",
            "providerEventCount",
            "providerEventTailHmac",
            "providerEventAggregateHmac",
            "mediaReadFromFd",
            "mediaByteCount",
            "mediaContentHmac",
            "providerAttestationHmac",
            "mediaAttestationHmac",
        },
        "real_attestation",
    )
    service_modes = _exact_mapping(item["serviceModes"], {"summary", "agent", "report"}, "real_service_modes")
    stages = item["providerStagesObserved"]
    if (
        item["schemaVersion"] != _REAL_ATTESTATION_SCHEMA
        or any(service_modes[name] != "real" for name in ("summary", "agent", "report"))
        or item["providerCredentialFdOnly"] is not True
        or type(item["providerCallCount"]) is not int
        or item["providerCallCount"] < 3
        or not isinstance(stages, list)
        or stages != ["summary", "agent", "report"]
        or type(item["providerEventCount"]) is not int
        or item["providerEventCount"] < item["providerCallCount"] + 3
        or not isinstance(item["providerEventTailHmac"], str)
        or _HMAC.fullmatch(item["providerEventTailHmac"]) is None
        or not isinstance(item["providerEventAggregateHmac"], str)
        or _HMAC.fullmatch(item["providerEventAggregateHmac"]) is None
        or item["mediaReadFromFd"] is not True
        or type(item["mediaByteCount"]) is not int
        or not 0 < item["mediaByteCount"] <= 8 * 1024 * 1024 * 1024
        or not isinstance(item["mediaContentHmac"], str)
        or _HMAC.fullmatch(item["mediaContentHmac"]) is None
        or not isinstance(item["providerAttestationHmac"], str)
        or _HMAC.fullmatch(item["providerAttestationHmac"]) is None
        or not isinstance(item["mediaAttestationHmac"], str)
        or _HMAC.fullmatch(item["mediaAttestationHmac"]) is None
    ):
        raise ValueError("real_attestation_invalid")
    provider_core = {
        "schemaVersion": item["schemaVersion"],
        "serviceModes": dict(service_modes),
        "providerCredentialFdOnly": True,
        "providerCallCount": item["providerCallCount"],
        "providerStagesObserved": list(stages),
        "providerEventCount": item["providerEventCount"],
        "providerEventTailHmac": item["providerEventTailHmac"],
        "providerEventAggregateHmac": item["providerEventAggregateHmac"],
    }
    media_core = {
        "schemaVersion": item["schemaVersion"],
        "mediaReadFromFd": True,
        "mediaByteCount": item["mediaByteCount"],
        "mediaContentHmac": item["mediaContentHmac"],
    }
    key = _read_mac_key(mac_key_fd)
    expected_provider = "hmac-sha256:" + hmac.new(
        key,
        _REAL_PROVIDER_MAC_DOMAIN + canonical_json(provider_core).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    expected_media = "hmac-sha256:" + hmac.new(
        key,
        _REAL_MEDIA_MAC_DOMAIN + canonical_json(media_core).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if (
        not hmac.compare_digest(item["providerAttestationHmac"], expected_provider)
        or not hmac.compare_digest(item["mediaAttestationHmac"], expected_media)
    ):
        raise ValueError("real_attestation_mac_invalid")
    return {
        "providerAttestationHmac": expected_provider,
        "mediaAttestationHmac": expected_media,
    }


@dataclass(frozen=True)
class ControllerState:
    schema_version: str = "protected-e2e-controller.v1"
    phase: str = "created"
    next_case_index: int = 0
    completed_cases: tuple[str, ...] = ()
    evidence_hashes: tuple[str, ...] = ()
    manifest_verified: bool = False
    production_negative_verified: bool = False
    actual_gemini_observed: bool = False
    actual_media_observed: bool = False
    manifest_digest: str | None = None
    development_mcp_attestation_hash: str | None = None
    prepared_version: str | None = None
    prepared_target_hmac: str | None = None
    prepared_payload_sha256: str | None = None
    current_consume_hash: str | None = None
    current_permit_hash: str | None = None
    consumed_permit_hashes: tuple[str, ...] = ()
    migration_attestation_hashes: tuple[str, ...] = ()
    development_target_hmac: str | None = None
    mcp_sequence: int = -1
    mcp_tail_hash: str = _GENESIS_HASH
    prepared_payload_binding_hmac: str | None = None
    scripted_phase_cleaned: bool = False
    real_phase_started: bool = False
    cleanup_vault_complete: bool = False
    retention_verified: bool = False
    transition_sequence: int = 0
    browser_attestation_hash: str | None = None
    provider_attestation_hmac: str | None = None
    media_attestation_hmac: str | None = None


def new_controller() -> ControllerState:
    return ControllerState()


_CONTROLLER_PHASES = frozenset(
    {
        "created",
        "offline_verified",
        "private_state_ready",
        "dev_target_verified",
        "migration_009_prepare_required",
        "migration_009_prepared",
        "migration_009_in_flight",
        "migration_009_unknown",
        "migration_009_retry_required",
        "migration_009_retry_prepared",
        "migration_009_attested",
        "migration_010_prepared",
        "migration_010_in_flight",
        "migration_010_unknown",
        "migration_010_retry_required",
        "migration_010_retry_prepared",
        "migration_010_attested",
        "migration_postflight_verified",
        "services_ready",
        "scripted_cases_running",
        "scripted_cleanup_pending",
        "real_start_required",
        "real_cases_running",
        "real_provider_cleanup_pending",
        "isolated_data_cases_running",
        "ui_probe_start_required",
        "ui_case_running",
        "cleanup_pending",
        "cleanup_verified",
        "evidence_sealed",
        "completed",
    }
)
_CONTROLLER_STATE_KEYS = frozenset(
    {
        "schemaVersion",
        "phase",
        "nextCaseIndex",
        "completedCases",
        "evidenceHashes",
        "manifestVerified",
        "productionNegativeVerified",
        "actualGeminiObserved",
        "actualMediaObserved",
        "manifestDigest",
        "developmentMcpAttestationHash",
        "preparedVersion",
        "preparedTargetHmac",
        "preparedPayloadSha256",
        "currentConsumeHash",
        "currentPermitHash",
        "consumedPermitHashes",
        "migrationAttestationHashes",
        "developmentTargetHmac",
        "mcpSequence",
        "mcpTailHash",
        "preparedPayloadBindingHmac",
        "scriptedPhaseCleaned",
        "realPhaseStarted",
        "cleanupVaultComplete",
        "retentionVerified",
        "transitionSequence",
        "browserAttestationHash",
        "providerAttestationHmac",
        "mediaAttestationHmac",
    }
)


def controller_state_record(state: ControllerState) -> dict[str, Any]:
    if not isinstance(state, ControllerState):
        raise TypeError("controller_state_invalid")
    return {
        "schemaVersion": state.schema_version,
        "phase": state.phase,
        "nextCaseIndex": state.next_case_index,
        "completedCases": list(state.completed_cases),
        "evidenceHashes": list(state.evidence_hashes),
        "manifestVerified": state.manifest_verified,
        "productionNegativeVerified": state.production_negative_verified,
        "actualGeminiObserved": state.actual_gemini_observed,
        "actualMediaObserved": state.actual_media_observed,
        "manifestDigest": state.manifest_digest,
        "developmentMcpAttestationHash": state.development_mcp_attestation_hash,
        "preparedVersion": state.prepared_version,
        "preparedTargetHmac": state.prepared_target_hmac,
        "preparedPayloadSha256": state.prepared_payload_sha256,
        "currentConsumeHash": state.current_consume_hash,
        "currentPermitHash": state.current_permit_hash,
        "consumedPermitHashes": list(state.consumed_permit_hashes),
        "migrationAttestationHashes": list(state.migration_attestation_hashes),
        "developmentTargetHmac": state.development_target_hmac,
        "mcpSequence": state.mcp_sequence,
        "mcpTailHash": state.mcp_tail_hash,
        "preparedPayloadBindingHmac": state.prepared_payload_binding_hmac,
        "scriptedPhaseCleaned": state.scripted_phase_cleaned,
        "realPhaseStarted": state.real_phase_started,
        "cleanupVaultComplete": state.cleanup_vault_complete,
        "retentionVerified": state.retention_verified,
        "transitionSequence": state.transition_sequence,
        "browserAttestationHash": state.browser_attestation_hash,
        "providerAttestationHmac": state.provider_attestation_hmac,
        "mediaAttestationHmac": state.media_attestation_hmac,
    }


def restore_controller_state(value: Any) -> ControllerState:
    item = _exact_mapping(value, _CONTROLLER_STATE_KEYS, "controller_state_record")
    if item["schemaVersion"] != "protected-e2e-controller.v1" or item["phase"] not in _CONTROLLER_PHASES:
        raise ValueError("controller_state_identity_invalid")
    if type(item["nextCaseIndex"]) is not int or not 0 <= item["nextCaseIndex"] <= len(CASE_IDS):
        raise ValueError("controller_state_case_index_invalid")
    if type(item["transitionSequence"]) is not int or item["transitionSequence"] < 0:
        raise ValueError("controller_state_transition_sequence_invalid")
    if (
        not isinstance(item["completedCases"], list)
        or tuple(item["completedCases"]) != CASE_IDS[: item["nextCaseIndex"]]
        or not isinstance(item["evidenceHashes"], list)
        or len(item["evidenceHashes"]) != item["nextCaseIndex"]
        or any(not isinstance(value, str) or _HASH.fullmatch(value) is None for value in item["evidenceHashes"])
    ):
        raise ValueError("controller_state_evidence_invalid")
    boolean_keys = (
        "manifestVerified",
        "productionNegativeVerified",
        "actualGeminiObserved",
        "actualMediaObserved",
        "scriptedPhaseCleaned",
        "realPhaseStarted",
        "cleanupVaultComplete",
        "retentionVerified",
    )
    if any(type(item[key]) is not bool for key in boolean_keys):
        raise TypeError("controller_state_boolean_invalid")
    optional_sha_keys = ("manifestDigest", "preparedPayloadSha256")
    for key in optional_sha_keys:
        if item[key] is not None:
            require_sha256(item[key], f"controller_state_{key}")
    optional_hash_keys = (
        "developmentMcpAttestationHash",
        "currentConsumeHash",
        "currentPermitHash",
        "browserAttestationHash",
    )
    for key in optional_hash_keys:
        if item[key] is not None and (not isinstance(item[key], str) or _HASH.fullmatch(item[key]) is None):
            raise ValueError("controller_state_hash_invalid")
    for key in ("preparedTargetHmac", "developmentTargetHmac", "preparedPayloadBindingHmac"):
        if item[key] is not None and (not isinstance(item[key], str) or _HMAC.fullmatch(item[key]) is None):
            raise ValueError("controller_state_hmac_invalid")
    for key in ("providerAttestationHmac", "mediaAttestationHmac"):
        if item[key] is not None and (not isinstance(item[key], str) or _HMAC.fullmatch(item[key]) is None):
            raise ValueError("controller_state_real_attestation_hmac_invalid")
    if item["preparedVersion"] not in {None, "009", "010"}:
        raise ValueError("controller_state_prepared_version_invalid")
    for key in ("consumedPermitHashes", "migrationAttestationHashes"):
        values = item[key]
        if (
            not isinstance(values, list)
            or len(values) != len(set(values))
            or any(not isinstance(value, str) or _HASH.fullmatch(value) is None for value in values)
        ):
            raise ValueError("controller_state_hash_list_invalid")
    if len(item["migrationAttestationHashes"]) > 2:
        raise ValueError("controller_state_migration_attestation_count_invalid")
    if type(item["mcpSequence"]) is not int or item["mcpSequence"] < -1:
        raise ValueError("controller_state_mcp_sequence_invalid")
    if not isinstance(item["mcpTailHash"], str) or _HASH.fullmatch(item["mcpTailHash"]) is None:
        raise ValueError("controller_state_mcp_tail_invalid")
    if (item["mcpSequence"] == -1) != (item["mcpTailHash"] == _GENESIS_HASH):
        raise ValueError("controller_state_mcp_chain_invalid")
    if item["phase"] != "created" and (item["manifestVerified"] is not True or item["manifestDigest"] is None):
        raise ValueError("controller_state_manifest_invariant_failed")
    if item["phase"] in {"cleanup_verified", "evidence_sealed", "completed"} and (
        item["cleanupVaultComplete"] is not True or item["retentionVerified"] is not True
    ):
        raise ValueError("controller_state_cleanup_invariant_failed")
    if item["phase"] in {"evidence_sealed", "completed"} and item["browserAttestationHash"] is None:
        raise ValueError("controller_state_browser_invariant_failed")
    if item["nextCaseIndex"] > CASE_IDS.index("REAL-01") and (
        item["actualGeminiObserved"] is not True or item["actualMediaObserved"] is not True
        or item["providerAttestationHmac"] is None
        or item["mediaAttestationHmac"] is None
    ):
        raise ValueError("controller_state_real_observation_invariant_failed")
    in_flight = item["phase"] in {
        "migration_009_in_flight",
        "migration_009_unknown",
        "migration_010_in_flight",
        "migration_010_unknown",
    }
    if in_flight != (item["currentConsumeHash"] is not None and item["currentPermitHash"] is not None):
        raise ValueError("controller_state_in_flight_invariant_failed")
    state = ControllerState(
        phase=item["phase"],
        next_case_index=item["nextCaseIndex"],
        completed_cases=tuple(item["completedCases"]),
        evidence_hashes=tuple(item["evidenceHashes"]),
        manifest_verified=item["manifestVerified"],
        production_negative_verified=item["productionNegativeVerified"],
        actual_gemini_observed=item["actualGeminiObserved"],
        actual_media_observed=item["actualMediaObserved"],
        manifest_digest=item["manifestDigest"],
        development_mcp_attestation_hash=item["developmentMcpAttestationHash"],
        prepared_version=item["preparedVersion"],
        prepared_target_hmac=item["preparedTargetHmac"],
        prepared_payload_sha256=item["preparedPayloadSha256"],
        current_consume_hash=item["currentConsumeHash"],
        current_permit_hash=item["currentPermitHash"],
        consumed_permit_hashes=tuple(item["consumedPermitHashes"]),
        migration_attestation_hashes=tuple(item["migrationAttestationHashes"]),
        development_target_hmac=item["developmentTargetHmac"],
        mcp_sequence=item["mcpSequence"],
        mcp_tail_hash=item["mcpTailHash"],
        prepared_payload_binding_hmac=item["preparedPayloadBindingHmac"],
        scripted_phase_cleaned=item["scriptedPhaseCleaned"],
        real_phase_started=item["realPhaseStarted"],
        cleanup_vault_complete=item["cleanupVaultComplete"],
        retention_verified=item["retentionVerified"],
        transition_sequence=item["transitionSequence"],
        browser_attestation_hash=item["browserAttestationHash"],
        provider_attestation_hmac=item["providerAttestationHmac"],
        media_attestation_hmac=item["mediaAttestationHmac"],
    )
    if controller_state_record(state) != dict(item):
        raise ValueError("controller_state_round_trip_failed")
    return state


def transition_and_persist(
    state: ControllerState,
    event: Any,
    write_atomic: Callable[[str, Any], None],
) -> ControllerState:
    if not callable(write_atomic):
        raise TypeError("controller_state_writer_invalid")
    next_state = replace(transition(state, event), transition_sequence=state.transition_sequence + 1)
    write_atomic("state", controller_state_record(next_state))
    return next_state


def controller_state_digest(state: ControllerState) -> str:
    return "sha256:" + _sha256(canonical_json(controller_state_record(state)).encode("ascii"))


def _event(value: Any, keys: set[str], expected_type: str) -> Mapping[str, Any]:
    item = _exact_mapping(value, keys | {"type"}, "controller_event")
    if item["type"] != expected_type:
        raise ValueError("controller_event_type_invalid")
    return item


def transition(state: ControllerState, event: Any) -> ControllerState:
    if not isinstance(state, ControllerState):
        raise TypeError("controller_state_invalid")

    if state.phase == "created":
        item = _event(event, {"manifestVerified", "manifestDigest", "sanitizerSelfTestPassed"}, "OFFLINE_FOUNDATION_VERIFIED")
        if item["manifestVerified"] is not True or item["sanitizerSelfTestPassed"] is not True:
            raise ValueError("offline_foundation_not_verified")
        if not isinstance(item["manifestDigest"], str):
            raise ValueError("offline_manifest_digest_invalid")
        manifest_pin = "sha256:" + require_sha256(item["manifestDigest"], "manifest_digest")
        return replace(state, phase="offline_verified", manifest_verified=True, manifest_digest=manifest_pin)

    if state.phase == "offline_verified":
        item = _event(event, {"permissionsVerified", "fdContractVerified"}, "PRIVATE_STATE_INITIALIZED")
        if item["permissionsVerified"] is not True or item["fdContractVerified"] is not True:
            raise ValueError("private_state_not_verified")
        return replace(state, phase="private_state_ready")

    if state.phase == "private_state_ready":
        item = _event(event, {"proof", "mcpEntries"}, "DEV_TARGET_VERIFIED")
        proof = assert_development_target(item["proof"], item["mcpEntries"])
        target_hmac = proof["targetHmac"]
        if len(item["mcpEntries"]) != 1:
            raise ValueError("development_target_mcp_chain_count_invalid")
        mcp_entry = _validate_mcp_entry(
            item["mcpEntries"][0],
            sequence=0,
            previous_hash=_GENESIS_HASH,
            operation="list_projects",
            postcondition_hash=target_hmac,
            target_hmac=target_hmac,
        )
        if (
            proof["developmentVerified"] is not True
            or proof["productionNegativeVerified"] is not True
            or proof["productionActionCount"] != 0
            or not isinstance(target_hmac, str)
            or _HMAC.fullmatch(target_hmac) is None
        ):
            raise ValueError("development_target_not_verified")
        return replace(
            state,
            phase="dev_target_verified",
            production_negative_verified=True,
            development_mcp_attestation_hash=mcp_entry["hash"],
            development_target_hmac=target_hmac,
            mcp_sequence=0,
            mcp_tail_hash=mcp_entry["hash"],
        )

    if state.phase == "dev_target_verified":
        item = _event(
            event,
            {"ledger", "ledgerHmac", "mcpEntry"},
            "MIGRATION_PREFLIGHT_VERIFIED",
        )
        ledger = validate_migration_ledger("pre", item["ledger"])
        mcp_entry = _validate_mcp_entry(
            item["mcpEntry"],
            sequence=state.mcp_sequence + 1,
            previous_hash=state.mcp_tail_hash,
            operation="inspect_migrations",
            postcondition_hash=item["ledgerHmac"],
            target_hmac=state.development_target_hmac,
        )
        if (
            ledger["exact"] is not True
            or ledger["count"] != len(MIGRATION_PRE_LEDGER)
            or not isinstance(item["ledgerHmac"], str)
            or _HMAC.fullmatch(item["ledgerHmac"]) is None
        ):
            raise ValueError("migration_preflight_not_verified")
        return replace(
            state,
            phase="migration_009_prepare_required",
            mcp_sequence=mcp_entry["sequence"],
            mcp_tail_hash=mcp_entry["hash"],
        )

    prepare_phases = {
        "migration_009_prepare_required": "009",
        "migration_009_retry_required": "009",
        "migration_009_attested": "010",
        "migration_010_retry_required": "010",
    }
    if state.phase in prepare_phases:
        item = _event(
            event,
            {"version", "targetHmac", "payloadSha256", "payloadBindingHmac", "mcpOnly", "productionActionCount"},
            "MIGRATION_PREPARED",
        )
        version = prepare_phases[state.phase]
        if (
            item["version"] != version
            or item["targetHmac"] != state.development_target_hmac
            or not isinstance(item["targetHmac"], str)
            or _HMAC.fullmatch(item["targetHmac"]) is None
            or not isinstance(item["payloadSha256"], str)
            or not isinstance(item["payloadBindingHmac"], str)
            or _HMAC.fullmatch(item["payloadBindingHmac"]) is None
            or item["mcpOnly"] is not True
            or type(item["productionActionCount"]) is not int
            or item["productionActionCount"] != 0
        ):
            raise ValueError("migration_prepare_invalid")
        payload = "sha256:" + require_sha256(item["payloadSha256"], "migration_payload")
        retry = state.phase.endswith("retry_required")
        return replace(
            state,
            phase=f"migration_{version}_{'retry_' if retry else ''}prepared",
            prepared_version=version,
            prepared_target_hmac=item["targetHmac"],
            prepared_payload_sha256=payload,
            prepared_payload_binding_hmac=item["payloadBindingHmac"],
            current_consume_hash=None,
            current_permit_hash=None,
        )

    if state.phase in {"migration_009_prepared", "migration_009_retry_prepared", "migration_010_prepared", "migration_010_retry_prepared"}:
        item = _event(
            event,
            {
                "version",
                "action",
                "consumeHash",
                "targetHmac",
                "payloadSha256",
                "caseId",
                "idempotencyHmac",
                "permitLedgerFd",
                "macKeyFd",
            },
            "MIGRATION_PERMIT_CONSUMED",
        )
        try:
            from .secure_state import MutationPermitLedger
        except ImportError:  # pragma: no cover - direct script import fallback
            from secure_state import MutationPermitLedger
        verification = MutationPermitLedger(item["permitLedgerFd"]).verify_consumption(
            item["consumeHash"],
            operation="apply_migration",
            action=item["action"],
            development_target_hmac=item["targetHmac"],
            payload_sha256=item["payloadSha256"],
            case_id=item["caseId"],
            idempotency_hmac=item["idempotencyHmac"],
            controller_state=state.phase,
            controller_state_hash=controller_state_digest(state),
            controller_state_sequence=state.transition_sequence,
            mac_key_fd=item["macKeyFd"],
        )
        if (
            item["version"] != state.prepared_version
            or item["action"] != f"apply_migration_{state.prepared_version}"
            or item["targetHmac"] != state.prepared_target_hmac
            or "sha256:" + require_sha256(item["payloadSha256"], "migration_payload") != state.prepared_payload_sha256
            or item["caseId"] != "DB-02"
            or not isinstance(item["idempotencyHmac"], str)
            or _HMAC.fullmatch(item["idempotencyHmac"]) is None
            or not isinstance(item["consumeHash"], str)
            or _HASH.fullmatch(item["consumeHash"]) is None
            or verification["consumeHash"] != item["consumeHash"]
            or verification["permitHash"] in state.consumed_permit_hashes
        ):
            raise ValueError("migration_permit_consume_invalid")
        return replace(
            state,
            phase=f"migration_{state.prepared_version}_in_flight",
            current_consume_hash=item["consumeHash"],
            current_permit_hash=verification["permitHash"],
            consumed_permit_hashes=state.consumed_permit_hashes + (verification["permitHash"],),
        )

    if state.phase in {"migration_009_in_flight", "migration_010_in_flight"}:
        version = state.phase.split("_")[1]
        if isinstance(event, Mapping) and event.get("type") == "MIGRATION_UNKNOWN":
            item = _event(
                event,
                {"version", "consumeHash", "reconciliationRequired", "mcpEntry", "permitLedgerFd"},
                "MIGRATION_UNKNOWN",
            )
            try:
                from .secure_state import MutationPermitLedger
            except ImportError:  # pragma: no cover - direct script import fallback
                from secure_state import MutationPermitLedger
            outcome = MutationPermitLedger(item["permitLedgerFd"]).verify_outcome(item["consumeHash"], "unknown")
            mcp_entry = _validate_mcp_entry(
                item["mcpEntry"],
                sequence=state.mcp_sequence + 1,
                previous_hash=state.mcp_tail_hash,
                operation="apply_migration",
                postcondition_hash=state.prepared_payload_binding_hmac,
                target_hmac=state.development_target_hmac,
                permit_hash=state.current_permit_hash,
                expected_success=False,
                expected_safe_code="MCP_ACTION_UNKNOWN",
            )
            if (
                item["version"] != version
                or item["consumeHash"] != state.current_consume_hash
                or outcome["verified"] is not True
                or item["reconciliationRequired"] is not True
            ):
                raise ValueError("migration_unknown_invalid")
            return replace(
                state,
                phase=f"migration_{version}_unknown",
                mcp_sequence=mcp_entry["sequence"],
                mcp_tail_hash=mcp_entry["hash"],
            )
        item = _event(
            event,
            {
                "version",
                "consumeHash",
                "targetHmac",
                "applyMcpEntry",
                "postconditionMcpEntry",
                "ledgerMcpEntry",
                "effectPresent",
                "ledger",
                "ledgerHmac",
                "targetMatched",
                "payloadMatched",
                "permitLedgerFd",
                "productionActionCount",
            },
            "MIGRATION_ATTESTED",
        )
        apply_entry = _validate_mcp_entry(
            item["applyMcpEntry"],
            sequence=state.mcp_sequence + 1,
            previous_hash=state.mcp_tail_hash,
            operation="apply_migration",
            postcondition_hash=state.prepared_payload_binding_hmac,
            target_hmac=state.development_target_hmac,
            permit_hash=state.current_permit_hash,
        )
        postcondition_entry = _validate_mcp_entry(
            item["postconditionMcpEntry"],
            sequence=apply_entry["sequence"] + 1,
            previous_hash=apply_entry["hash"],
            operation="sql_check",
            postcondition_hash=state.prepared_payload_binding_hmac,
            target_hmac=state.development_target_hmac,
        )
        ledger = validate_migration_ledger(
            "post" if version == "010" else "after_009",
            item["ledger"],
        )
        ledger_entry = _validate_mcp_entry(
            item["ledgerMcpEntry"],
            sequence=postcondition_entry["sequence"] + 1,
            previous_hash=postcondition_entry["hash"],
            operation="inspect_migrations",
            postcondition_hash=item["ledgerHmac"],
            target_hmac=state.development_target_hmac,
        )
        try:
            from .secure_state import MutationPermitLedger
        except ImportError:  # pragma: no cover - direct script import fallback
            from secure_state import MutationPermitLedger
        outcome = MutationPermitLedger(item["permitLedgerFd"]).verify_outcome(item["consumeHash"], "attested")
        if (
            item["version"] != version
            or item["consumeHash"] != state.current_consume_hash
            or item["targetHmac"] != state.development_target_hmac
            or any(item[key] is not True for key in ("effectPresent", "targetMatched", "payloadMatched"))
            or ledger["exact"] is not True
            or not isinstance(item["ledgerHmac"], str)
            or _HMAC.fullmatch(item["ledgerHmac"]) is None
            or outcome["verified"] is not True
            or type(item["productionActionCount"]) is not int
            or item["productionActionCount"] != 0
        ):
            raise ValueError("migration_attestation_invalid")
        return replace(
            state,
            phase=f"migration_{version}_attested",
            migration_attestation_hashes=state.migration_attestation_hashes + (ledger_entry["hash"],),
            mcp_sequence=ledger_entry["sequence"],
            mcp_tail_hash=ledger_entry["hash"],
            current_consume_hash=None,
            current_permit_hash=None,
        )

    if state.phase in {"migration_009_unknown", "migration_010_unknown"}:
        version = state.phase.split("_")[1]
        item = _event(
            event,
            {
                "version",
                "consumeHash",
                "targetHmac",
                "postconditionMcpEntry",
                "ledgerMcpEntry",
                "effectPresent",
                "ledger",
                "ledgerHmac",
                "permitLedgerFd",
                "productionActionCount",
            },
            "MIGRATION_RECONCILED",
        )
        postcondition_entry = _validate_mcp_entry(
            item["postconditionMcpEntry"],
            sequence=state.mcp_sequence + 1,
            previous_hash=state.mcp_tail_hash,
            operation="sql_check",
            postcondition_hash=state.prepared_payload_binding_hmac,
            target_hmac=state.development_target_hmac,
        )
        expected_ledger = (
            MIGRATION_AFTER_009_LEDGER
            if version == "009"
            else MIGRATION_POST_LEDGER
        ) if item["effectPresent"] else (
            MIGRATION_PRE_LEDGER
            if version == "009"
            else MIGRATION_AFTER_009_LEDGER
        )
        if tuple(item["ledger"]) != expected_ledger:
            raise ValueError("migration_reconciliation_ledger_mismatch")
        if not isinstance(item["ledgerHmac"], str) or _HMAC.fullmatch(item["ledgerHmac"]) is None:
            raise ValueError("migration_reconciliation_ledger_hmac_invalid")
        ledger_entry = _validate_mcp_entry(
            item["ledgerMcpEntry"],
            sequence=postcondition_entry["sequence"] + 1,
            previous_hash=postcondition_entry["hash"],
            operation="inspect_migrations",
            postcondition_hash=item["ledgerHmac"],
            target_hmac=state.development_target_hmac,
        )
        try:
            from .secure_state import MutationPermitLedger
        except ImportError:  # pragma: no cover - direct script import fallback
            from secure_state import MutationPermitLedger
        reconciliation = MutationPermitLedger(item["permitLedgerFd"]).verify_reconciliation(
            item["consumeHash"],
            effect_present=item["effectPresent"],
        )
        if (
            item["version"] != version
            or item["consumeHash"] != state.current_consume_hash
            or item["targetHmac"] != state.development_target_hmac
            or type(item["effectPresent"]) is not bool
            or reconciliation["verified"] is not True
            or type(item["productionActionCount"]) is not int
            or item["productionActionCount"] != 0
        ):
            raise ValueError("migration_reconciliation_invalid")
        if item["effectPresent"]:
            return replace(
                state,
                phase=f"migration_{version}_attested",
                migration_attestation_hashes=state.migration_attestation_hashes + (ledger_entry["hash"],),
                mcp_sequence=ledger_entry["sequence"],
                mcp_tail_hash=ledger_entry["hash"],
                current_consume_hash=None,
                current_permit_hash=None,
            )
        return replace(
            state,
            phase=f"migration_{version}_retry_required",
            current_consume_hash=None,
            current_permit_hash=None,
            mcp_sequence=ledger_entry["sequence"],
            mcp_tail_hash=ledger_entry["hash"],
        )

    if state.phase == "migration_010_attested":
        item = _event(event, {"ledger", "ledgerHmac", "mcpEntry"}, "MIGRATION_POSTFLIGHT_VERIFIED")
        ledger = validate_migration_ledger("post", item["ledger"])
        mcp_entry = _validate_mcp_entry(
            item["mcpEntry"],
            sequence=state.mcp_sequence + 1,
            previous_hash=state.mcp_tail_hash,
            operation="inspect_migrations",
            postcondition_hash=item["ledgerHmac"],
            target_hmac=state.development_target_hmac,
        )
        if (
            ledger["exact"] is not True
            or ledger["count"] != len(MIGRATION_POST_LEDGER)
            or not isinstance(item["ledgerHmac"], str)
            or _HMAC.fullmatch(item["ledgerHmac"]) is None
        ):
            raise ValueError("migration_postflight_not_verified")
        if len(state.migration_attestation_hashes) != 2:
            raise ValueError("migration_attestations_incomplete")
        return replace(
            state,
            phase="migration_postflight_verified",
            mcp_sequence=mcp_entry["sequence"],
            mcp_tail_hash=mcp_entry["hash"],
        )

    if state.phase == "migration_postflight_verified":
        item = _event(
            event,
            {"explicitSettings", "createAppOnly", "scriptedServicesReady", "outputsDiscarded"},
            "SERVICES_READY",
        )
        if any(item[key] is not True for key in ("explicitSettings", "createAppOnly", "scriptedServicesReady", "outputsDiscarded")):
            raise ValueError("services_not_ready")
        return replace(state, phase="services_ready")

    if state.phase == "services_ready":
        item = _event(
            event,
            {"providerCredentialPresent", "scriptedPortsIsolated", "cleanupPlanned", "outputsDiscarded"},
            "BEGIN_SCRIPTED_CASES",
        )
        if (
            item["providerCredentialPresent"] is not False
            or any(item[key] is not True for key in ("scriptedPortsIsolated", "cleanupPlanned", "outputsDiscarded"))
        ):
            raise ValueError("scripted_phase_not_isolated")
        return replace(state, phase="scripted_cases_running")

    if state.phase in {
        "scripted_cases_running",
        "real_cases_running",
        "isolated_data_cases_running",
        "ui_case_running",
    }:
        if state.next_case_index >= len(CASE_IDS):
            raise ValueError("case_index_exhausted")
        expected_case_id = CASE_IDS[state.next_case_index]
        event_keys = {"evidence", "evidenceHash"}
        if expected_case_id == "REAL-01":
            event_keys.update({"realAttestation", "macKeyFd"})
        item = _event(event, event_keys, "CASE_RECORDED")
        clean = sanitize_evidence(item["evidence"])
        expected_mode = EXPECTED_CASE_MODES[expected_case_id]
        expected_index_range = {
            "scripted_cases_running": state.next_case_index < SCRIPTED_CASE_COUNT,
            "real_cases_running": SCRIPTED_CASE_COUNT <= state.next_case_index < REAL_PROVIDER_CASE_END,
            "isolated_data_cases_running": REAL_PROVIDER_CASE_END <= state.next_case_index < ISOLATED_DATA_CASE_END,
            "ui_case_running": state.next_case_index == ISOLATED_DATA_CASE_END,
        }[state.phase]
        if (
            not expected_index_range
            or clean["status"] != "pass"
            or clean["caseId"] != expected_case_id
            or clean["mode"] != expected_mode
        ):
            raise ValueError("case_order_or_status_invalid")
        previous_hash = state.evidence_hashes[-1] if state.evidence_hashes else _GENESIS_HASH
        evidence_core = {"sequence": state.next_case_index, "previousHash": previous_hash, "payload": clean}
        expected_evidence_hash = hashlib.sha256(canonical_json(evidence_core).encode("ascii")).hexdigest()
        if (
            not isinstance(item["evidenceHash"], str)
            or _HASH.fullmatch(item["evidenceHash"]) is None
            or not hmac.compare_digest(item["evidenceHash"], expected_evidence_hash)
        ):
            raise ValueError("case_evidence_hash_invalid")
        gemini = state.actual_gemini_observed
        media = state.actual_media_observed
        provider_attestation_hmac = state.provider_attestation_hmac
        media_attestation_hmac = state.media_attestation_hmac
        if clean["caseId"] == "REAL-01":
            assertion_values = {assertion["id"]: assertion for assertion in clean["assertions"]}
            gemini = assertion_values["actual_gemini_observed"]["passed"]
            media = assertion_values["actual_media_observed"]["passed"]
            attestation = validate_real_attestation(item["realAttestation"], item["macKeyFd"])
            provider_attestation_hmac = attestation["providerAttestationHmac"]
            media_attestation_hmac = attestation["mediaAttestationHmac"]
            if (
                assertion_values["provider_attestation_hmac"]["hmac"] != provider_attestation_hmac
                or assertion_values["media_attestation_hmac"]["hmac"] != media_attestation_hmac
            ):
                raise ValueError("real_attestation_evidence_binding_invalid")
        next_index = state.next_case_index + 1
        if next_index == SCRIPTED_CASE_COUNT:
            next_phase = "scripted_cleanup_pending"
        elif next_index == REAL_PROVIDER_CASE_END:
            next_phase = "real_provider_cleanup_pending"
        elif next_index == ISOLATED_DATA_CASE_END:
            next_phase = "ui_probe_start_required"
        elif next_index == len(CASE_IDS):
            next_phase = "cleanup_pending"
        else:
            next_phase = state.phase
        return replace(
            state,
            phase=next_phase,
            next_case_index=next_index,
            completed_cases=state.completed_cases + (clean["caseId"],),
            evidence_hashes=state.evidence_hashes + (item["evidenceHash"],),
            actual_gemini_observed=gemini,
            actual_media_observed=media,
            provider_attestation_hmac=provider_attestation_hmac,
            media_attestation_hmac=media_attestation_hmac,
        )

    if state.phase == "real_provider_cleanup_pending":
        item = _event(
            event,
            {"processesStopped", "providerCredentialAbsent", "portsReleased", "outputsDiscarded"},
            "REAL_PROVIDER_PHASE_CLEANED",
        )
        if any(item[key] is not True for key in item if key != "type"):
            raise ValueError("real_provider_cleanup_not_verified")
        return replace(state, phase="isolated_data_cases_running")

    if state.phase == "ui_probe_start_required":
        item = _event(
            event,
            {"platformRunning", "aiServicesStopped", "browserCaptureDisabled"},
            "BEGIN_UI_PROBE",
        )
        if any(item[key] is not True for key in item if key != "type"):
            raise ValueError("ui_probe_not_isolated")
        return replace(state, phase="ui_case_running")

    if state.phase == "scripted_cleanup_pending":
        item = _event(
            event,
            {"processesStopped", "providerCredentialAbsent", "scriptedSessionsRemoved", "cleanupVaultConsistent"},
            "SCRIPTED_PHASE_CLEANED",
        )
        if any(item[key] is not True for key in item if key != "type"):
            raise ValueError("scripted_cleanup_not_verified")
        return replace(state, phase="real_start_required", scripted_phase_cleaned=True)

    if state.phase == "real_start_required":
        item = _event(
            event,
            {
                "scriptedProcessesStopped",
                "settingsFdsValidated",
                "mediaFdValidated",
                "portsDisjoint",
                "explicitSettings",
                "outputsDiscarded",
            },
            "BEGIN_REAL_CASES",
        )
        if not state.scripted_phase_cleaned or any(item[key] is not True for key in item if key != "type"):
            raise ValueError("real_phase_not_isolated")
        return replace(state, phase="real_cases_running", real_phase_started=True)

    if state.phase == "cleanup_pending":
        item = _event(
            event,
            {"cleanupVaultComplete", "retention", "orphanCountsZero"},
            "CLEANUP_VERIFIED",
        )
        retention = assert_retention_invariants(item["retention"])
        if (
            len(state.completed_cases) != len(CASE_IDS)
            or not state.scripted_phase_cleaned
            or not state.real_phase_started
            or not state.actual_gemini_observed
            or not state.actual_media_observed
            or item["cleanupVaultComplete"] is not True
            or item["orphanCountsZero"] is not True
            or retention["verified"] is not True
        ):
            raise ValueError("cleanup_not_verified")
        return replace(
            state,
            phase="cleanup_verified",
            cleanup_vault_complete=True,
            retention_verified=True,
        )

    if state.phase == "cleanup_verified":
        item = _event(
            event,
            {"evidenceEntries", "mcpEntries", "browserEntries", "manifest"},
            "EVIDENCE_SEALED",
        )
        evidence = verify_evidence_chain(item["evidenceEntries"])
        mcp = verify_mcp_chain(item["mcpEntries"])
        browser = verify_browser_chain(item["browserEntries"], item["evidenceEntries"])
        pinned_manifest_digest = manifest_digest(item["manifest"])
        if (
            evidence["entryCount"] != len(state.evidence_hashes)
            or evidence["tailHash"] != state.evidence_hashes[-1]
            or tuple(entry["hash"] for entry in item["evidenceEntries"]) != state.evidence_hashes
            or mcp["entryCount"] != state.mcp_sequence + 1
            or mcp["tailHash"] != state.mcp_tail_hash
            or browser["entryCount"] != 1
            or pinned_manifest_digest != state.manifest_digest
        ):
            raise ValueError("evidence_not_sealed")
        return replace(state, phase="evidence_sealed", browser_attestation_hash=browser["tailHash"])

    if state.phase == "evidence_sealed":
        _event(event, set(), "COMPLETE")
        if not state.manifest_verified or not state.production_negative_verified:
            raise ValueError("controller_completion_gate_failed")
        return replace(state, phase="completed")

    raise ValueError("controller_terminal_or_unknown_phase")


def _read_mac_key(fd: int) -> bytes:
    if type(fd) is not int or fd <= 2:
        raise TypeError("receipt_mac_fd_invalid")
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISFIFO(info.st_mode)):
        raise ValueError("receipt_mac_fd_type_invalid")
    if stat.S_ISREG(info.st_mode):
        os.lseek(fd, 0, os.SEEK_SET)
    key = os.read(fd, 4097)
    if not 16 <= len(key) <= 4096:
        raise ValueError("receipt_mac_key_invalid")
    return key


def controller_receipt(state: ControllerState, mac_key_fd: int) -> dict[str, Any]:
    if state.phase != "completed" or state.completed_cases != CASE_IDS:
        raise ValueError("controller_not_completed")
    if not state.cleanup_vault_complete or not state.retention_verified:
        raise ValueError("controller_cleanup_not_verified")
    if state.provider_attestation_hmac is None or state.media_attestation_hmac is None:
        raise ValueError("controller_real_attestation_not_verified")
    core = {
        "schemaVersion": "protected-e2e-receipt.v1",
        "controllerSchemaVersion": state.schema_version,
        "phase": "completed",
        "caseCount": len(state.completed_cases),
        "manifestVerified": state.manifest_verified,
        "productionNegativeVerified": state.production_negative_verified,
        "actualGeminiObserved": state.actual_gemini_observed,
        "actualMediaObserved": state.actual_media_observed,
        "providerAttestationHmac": state.provider_attestation_hmac,
        "mediaAttestationHmac": state.media_attestation_hmac,
        "manifestDigest": state.manifest_digest,
        "caseSetDigest": "sha256:" + _sha256(canonical_json(CASE_IDS).encode("ascii")),
        "evidenceEntryCount": len(state.evidence_hashes),
        "evidenceChainTail": state.evidence_hashes[-1],
        "mcpEntryCount": state.mcp_sequence + 1,
        "mcpChainTail": state.mcp_tail_hash,
        "browserEntryCount": 1,
        "browserChainTail": state.browser_attestation_hash,
        "migrationAttestationCount": len(state.migration_attestation_hashes),
        "scriptedPhaseCleaned": state.scripted_phase_cleaned,
        "realPhaseStarted": state.real_phase_started,
        "realSuccessesRetained": 1,
        "scriptedSessionsRetained": 0,
        "transientSessionsRemaining": 0,
        "temporaryAuthUsersRemaining": 0,
        "productionActions": 0,
        "prohibitedVisualArtifacts": 0,
    }
    key = _read_mac_key(mac_key_fd)
    return {**core, "receiptMac": "hmac-sha256:" + hmac.new(key, canonical_json(core).encode("ascii"), hashlib.sha256).hexdigest()}


def verify_controller_receipt(
    receipt: Any,
    *,
    mac_key_fd: int,
    evidence_entries: Any,
    mcp_entries: Any,
    browser_entries: Any,
    manifest: Any,
) -> dict[str, Any]:
    keys = {
        "schemaVersion",
        "controllerSchemaVersion",
        "phase",
        "caseCount",
        "manifestVerified",
        "productionNegativeVerified",
        "actualGeminiObserved",
        "actualMediaObserved",
        "providerAttestationHmac",
        "mediaAttestationHmac",
        "manifestDigest",
        "caseSetDigest",
        "evidenceEntryCount",
        "evidenceChainTail",
        "mcpEntryCount",
        "mcpChainTail",
        "browserEntryCount",
        "browserChainTail",
        "migrationAttestationCount",
        "scriptedPhaseCleaned",
        "realPhaseStarted",
        "realSuccessesRetained",
        "scriptedSessionsRetained",
        "transientSessionsRemaining",
        "temporaryAuthUsersRemaining",
        "productionActions",
        "prohibitedVisualArtifacts",
        "receiptMac",
    }
    item = _exact_mapping(receipt, keys, "controller_receipt")
    core = {key: item[key] for key in keys if key != "receiptMac"}
    key = _read_mac_key(mac_key_fd)
    expected_mac = "hmac-sha256:" + hmac.new(
        key,
        canonical_json(core).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not isinstance(item["receiptMac"], str) or not hmac.compare_digest(item["receiptMac"], expected_mac):
        raise ValueError("controller_receipt_mac_invalid")
    evidence = verify_evidence_chain(evidence_entries)
    mcp = verify_mcp_chain(mcp_entries)
    browser = verify_browser_chain(browser_entries, evidence_entries)
    expected_manifest_digest = manifest_digest(manifest)
    expected_case_set_digest = "sha256:" + _sha256(canonical_json(CASE_IDS).encode("ascii"))
    real_payload = evidence_entries[CASE_IDS.index("REAL-01")]["payload"]
    real_assertions = {assertion["id"]: assertion for assertion in real_payload["assertions"]}
    expected_provider_hmac = real_assertions["provider_attestation_hmac"]["hmac"]
    expected_media_hmac = real_assertions["media_attestation_hmac"]["hmac"]
    exact_counts = {
        "caseCount": len(CASE_IDS),
        "migrationAttestationCount": 2,
        "realSuccessesRetained": 1,
        "scriptedSessionsRetained": 0,
        "transientSessionsRemaining": 0,
        "temporaryAuthUsersRemaining": 0,
        "productionActions": 0,
        "prohibitedVisualArtifacts": 0,
    }
    if (
        item["schemaVersion"] != "protected-e2e-receipt.v1"
        or item["controllerSchemaVersion"] != "protected-e2e-controller.v1"
        or item["phase"] != "completed"
        or any(type(item[name]) is not int or item[name] != count for name, count in exact_counts.items())
        or any(
            item[name] is not True
            for name in (
                "manifestVerified",
                "productionNegativeVerified",
                "actualGeminiObserved",
                "actualMediaObserved",
                "scriptedPhaseCleaned",
                "realPhaseStarted",
            )
        )
        or item["manifestDigest"] != expected_manifest_digest
        or item["caseSetDigest"] != expected_case_set_digest
        or item["providerAttestationHmac"] != expected_provider_hmac
        or item["mediaAttestationHmac"] != expected_media_hmac
        or item["evidenceEntryCount"] != evidence["entryCount"]
        or item["evidenceChainTail"] != evidence["tailHash"]
        or item["mcpEntryCount"] != mcp["entryCount"]
        or item["mcpChainTail"] != mcp["tailHash"]
        or item["browserEntryCount"] != browser["entryCount"]
        or item["browserChainTail"] != browser["tailHash"]
    ):
        raise ValueError("controller_receipt_binding_invalid")
    return {
        "verified": True,
        "caseCount": len(CASE_IDS),
        "productionActions": 0,
        "prohibitedVisualArtifacts": 0,
        "actualGeminiObserved": True,
        "actualMediaObserved": True,
    }
