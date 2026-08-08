"""Sentry 로 나가는 이벤트에서 식별자가 지워지는지 확인한다.

방침 v3 7항이 "주소에 이용자의 연습 세션 식별자 등이 포함되는 경우 제거한 뒤
전송한다"고 약속한다. 이 테스트가 그 약속을 지킨다.
"""

import os

from acting_api.observability import _scrub_event, init_sentry, scrub_url


def test_query_is_dropped_entirely():
    assert scrub_url("https://acttub.com/v2/profile?email=a@b.com") == (
        "https://acttub.com/v2/profile"
    )


def test_uuid_in_path_is_masked():
    assert (
        scrub_url("/v2/practice-sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427")
        == "/v2/practice-sessions/<id>"
    )


def test_uppercase_uuid_is_masked():
    assert (
        scrub_url("/v2/uploads/1B4E28BA-2FA1-11D2-883F-0016D3CCA427/complete")
        == "/v2/uploads/<id>/complete"
    )


def test_fragment_is_dropped():
    assert scrub_url("/terms#privacy") == "/terms"


def test_empty_url_is_left_alone():
    assert scrub_url("") == ""


def test_event_request_is_scrubbed():
    event = {
        "request": {
            "url": "https://acttub.com/v2/practice-sessions/"
            "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
            "query_string": "session=9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
        }
    }

    _scrub_event(event, {})

    assert event["request"]["url"] == (
        "https://acttub.com/v2/practice-sessions/<id>"
    )
    assert "query_string" not in event["request"]


def test_breadcrumb_urls_are_scrubbed():
    event = {
        "breadcrumbs": {
            "values": [
                {"data": {"url": "/v2/reports/1b4e28ba-2fa1-11d2-883f-0016d3cca427"}},
                {"data": {"status_code": 500}},
                {},
            ]
        }
    }

    _scrub_event(event, {})

    values = event["breadcrumbs"]["values"]
    assert values[0]["data"]["url"] == "/v2/reports/<id>"
    assert values[1]["data"] == {"status_code": 500}


def test_event_without_request_or_breadcrumbs_passes_through():
    event = {"message": "boom"}

    assert _scrub_event(event, {}) == {"message": "boom"}


def test_init_is_skipped_without_dsn(monkeypatch):
    """DSN 이 없으면 켜지 않는다 — 테스트가 이벤트를 밖으로 쏘지 않게 하는 가드다."""
    monkeypatch.delenv("SENTRY_DSN", raising=False)

    assert init_sentry() is False


def test_init_is_skipped_when_dsn_is_blank(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "   ")

    assert init_sentry() is False


def test_env_var_name_is_not_shadowed_by_dotenv():
    """`.env` 가 DSN 을 들고 있으면 테스트가 실제로 이벤트를 보낼 수 있다."""
    assert not os.environ.get("SENTRY_DSN"), (
        "테스트 환경에 SENTRY_DSN 이 설정돼 있어요 — 이벤트가 실제로 나갑니다"
    )
