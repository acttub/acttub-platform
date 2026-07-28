from __future__ import annotations

import argparse
from collections.abc import Sequence
from datetime import datetime
import json
import logging
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    TypeAdapter,
    ValidationError,
)
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from acting_api.config import load_database_url
from acting_api.db.models import ConsentAction, ConsentType
from acting_api.db.store import PostgresStore

logger = logging.getLogger(__name__)


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsentDocument(_StrictResponse):
    id: UUID
    type: ConsentType
    version: str
    title: str
    body: str
    required: bool
    published_at: datetime


class ConsentDocumentsResponse(_StrictResponse):
    documents: list[ConsentDocument]


class ConsentEventResponse(_StrictResponse):
    id: UUID
    document_id: UUID
    action: ConsentAction
    occurred_at: datetime


def consent_document_payload(document) -> dict:
    return {
        "id": str(document.id),
        "type": getattr(document.type, "value", document.type),
        "version": document.version,
        "title": document.title,
        "body": document.body,
        "required": document.required,
        "published_at": document.published_at,
    }


class ConsentRequest(BaseModel):
    document_id: str
    action: ConsentAction


class _ConsentManifestEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str = Field(min_length=1)
    type: ConsentType
    version: str = Field(min_length=1)
    title: str = Field(min_length=1)
    required: StrictBool


def _is_consent_document_unique_error(exc: IntegrityError) -> bool:
    original = exc.orig
    diagnostic = getattr(original, "diag", None)
    return (
        getattr(original, "sqlstate", None) == "23505"
        and getattr(diagnostic, "constraint_name", None)
        == "uq_consent_documents_type_version"
    )


def seed_consent_documents(store, docs_dir: Path | None) -> int:
    if docs_dir is None or not docs_dir.is_dir():
        logger.warning("Consent documents directory is missing: %s", docs_dir)
        return 0
    manifest_path = docs_dir / "manifest.json"
    if not manifest_path.is_file():
        logger.warning("Consent documents manifest is missing: %s", manifest_path)
        return 0

    try:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = TypeAdapter(list[_ConsentManifestEntry]).validate_python(
            raw_manifest
        )
        validated = [
            (entry, (docs_dir / entry.file).read_text(encoding="utf-8"))
            for entry in entries
        ]
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        logger.error("Failed to validate consent documents: %s", exc)
        return 0

    published = 0
    for entry, body in validated:
        existing = store.get_consent_document_by_type_version(
            entry.type, entry.version
        )
        if existing is not None:
            mismatches = [
                field
                for field, expected in (
                    ("title", entry.title),
                    ("body", body),
                    ("required", entry.required),
                )
                if getattr(existing, field) != expected
            ]
            if mismatches:
                logger.warning(
                    "Consent document %s:%s differs in fields: %s; publish a new version",
                    entry.type.value,
                    entry.version,
                    ", ".join(mismatches),
                )
            continue
        try:
            store.publish_consent_document(
                type=entry.type,
                version=entry.version,
                title=entry.title,
                body=body,
                required=entry.required,
            )
        except IntegrityError as exc:
            if _is_consent_document_unique_error(exc):
                continue
            raise
        published += 1
    return published


def pending_required_documents(store, user_id) -> list:
    documents = store.list_latest_consent_documents()
    actions = {
        event.document_id: getattr(event.action, "value", event.action)
        for event in store.get_current_user_consents(user_id)
    }
    return [
        document
        for document in documents
        if document.required and actions.get(document.id) != "granted"
    ]


def build_router(*, store, rate_limited_user) -> APIRouter:
    router = APIRouter(prefix="/v2/consents", tags=["v2-consents"])

    @router.get(
        "/documents",
        responses={status.HTTP_200_OK: {"model": ConsentDocumentsResponse}},
    )
    async def list_documents():
        documents = await run_in_threadpool(store.list_latest_consent_documents)
        return {"documents": [consent_document_payload(row) for row in documents]}

    @router.get(
        "/pending",
        responses={status.HTTP_200_OK: {"model": ConsentDocumentsResponse}},
    )
    async def list_pending_documents(user=Depends(rate_limited_user)):
        documents = await run_in_threadpool(
            pending_required_documents, store, user.id
        )
        return {"documents": [consent_document_payload(row) for row in documents]}

    @router.post(
        "",
        status_code=status.HTTP_201_CREATED,
        responses={status.HTTP_201_CREATED: {"model": ConsentEventResponse}},
    )
    async def record_consent(
        payload: ConsentRequest, user=Depends(rate_limited_user)
    ):
        try:
            document_id = UUID(payload.document_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="consent_document_not_found") from exc
        document = await run_in_threadpool(store.get_consent_document, document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="consent_document_not_found")
        event = await run_in_threadpool(
            store.record_user_consent,
            user_id=user.id,
            document_id=document.id,
            action=payload.action,
        )
        return {
            "id": str(event.id),
            "document_id": str(event.document_id),
            "action": getattr(event.action, "value", event.action),
            "occurred_at": event.occurred_at,
        }

    return router


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Consent document management")
    commands = parser.add_subparsers(dest="command", required=True)
    publish = commands.add_parser("publish", help="publish a consent document")
    publish.add_argument("--type", required=True, choices=[item.value for item in ConsentType])
    publish.add_argument("--version", required=True)
    publish.add_argument("--title", required=True)
    publish.add_argument("--file", required=True, type=Path)
    publish.add_argument("--required", action="store_true")
    commands.add_parser("list", help="list all published consent documents")
    return parser


def _create_store() -> PostgresStore:
    return PostgresStore.from_url(load_database_url())


def main(argv: Sequence[str] | None = None, *, store=None) -> int:
    args = _parser().parse_args(argv)
    owns_store = store is None
    if store is None:
        store = _create_store()
    try:
        if args.command == "publish":
            body = args.file.read_text(encoding="utf-8")
            document = store.publish_consent_document(
                type=args.type,
                version=args.version,
                title=args.title,
                body=body,
                required=args.required,
            )
            print(f"id={document.id}")
            return 0

        print("id\ttype\tversion\ttitle\trequired\tpublished_at")
        for document in store.list_consent_documents():
            print(
                f"{document.id}\t{getattr(document.type, 'value', document.type)}\t"
                f"{document.version}\t{document.title}\t{document.required}\t"
                f"{document.published_at.isoformat()}"
            )
        return 0
    finally:
        if owns_store:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
