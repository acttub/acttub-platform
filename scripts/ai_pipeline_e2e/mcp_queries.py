"""Closed Supabase MCP request catalog for the protected development run.

Only the operations declared here may construct MCP tool arguments.  In
particular, callers select a catalog step; they never provide migration or SQL
text.  Project references and query bodies are private values and are excluded
from representations.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Final


MIGRATION_PRE_LEDGER: Final = (
    "001_acttub_slice1_schema",
    "002_remove_legacy_practice_generation",
    "003_atomic_dialogue_turn_append",
    "004_ai_pipeline_data_plane",
    "005_close_ai_table_select_privilege_gaps",
    "006_pipeline_security_advisor_hardening",
    "007_ai_pipeline_unknown_turn_count",
    "008_ai_pipeline_session_delete_upload_intent_cleanup",
)
MIGRATION_009_NAME: Final = "009_ai_pipeline_contract_hardening"
MIGRATION_010_NAME: Final = "010_ai_pipeline_optional_note"
MIGRATION_AFTER_009_LEDGER: Final = MIGRATION_PRE_LEDGER + (MIGRATION_009_NAME,)
MIGRATION_POST_LEDGER: Final = MIGRATION_AFTER_009_LEDGER + (MIGRATION_010_NAME,)

_PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True, slots=True)
class MigrationSource:
    logical_version: str
    name: str
    relative_path: str
    sha256: str


MIGRATIONS = MappingProxyType(
    {
        "009": MigrationSource(
            logical_version="009",
            name=MIGRATION_009_NAME,
            relative_path="supabase/migrations/009_ai_pipeline_contract_hardening.sql",
            sha256="52b3bb57ad2eefdb1a22f928489049b9657bb1bff30fa37c55cc3d6ece7c60ff",
        ),
        "010": MigrationSource(
            logical_version="010",
            name=MIGRATION_010_NAME,
            relative_path="supabase/migrations/010_ai_pipeline_optional_note.sql",
            sha256="b57909e6ff63d3d564de35881a5c21cd46687bb5c1b3d1f5c0eabd98678dc89b",
        ),
    }
)


# These checks read PostgreSQL catalog metadata only.  Each query returns one
# fixed-shape row so the raw database response can be reduced to booleans/counts.
POSTCONDITION_009_SQL: Final = """with checks(passed) as (
  values
    (exists (
      select 1 from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ai_runs'
        and a.attname = 'request_payload_fingerprint'
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'text'
        and not a.attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ai_runs'
        and a.attname = 'response_payload'
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'jsonb'
        and not a.attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ai_runs'
        and con.conname = 'ai_runs_request_payload_fingerprint_lower_hex'
        and con.convalidated
    )),
    (pg_catalog.to_regprocedure('public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text)') is not null),
    (pg_catalog.to_regprocedure('public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text)') is not null),
    (pg_catalog.to_regprocedure('public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text)') is not null),
    (pg_catalog.to_regprocedure('public.acttub_fail_ai_run(uuid,uuid,uuid,text,boolean)') is not null),
    (pg_catalog.to_regprocedure('public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text)') is null),
    (pg_catalog.to_regprocedure('public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb)') is null),
    (pg_catalog.to_regprocedure('public.acttub_complete_report_run(uuid,uuid,uuid,jsonb)') is null),
    (not exists (
      select 1
      from (values
        ('public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text)'),
        ('public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text)'),
        ('public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text)'),
        ('public.acttub_fail_ai_run(uuid,uuid,uuid,text,boolean)')
      ) required(signature)
      where pg_catalog.to_regprocedure(signature) is null
         or not coalesce(pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure(signature), 'EXECUTE'), false)
         or coalesce(pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(signature), 'EXECUTE'), true)
         or coalesce(pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(signature), 'EXECUTE'), true)
    ))
)
select coalesce(pg_catalog.bool_and(passed), false) as passed,
       pg_catalog.count(*)::integer as row_count
