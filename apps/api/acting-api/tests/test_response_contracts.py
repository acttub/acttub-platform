from __future__ import annotations

import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from pydantic import BaseModel, TypeAdapter

from acting_agent.config import Settings as AgentSettings
from acting_api import app as app_module
from acting_api import coaching, consents, practice_sessions, reports, uploads
from acting_api.analysis_worker import AnalysisResult, AnalysisWorker
from acting_api.app import create_app
from acting_api.auth import router as auth_router
from acting_api.auth.providers import ProviderRegistry
from acting_api.config import GatewaySettings
from acting_api.db.models import OperationStatus, PracticeStatus
from acting_api.storage import S3Storage
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import (
    COACH_FOLLOWUP,
    COACH_QUESTION,
    REPORT,
    SUMMARY,
    FakeClient,
    FakeModelResponse,
)
from auth_test_support import FakeProviderVerifier
from platform_test_support import FakeBotoS3Client, FakePlatformStore

SPEC_PATH = Path(__file__).resolve().parents[2] / "spec" / "openapi.json"
JWT_SECRET = "response-contract-test-secret"

SUCCESS_RESPONSE_MODELS = {
    ("get", "/health", "200"): "HealthResponse",
    ("post", "/v2/auth/login", "200"): "TokenPairResponse",
    ("post", "/v2/auth/refresh", "200"): "RefreshTokenResponse",
    ("get", "/v2/consents/documents", "200"): "ConsentDocumentsResponse",
    ("post", "/v2/consents", "201"): "ConsentEventResponse",
    ("post", "/v2/uploads/intents", "201"): "UploadIntentResponse",
    (
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        "200",
    ): "UploadCompleteResponse",
    ("post", "/v2/practice-sessions", "200"): "PracticeSessionCreateResponse",
    (
        "post",
        "/v2/practice-sessions",
        "202",
    ): "PracticeSessionAcceptedResponse",
    ("get", "/v2/practice-sessions", "200"): "PracticeSessionListResponse",
    (
        "get",
        "/v2/practice-sessions/{session_id}",
        "200",
    ): "PracticeSessionDetail",
    (
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        "200",
    ): "PracticeSessionCreateResponse",
    (
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        "202",
    ): "PracticeSessionAcceptedResponse",
    ("post", "/v2/coach/start", "200"): "CoachTurnResponse",
    ("post", "/v2/coach/reply", "200"): "CoachTurnResponse",
    ("post", "/v2/reports", "200"): "CreateReportResponse",
    ("get", "/v2/reports", "200"): "ReportHistoryResponse",
    (
        "get",
        "/v2/reports/{practice_session_id}",
        "200",
    ): "ReportDetailResponse",
}

RESPONSE_COMPONENT_SHAPES = {
    "ActingReport": {
        "required": {
            "headline",
            "biggest_problem",
            "evidence",
            "self_discovery",
            "encouragement",
            "next_step",
            "comparison",
        },
    },
    "AuthUser": {"required": {"id", "email", "status"}},
    "BiggestProblem": {
        "required": {"start", "end", "dimension", "description"},
    },
    "CoachTurnResponse": {
        "required": {
            "session_id",
            "action",
            "utterance",
            "focus_timestamp",
            "done",
            "reason",
        },
    },
    "ConsentDocument": {
        "required": {
            "id",
            "type",
            "version",
            "title",
            "body",
            "required",
            "published_at",
        },
    },
    "ConsentDocumentsResponse": {"required": {"documents"}},
    "ConsentEventResponse": {
        "required": {"id", "document_id", "action", "occurred_at"},
    },
    "CreateReportResponse": {"required": {"report", "report_count"}},
    "HealthResponse": {
        "required": {"status", "services", "model", "keep_alive", "commit"},
    },
    "PracticeSessionAcceptedResponse": {
        "required": {"session_id", "status"},
    },
    "PracticeSessionCreateResponse": {
        "required": {"session_id", "status"},
        "optional": {"summary_id"},
    },
    "PracticeSessionDetail": {
        "required": {
            "session_id",
            "status",
            "situation",
            "character_context",
            "subtext",
            "created_at",
            "updated_at",
            "playback_url",
        },
        "optional": {"summary", "error_code"},
    },
    "PracticeSessionListItem": {
        "required": {
            "session_id",
            "status",
            "situation",
            "character_context",
            "subtext",
            "created_at",
            "updated_at",
        },
    },
    "PracticeSessionListResponse": {"required": {"sessions"}},
    "RefreshTokenResponse": {
        "required": {"access_token", "refresh_token", "token_type", "expires_in"},
    },
    "ReportHistoryResponse": {"required": {"count", "reports"}},
    "ReportDetailResponse": {
        "required": {
            "practice_session_id",
            "created_at",
            "report",
            "playback_url",
        },
    },
    "ReportRecord": {
        "required": {"practice_session_id", "headline", "created_at"},
    },
    "SceneSummary": {
        "required": {"summary_id"},
        "optional": {
            "observation",
            "summary",
            "intent_alignment",
            "key_moment",
            "key_dimension",
            "anomalies",
        },
        "allows_extra": True,
    },
    "TokenPairResponse": {
        "required": {
            "access_token",
            "refresh_token",
            "token_type",
            "expires_in",
            "user",
            "pending_consents",
        },
    },
    "UploadCompleteResponse": {"required": {"intent_id", "status"}},
    "UploadIntentResponse": {
        "required": {"intent_id", "upload_url", "expires_at"},
    },
}

