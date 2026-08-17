"""코치를 시작할 때 지난 것이 실제로 프롬프트까지 도달하는가.

이 배선의 최악은 **조용히 아무것도 안 하는 것**이다. 참고 사항을 못 모으면 빈 것으로
시작하도록 일부러 만들어 뒀는데, 그 때문에 배선이 끊겨도 시험은 초록으로 남는다.
그래서 모델에 실제로 넘어간 프롬프트를 붙잡아 확인한다.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient, FakeTextGenerator
from platform_test_support import FakePlatformStore

JWT_SECRET = "prior-context-test-secret"

_FOLLOWUP = json.dumps({"message": "무엇이 달랐나요?", "status": "continue"})


def _application():
    store = FakePlatformStore()
    coach_generate = FakeTextGenerator([_FOLLOWUP])
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="model-test"),
        store=store,
        community_store=SimpleNamespace(),
        coach_generate=coach_generate,
    )
    user = store.create_user()
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    return TestClient(app), store, coach_generate, user, {
        "Authorization": f"Bearer {access}"
    }


def _start(client, store, user, headers):
    summary_id = store.seed_summary(user_id=user.id)
    practice_session_id = store.summaries[summary_id].session_id
    response = client.post(
        "/v2/coach/start",
        json={"practice_session_id": str(practice_session_id)},
        headers={**headers, "X-Request-Id": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    return response


def test_stored_memory_reaches_the_model_prompt():
    client, store, coach, user, headers = _application()
    store.actor_memory[(user.id, "goal")] = SimpleNamespace(
        field="goal",
        value="입시 합격",
        written_by_actor=True,
        source_practice_session_id=None,
        updated_at=None,
    )

    _start(client, store, user, headers)

    assert "입시 합격" in coach.calls[0][1]


def test_unfinished_takes_from_the_last_practice_reach_the_prompt():
    client, store, coach, user, headers = _application()
    store.prior_pending_takes = ("한 박자 늦게 말해보기",)

    _start(client, store, user, headers)

    assert "한 박자 늦게 말해보기" in coach.calls[0][1]


def test_the_earlier_conversation_of_the_same_practice_reaches_the_prompt():
    client, store, coach, user, headers = _application()
    store.prior_earlier_conversation = "지난번엔 호흡 이야기를 했다"

    _start(client, store, user, headers)

    assert "지난번엔 호흡 이야기를 했다" in coach.calls[0][1]


def test_a_first_practice_starts_exactly_as_before():
    """참고할 게 없으면 지금까지와 같은 프롬프트가 나가야 한다."""
    client, store, coach, user, headers = _application()

    _start(client, store, user, headers)

    assert "배우에 대해 지금까지 알고 있는 것" not in coach.calls[0][1]


def test_a_broken_reader_does_not_block_the_conversation():
    """참고 사항이 없다고 연습을 못 하게 하는 건 배우 입장에서 말이 안 된다."""
    client, store, coach, user, headers = _application()

    def _boom(**_kwargs):
        raise RuntimeError("db down")

    store.get_prior_practice_context = _boom

    _start(client, store, user, headers)

    assert coach.calls, "참고 사항 조회가 실패했다고 대화가 막히면 안 된다"