from checks"""

POSTCONDITION_010_SQL: Final = """with checks(passed) as (
  values
    (exists (
      select 1 from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'interview_turns'
        and con.conname = 'interview_turns_optional_note_shape_check'
        and con.convalidated
    )),
    (exists (
      select 1 from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'interview_turns_one_optional_note_per_session_idx'
        and i.indisunique and i.indisvalid and i.indpred is not null
    )),
    (pg_catalog.to_regprocedure('public.acttub_put_optional_note(uuid,uuid,uuid,text)') is not null),
    (coalesce(pg_catalog.has_function_privilege('service_role', pg_catalog.to_regprocedure('public.acttub_put_optional_note(uuid,uuid,uuid,text)'), 'EXECUTE'), false)),
    (not coalesce(pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.acttub_put_optional_note(uuid,uuid,uuid,text)'), 'EXECUTE'), true)),
    (not coalesce(pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.acttub_put_optional_note(uuid,uuid,uuid,text)'), 'EXECUTE'), true))
)
select coalesce(pg_catalog.bool_and(passed), false) as passed,
       pg_catalog.count(*)::integer as row_count
from checks"""


@dataclass(frozen=True, slots=True)
class CatalogStep:
    key: str
    tool: str
    mutation: bool
    expected_ledger: tuple[str, ...] | None = None
    migration_version: str | None = None
    query: str | None = field(default=None, repr=False)


CATALOG = MappingProxyType(
    {
        "inventory_projects": CatalogStep("inventory_projects", "list_projects", False),
        "migration_ledger_pre": CatalogStep(
            "migration_ledger_pre", "list_migrations", False, MIGRATION_PRE_LEDGER
        ),
        "apply_migration_009": CatalogStep(
            "apply_migration_009", "apply_migration", True, migration_version="009"
        ),
        "postcondition_009": CatalogStep(
            "postcondition_009", "execute_sql", False, query=POSTCONDITION_009_SQL
        ),
        "migration_ledger_after_009": CatalogStep(
            "migration_ledger_after_009", "list_migrations", False, MIGRATION_AFTER_009_LEDGER
        ),
        "apply_migration_010": CatalogStep(
            "apply_migration_010", "apply_migration", True, migration_version="010"
        ),
        "postcondition_010": CatalogStep(
            "postcondition_010", "execute_sql", False, query=POSTCONDITION_010_SQL
        ),
        "migration_ledger_post": CatalogStep(
            "migration_ledger_post", "list_migrations", False, MIGRATION_POST_LEDGER
        ),
    }
)

RECONCILIATION_STEPS = MappingProxyType(
    {
        "009": MappingProxyType(
            {
                False: ("postcondition_009", "migration_ledger_pre"),
                True: ("postcondition_009", "migration_ledger_after_009"),
            }
        ),
        "010": MappingProxyType(
            {
                False: ("postcondition_010", "migration_ledger_after_009"),
                True: ("postcondition_010", "migration_ledger_post"),
            }
        ),
    }
)


class CatalogRejected(ValueError):
    """Fixed rejection that never includes a project reference, path, or query."""

    def __init__(self, code: str = "MCP_CATALOG_INVALID") -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class PrivateToolRequest:
    step: str
    tool: str
    project_id: str | None = field(repr=False)
    name: str | None = None
    query: str | None = field(default=None, repr=False)

    def tool_arguments(self) -> dict[str, str]:
        if self.tool == "list_projects":
            return {}
        if self.project_id is None:
            raise CatalogRejected()
        if self.tool == "list_migrations":
            return {"project_id": self.project_id}
        if self.tool == "apply_migration" and self.name is not None and self.query is not None:
            return {"project_id": self.project_id, "name": self.name, "query": self.query}
        if self.tool == "execute_sql" and self.query is not None:
            return {"project_id": self.project_id, "query": self.query}
        raise CatalogRejected()


def _load_pinned_migration(version: str) -> str:
    source = MIGRATIONS.get(version)
    if source is None:
        raise CatalogRejected()
    path = _REPOSITORY_ROOT / source.relative_path
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise CatalogRejected("MCP_MIGRATION_SOURCE_INVALID") from error
    if hashlib.sha256(raw).hexdigest() != source.sha256:
        raise CatalogRejected("MCP_MIGRATION_SOURCE_INVALID")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CatalogRejected("MCP_MIGRATION_SOURCE_INVALID") from error


def build_private_request(step: str, project_id: str | None = None) -> PrivateToolRequest:
    """Build one fixed catalog request; query text is never accepted from callers."""

    spec = CATALOG.get(step)
    if spec is None:
        raise CatalogRejected()
    if spec.tool == "list_projects":
        if project_id is not None:
            raise CatalogRejected()
        return PrivateToolRequest(step=step, tool=spec.tool, project_id=None)
    if not isinstance(project_id, str) or _PROJECT_REF.fullmatch(project_id) is None:
        raise CatalogRejected("MCP_TARGET_INVALID")
    if spec.migration_version is not None:
        source = MIGRATIONS[spec.migration_version]
        return PrivateToolRequest(
            step=step,
            tool=spec.tool,
            project_id=project_id,
            name=source.name,
            query=_load_pinned_migration(spec.migration_version),
        )
    return PrivateToolRequest(
        step=step,
        tool=spec.tool,
        project_id=project_id,
        query=spec.query,
    )


def expected_ledger(step: str) -> tuple[str, ...]:
    spec = CATALOG.get(step)
    if spec is None or spec.expected_ledger is None:
        raise CatalogRejected()
    return spec.expected_ledger


def build_reconciliation_requests(
    version: str,
    project_id: str,
    *,
    effect_present: bool,
) -> tuple[PrivateToolRequest, PrivateToolRequest]:
    """Build the exact read-only postcondition and ledger probes after UNKNOWN."""

    return (
        build_reconciliation_postcondition_request(version, project_id),
        build_reconciliation_ledger_request(
            version,
            project_id,
            effect_present=effect_present,
        ),
    )


def _reconciliation_steps(version: str, effect_present: bool) -> tuple[str, str]:
    if type(effect_present) is not bool:
        raise CatalogRejected("MCP_RECONCILIATION_INVALID")
    by_effect = RECONCILIATION_STEPS.get(version)
    if by_effect is None:
        raise CatalogRejected("MCP_RECONCILIATION_INVALID")
    return by_effect[effect_present]


def build_reconciliation_postcondition_request(
    version: str,
    project_id: str,
) -> PrivateToolRequest:
    """Build the first read-only probe used to determine UNKNOWN effect state."""

    postcondition_step, alternate = _reconciliation_steps(version, False)
    if postcondition_step != _reconciliation_steps(version, True)[0] or alternate == postcondition_step:
        raise CatalogRejected("MCP_RECONCILIATION_INVALID")
    request = build_private_request(postcondition_step, project_id)
    if CATALOG[request.step].mutation or request.tool != "execute_sql":
        raise CatalogRejected("MCP_RECONCILIATION_INVALID")
    return request


def build_reconciliation_ledger_request(
    version: str,
    project_id: str,
    *,
    effect_present: bool,
) -> PrivateToolRequest:
    """Build the second read-only ledger probe selected from the observed effect."""

    _postcondition_step, ledger_step = _reconciliation_steps(version, effect_present)
    request = build_private_request(ledger_step, project_id)
    if CATALOG[request.step].mutation or request.tool != "list_migrations":
        raise CatalogRejected("MCP_RECONCILIATION_INVALID")
    return request
