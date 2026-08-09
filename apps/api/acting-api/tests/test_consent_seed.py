from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from acting_api.app import create_app
from acting_api.config import GatewaySettings
from acting_api.consents import seed_consent_documents
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from auth_test_support import FakeAuthStore


MANIFEST = [
    {
        "file": "terms_v1.md",
        "type": "terms",
        "version": "v1",
        "title": "이용약관",
        "required": True,
    },
    {
        "file": "privacy_v3.md",
        "type": "privacy",
        "version": "v3",
        "title": "개인정보처리방침",
        "required": True,
    },
    {
        "file": "ai_analysis_v1.md",
        "type": "ai_analysis",
        "version": "v1",
        "title": "AI 분석 동의",
        "required": True,
    },
]


def _write_docs(docs_dir: Path, manifest=MANIFEST) -> None:
    docs_dir.mkdir()
    (docs_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    for item in manifest:
        (docs_dir / item["file"]).write_text(
            f"# {item['title']}\n", encoding="utf-8"
        )


def _integrity_error(*, sqlstate: str, constraint_name: str) -> IntegrityError:
    return IntegrityError(
        "insert consent document",
        {},
        SimpleNamespace(
            sqlstate=sqlstate,
            diag=SimpleNamespace(constraint_name=constraint_name),
        ),
    )


def test_committed_manifest_matches_the_three_required_documents():
    manifest_path = Path(__file__).resolve().parents[1] / "consent_docs/manifest.json"

    assert json.loads(manifest_path.read_text(encoding="utf-8")) == MANIFEST


def test_seed_publishes_once_and_is_idempotent(tmp_path):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir)
    store = FakeAuthStore()

    assert seed_consent_documents(store, docs_dir) == 3
    assert seed_consent_documents(store, docs_dir) == 0
    assert len(store.list_consent_documents()) == 3


def test_seed_missing_manifest_is_non_fatal_and_warns(tmp_path, caplog):
    store = FakeAuthStore()

    assert seed_consent_documents(store, tmp_path / "missing") == 0

    assert store.list_consent_documents() == []
    assert "manifest" in caplog.text


def test_seed_validates_every_file_before_publishing(tmp_path, caplog):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir)
    (docs_dir / "privacy_v3.md").unlink()
    store = FakeAuthStore()

    assert seed_consent_documents(store, docs_dir) == 0

    assert store.list_consent_documents() == []
    assert "privacy_v3.md" in caplog.text


def test_seed_warns_when_existing_document_content_differs(tmp_path, caplog):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir)
    store = FakeAuthStore()
    assert seed_consent_documents(store, docs_dir) == 3
    changed = [dict(item) for item in MANIFEST]
    changed[0]["title"] = "수정된 이용약관"
    changed[0]["required"] = False
    (docs_dir / "manifest.json").write_text(
        json.dumps(changed, ensure_ascii=False), encoding="utf-8"
    )
    (docs_dir / "terms_v1.md").write_text("# 수정된 본문\n", encoding="utf-8")

    assert seed_consent_documents(store, docs_dir) == 0

    assert "terms:v1" in caplog.text
    assert "title" in caplog.text
    assert "body" in caplog.text
    assert "required" in caplog.text


def test_seed_ignores_only_the_consent_type_version_unique_race(tmp_path):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir, MANIFEST[:1])

    class RacingStore(FakeAuthStore):
        def get_consent_document_by_type_version(self, type, version):
            return None

        def publish_consent_document(self, **kwargs):
            raise _integrity_error(
                sqlstate="23505",
                constraint_name="uq_consent_documents_type_version",
            )

    assert seed_consent_documents(RacingStore(), docs_dir) == 0


def test_seed_reraises_unrelated_integrity_errors(tmp_path):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir, MANIFEST[:1])

    class BrokenStore(FakeAuthStore):
        def get_consent_document_by_type_version(self, type, version):
            return None

        def publish_consent_document(self, **kwargs):
            raise _integrity_error(
                sqlstate="23503",
                constraint_name="consent_documents_unrelated_fkey",
            )

    with pytest.raises(IntegrityError):
        seed_consent_documents(BrokenStore(), docs_dir)


def test_app_lifespan_seeds_documents_idempotently(tmp_path):
    docs_dir = tmp_path / "consent_docs"
    _write_docs(docs_dir)
    store = FakeAuthStore()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="seed-test-secret",
            consent_docs_dir=docs_dir,
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        store=store,
    )

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    with TestClient(app):
        pass

    assert len(store.list_consent_documents()) == 3


def test_app_lifespan_continues_when_manifest_is_missing(tmp_path):
    store = FakeAuthStore()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="seed-test-secret",
            consent_docs_dir=tmp_path / "missing",
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        store=store,
    )

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
