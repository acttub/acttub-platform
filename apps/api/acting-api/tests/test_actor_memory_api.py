"""배우 기억 화면이 쓰는 엔드포인트.

이 화면이 이 기능의 안전판이다 — 에이전트가 잘못 적은 것을 되돌릴 경로가 여기
밖에 없다. 그래서 "배우가 고친 칸은 이후 에이전트가 덮지 않는다" 가 API 를 통해
실제로 지켜지는지까지 본다.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_api.db.models import ActorMemoryField
from acting_api.storage import S3Storage
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from platform_test_support import FakeBotoS3Client, FakePlatformStore

JWT_SECRET = "actor-memory-test-secret"


def _application():
    store = FakePlatformStore()
    storage = S3Storage(bucket="videos", client=FakeBotoS3Client())
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="model-test"),
        store=store,
        s3_storage=storage,
    )
    user = store.create_user()
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    return TestClient(app), store, user, {"Authorization": f"Bearer {access}"}


def test_memory_starts_empty_and_returns_what_the_actor_writes():
    client, _store, _user, headers = _application()

    assert client.get("/v2/me/memory", headers=headers).json() == {"items": []}

    response = client.put(
        "/v2/me/memory/gender", json={"value": "여성"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json() == {
        "field": "gender",
        "value": "여성",
        "edited_by_me": True,
        "source_practice_session_id": None,
    }

    listed = client.get("/v2/me/memory", headers=headers).json()["items"]
    assert [item["field"] for item in listed] == ["gender"]


def test_actor_edit_wins_and_the_agent_stops_overwriting_that_field():
    """이 기능의 핵심 규칙이 API 를 통해서도 지켜지는지 본다."""
    client, store, user, headers = _application()
    practice_id = uuid4()

    # 에이전트가 먼저 적는다.
    store.write_actor_memory_as_agent(
        user_id=user.id,
        field=ActorMemoryField.GOAL,
        value="입시 준비",
        source_practice_session_id=practice_id,
    )
    item = client.get("/v2/me/memory", headers=headers).json()["items"][0]
    assert item["edited_by_me"] is False
    assert item["source_practice_session_id"] == str(practice_id)

    # 배우가 고친다.
    client.put("/v2/me/memory/goal", json={"value": "취미로 한다"}, headers=headers)

    # 이후 에이전트 갱신은 건너뛴다.
    assert (
        store.write_actor_memory_as_agent(
            user_id=user.id,
            field=ActorMemoryField.GOAL,
            value="입시 준비(정시)",
            source_practice_session_id=practice_id,
        )
        is None
    )
    item = client.get("/v2/me/memory", headers=headers).json()["items"][0]
    assert item["value"] == "취미로 한다"
    assert item["edited_by_me"] is True


def test_deleting_a_field_lets_the_agent_fill_it_again():
    """지우기가 되돌리기 수단이다 -- 지우면 다음 연습부터 다시 채워져야 한다."""
    client, store, user, headers = _application()
    client.put("/v2/me/memory/goal", json={"value": "잘못 적은 값"}, headers=headers)

    assert (
        client.delete("/v2/me/memory/goal", headers=headers).status_code == 204
    )
    assert client.get("/v2/me/memory", headers=headers).json() == {"items": []}

    refilled = store.write_actor_memory_as_agent(
        user_id=user.id,
        field=ActorMemoryField.GOAL,
        value="입시 준비",
        source_practice_session_id=uuid4(),
    )
    assert refilled is not None


def test_deleting_everything_and_deleting_a_missing_field_both_succeed():
    client, _store, _user, headers = _application()
    client.put("/v2/me/memory/gender", json={"value": "여성"}, headers=headers)
    client.put("/v2/me/memory/age", json={"value": "22"}, headers=headers)

    assert client.delete("/v2/me/memory", headers=headers).status_code == 204
    assert client.get("/v2/me/memory", headers=headers).json() == {"items": []}

    # 이미 없는 칸을 지워도 결과는 같으므로 204 로 둔다.
    assert (
        client.delete("/v2/me/memory/gender", headers=headers).status_code == 204
    )


def test_unknown_field_and_blank_or_oversized_value_are_refused():
    client, _store, _user, headers = _application()

    assert (
        client.put(
            "/v2/me/memory/height", json={"value": "170"}, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/v2/me/memory/goal", json={"value": "   "}, headers=headers
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/v2/me/memory/goal", json={"value": "가" * 1001}, headers=headers
        ).status_code
        == 422
    )


def test_memory_needs_a_signed_in_actor():
    client, _store, _user, _headers = _application()
    assert client.get("/v2/me/memory").status_code == 401
    assert client.put("/v2/me/memory/goal", json={"value": "x"}).status_code == 401
    assert client.delete("/v2/me/memory").status_code == 401