RESPONSE_MODEL_LOCATIONS: dict[str, tuple[ModuleType, str]] = {
    "HealthResponse": (app_module, "HealthResponse"),
    "TokenPairResponse": (auth_router, "TokenPairResponse"),
    "RefreshTokenResponse": (auth_router, "RefreshTokenResponse"),
    "ConsentDocumentsResponse": (consents, "ConsentDocumentsResponse"),
    "ConsentEventResponse": (consents, "ConsentEventResponse"),
    "UploadIntentResponse": (uploads, "UploadIntentResponse"),
    "UploadCompleteResponse": (uploads, "UploadCompleteResponse"),
    "PracticeSessionCreateResponse": (
        practice_sessions,
        "PracticeSessionCreateResponse",
    ),
    "PracticeSessionAcceptedResponse": (
        practice_sessions,
        "PracticeSessionAcceptedResponse",
    ),
    "PracticeSessionListResponse": (
        practice_sessions,
        "PracticeSessionListResponse",
    ),
    "PracticeSessionDetail": (practice_sessions, "PracticeSessionDetail"),
    "CoachTurnResponse": (coaching, "CoachTurnResponse"),
    "CreateReportResponse": (reports, "CreateReportResponse"),
    "ReportHistoryResponse": (reports, "ReportHistoryResponse"),
    "ReportDetailResponse": (reports, "ReportDetailResponse"),
}


def _application():
    store = FakePlatformStore()
    boto_client = FakeBotoS3Client()
    storage = S3Storage(bucket="videos", client=boto_client)
    verifier = FakeProviderVerifier()
    verifier.add(
        "provider-token",
        provider_uid="response-contract-user",
        email="actor@example.com",
        email_verified=True,
    )
    fake_client = FakeClient(
        [
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=COACH_FOLLOWUP),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    app = create_app(
        client=fake_client,
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="summary-model"),
        agent_settings=AgentSettings(api_key="k", model="coach-model"),
        report_settings=ReportSettings(api_key="k", model="report-model"),
        store=store,
        provider_registry=ProviderRegistry([verifier]),
        s3_storage=storage,
    )
    return app, store, boto_client


def _json_success_responses(openapi: dict) -> set[tuple[str, str, str]]:
    responses = set()
    for path, path_item in openapi["paths"].items():
        for method, operation in path_item.items():
            if method not in {
                "get",
                "put",
                "post",
                "delete",
                "options",
                "head",
                "patch",
                "trace",
            }:
                continue
            for status_code, response in operation["responses"].items():
                if status_code.startswith("2") and "application/json" in response.get(
                    "content", {}
                ):
                    responses.add((method, path, status_code))
    return responses


def _resolve_refs(value, openapi: dict, seen: frozenset[str] = frozenset()):
    if isinstance(value, list):
        return [_resolve_refs(item, openapi, seen) for item in value]
    if not isinstance(value, dict):
        return value
    if "$ref" in value:
        reference = value["$ref"]
        assert reference not in seen, f"circular OpenAPI reference: {reference}"
        assert reference.startswith("#/"), f"external OpenAPI reference: {reference}"
        target = openapi
        for segment in reference.removeprefix("#/").split("/"):
            target = target[segment.replace("~1", "/").replace("~0", "~")]
        siblings = {key: item for key, item in value.items() if key != "$ref"}
        return _resolve_refs(
            {**target, **siblings},
            openapi,
            seen | {reference},
        )
    return {
        key: _resolve_refs(item, openapi, seen)
        for key, item in value.items()
    }


def _response_models() -> dict[str, type[BaseModel]]:
    loaded = {}
    for name, (module, attribute) in RESPONSE_MODEL_LOCATIONS.items():
        assert hasattr(module, attribute), f"missing response model: {name}"
        loaded[name] = getattr(module, attribute)
    return loaded


def _assert_contract(
    response,
    status_code: int,
    model: type[BaseModel],
) -> None:
    assert response.status_code == status_code
    TypeAdapter(model).validate_json(response.content, strict=True)


def test_success_response_schema_matrix_is_complete_and_concrete():
    app, _, _ = _application()
    openapi = app.openapi()

    assert _json_success_responses(openapi) == set(SUCCESS_RESPONSE_MODELS)
    for (method, path, status_code), model_name in SUCCESS_RESPONSE_MODELS.items():
        schema = openapi["paths"][path][method]["responses"][status_code][
            "content"
        ]["application/json"]["schema"]
        assert schema == {"$ref": f"#/components/schemas/{model_name}"}
        resolved = _resolve_refs(schema, openapi)
        assert "$ref" not in json.dumps(resolved)
        assert resolved.get("type") == "object"
        assert resolved.get("properties")
        assert resolved.get("additionalProperties") is False

    for model_name, expected in RESPONSE_COMPONENT_SHAPES.items():
        schema = openapi["components"]["schemas"][model_name]
        expected_properties = expected["required"] | expected.get("optional", set())
        assert set(schema["properties"]) == expected_properties
        assert set(schema.get("required", [])) == expected["required"]
        assert schema.get("additionalProperties") is expected.get(
            "allows_extra",
            False,
        )


def test_live_openapi_matches_committed_spec():
    app, _, _ = _application()

    assert app.openapi() == json.loads(SPEC_PATH.read_text(encoding="utf-8"))


def test_declared_response_models_validate_real_success_payloads_and_replays():
    models = _response_models()
    app, store, boto_client = _application()
    client = TestClient(app)

    health = client.get("/health")
    _assert_contract(health, 200, models["HealthResponse"])

    document = store.publish_consent_document(
        type="terms",
        version="1",
        title="Terms",
        body="# Terms",
        required=True,
    )
    documents = client.get("/v2/consents/documents")
    _assert_contract(documents, 200, models["ConsentDocumentsResponse"])

    login = client.post(
        "/v2/auth/login",
        json={"provider": "google", "id_token": "provider-token"},
    )
    _assert_contract(login, 200, models["TokenPairResponse"])
    login_payload = login.json()
    headers = {"Authorization": f"Bearer {login_payload['access_token']}"}

    refreshed = client.post(
        "/v2/auth/refresh",
        json={"refresh_token": login_payload["refresh_token"]},
    )
    _assert_contract(refreshed, 200, models["RefreshTokenResponse"])

    consent = client.post(
        "/v2/consents",
        json={"document_id": str(document.id), "action": "granted"},
        headers=headers,
    )
    _assert_contract(consent, 201, models["ConsentEventResponse"])

    intent_response = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12, "duration_ms": 1000},
        headers=headers,
    )
    _assert_contract(intent_response, 201, models["UploadIntentResponse"])
    intent = store.uploads[UUID(intent_response.json()["intent_id"])]
    boto_client.put(
        bucket="videos",
        key=intent.object_key,
        content=b"x" * intent.size_bytes,
    )
    completed = client.post(
        f"/v2/uploads/intents/{intent.id}/complete",
        headers=headers,
    )
    _assert_contract(completed, 200, models["UploadCompleteResponse"])

    session_request_id = uuid4()
    session_body = {
        "upload_intent_id": str(intent.id),
        "situation": "오디션 직전",
        "character_context": "불안한 배우",
        "subtext": "침착한 척한다",
    }
    session_headers = {**headers, "X-Request-Id": str(session_request_id)}
    accepted = client.post(
        "/v2/practice-sessions",
        json=session_body,
        headers=session_headers,
    )
    _assert_contract(accepted, 202, models["PracticeSessionAcceptedResponse"])
    accepted_replay = client.post(
        "/v2/practice-sessions",
        json=session_body,
        headers=session_headers,
    )
    _assert_contract(
        accepted_replay,
        202,
        models["PracticeSessionAcceptedResponse"],
    )
    assert accepted_replay.content == accepted.content

    session_id = UUID(accepted.json()["session_id"])
    session = store.sessions[session_id]
    analysis_worker = AnalysisWorker(
        store=store,
        storage=app.state.s3_storage,
        analyzer=SimpleNamespace(
            analyze=lambda _video_path, _session: AnalysisResult(
                summary=SUMMARY,
                was_compressed=False,
            )
        ),
        model="summary-model",
    )
    assert analysis_worker.run_once() is True

    operation = store.get_external_operation(
        user_id=session.user_id,
        request_id=session_request_id,
    )
    assert session.status == PracticeStatus.ANALYZED
    assert operation.status == OperationStatus.SUCCEEDED
    assert operation.attempt_count == 1
    persisted_payload = operation.response_payload
    assert persisted_payload is not None
    summary_id = UUID(persisted_payload["summary_id"])
    assert summary_id in store.summaries

    succeeded_replay = client.post(
        "/v2/practice-sessions",
        json=session_body,
        headers=session_headers,
    )
    _assert_contract(
        succeeded_replay,
        200,
        models["PracticeSessionCreateResponse"],
    )
    assert succeeded_replay.json() == persisted_payload
    second_succeeded_replay = client.post(
        "/v2/practice-sessions",
        json=session_body,
        headers=session_headers,
    )
    _assert_contract(
        second_succeeded_replay,
        200,
        models["PracticeSessionCreateResponse"],
    )
    assert second_succeeded_replay.content == succeeded_replay.content

    listed = client.get("/v2/practice-sessions", headers=headers)
    _assert_contract(listed, 200, models["PracticeSessionListResponse"])
    detail = client.get(f"/v2/practice-sessions/{session_id}", headers=headers)
    _assert_contract(detail, 200, models["PracticeSessionDetail"])

    session.status = PracticeStatus.FAILED
    operation.error_code = "gemini_timeout"
    failed_detail = client.get(
        f"/v2/practice-sessions/{session_id}",
        headers=headers,
    )
    _assert_contract(failed_detail, 200, models["PracticeSessionDetail"])
    retry_request_id = uuid4()
    retry_headers = {**headers, "X-Request-Id": str(retry_request_id)}
    retry_path = f"/v2/practice-sessions/{session_id}/analyze"
    retry_accepted = client.post(retry_path, headers=retry_headers)
    _assert_contract(
        retry_accepted,
        202,
        models["PracticeSessionAcceptedResponse"],
    )
    retry_operation = store.get_external_operation(
        user_id=session.user_id,
        request_id=retry_request_id,
    )
    session.status = PracticeStatus.ANALYZED
    retry_operation.status = OperationStatus.SUCCEEDED
    retry_operation.response_payload = None
    retry_succeeded_replay = client.post(retry_path, headers=retry_headers)
    _assert_contract(
        retry_succeeded_replay,
        200,
        models["PracticeSessionCreateResponse"],
    )

    coach_start_request_id = uuid4()
    coach_start_headers = {
        **headers,
        "X-Request-Id": str(coach_start_request_id),
    }
    coach_start_body = {"summary_id": str(summary_id)}
    coach_start = client.post(
        "/v2/coach/start",
        json=coach_start_body,
        headers=coach_start_headers,
    )
    _assert_contract(coach_start, 200, models["CoachTurnResponse"])
    coach_start_replay = client.post(
        "/v2/coach/start",
        json=coach_start_body,
        headers=coach_start_headers,
    )
    _assert_contract(coach_start_replay, 200, models["CoachTurnResponse"])
    assert coach_start_replay.content == coach_start.content

    coach_session_id = coach_start.json()["session_id"]
    coach_reply_request_id = uuid4()
    coach_reply_headers = {
        **headers,
        "X-Request-Id": str(coach_reply_request_id),
    }
    coach_reply_body = {
        "session_id": coach_session_id,
        "text": "대사가 기억 안 났어요",
    }
    coach_reply = client.post(
        "/v2/coach/reply",
        json=coach_reply_body,
        headers=coach_reply_headers,
    )
    _assert_contract(coach_reply, 200, models["CoachTurnResponse"])
    coach_reply_replay = client.post(
        "/v2/coach/reply",
        json=coach_reply_body,
        headers=coach_reply_headers,
    )
    _assert_contract(coach_reply_replay, 200, models["CoachTurnResponse"])
    assert coach_reply_replay.content == coach_reply.content
    coach_close = client.post(
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": "그만할래"},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )
    _assert_contract(coach_close, 200, models["CoachTurnResponse"])

    report_request_id = uuid4()
    report_headers = {**headers, "X-Request-Id": str(report_request_id)}
    report_body = {"session_id": coach_session_id}
    created_report = client.post(
        "/v2/reports",
        json=report_body,
        headers=report_headers,
    )
    _assert_contract(created_report, 200, models["CreateReportResponse"])
    report_replay = client.post(
        "/v2/reports",
        json=report_body,
        headers=report_headers,
    )
    _assert_contract(report_replay, 200, models["CreateReportResponse"])
    assert report_replay.content == created_report.content
    history = client.get("/v2/reports", headers=headers)
    _assert_contract(history, 200, models["ReportHistoryResponse"])
    report_detail = client.get(
        f"/v2/reports/{session_id}",
        headers=headers,
    )
    _assert_contract(report_detail, 200, models["ReportDetailResponse"])

    deleted = client.delete(f"/v2/practice-sessions/{session_id}", headers=headers)
    assert deleted.status_code == 204
    logged_out = client.post(
        "/v2/auth/logout",
        json={"refresh_token": refreshed.json()["refresh_token"]},
        headers=headers,
    )
    assert logged_out.status_code == 204
