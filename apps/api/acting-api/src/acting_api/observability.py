"""Sentry 초기화.

웹 쪽(`apps/web/src/lib/observability/sentry-shared.ts`)과 같은 원칙을 따른다 —
DSN 이 없으면 켜지 않고, 주소에서 식별자를 지우고, 환경은 태그로 나눈다.

**DSN 이 없으면 아무 일도 하지 않는다**는 점이 특히 중요하다. `create_app` 은 테스트가
매번 부르는 팩토리라, 이 가드가 없으면 테스트가 이벤트를 밖으로 쏘게 된다.
"""

from __future__ import annotations

import os
import re
from typing import Any

# 세션·사용자·업로드 식별자가 전부 이 꼴로 주소에 실려 온다.
_UUID_PATTERN = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)

_initialized = False


def scrub_url(url: str) -> str:
    """주소에서 쿼리·조각을 떼고 경로의 UUID 를 가린다.

    쿼리를 통째로 버리므로 새 파라미터가 생겨도 따로 손볼 것이 없다. 라우트 템플릿
    (`/v2/practice-sessions/{session_id}`)은 Sentry 가 트랜잭션 이름으로 따로 들고
    있어서, 여기서 실제 주소를 가려도 어느 엔드포인트인지는 그대로 보인다.
    """
    if not url:
        return url
    path = url.split("#", 1)[0].split("?", 1)[0]
    return _UUID_PATTERN.sub("<id>", path)


def _scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """보내기 직전에 주소가 실릴 수 있는 자리를 훑는다.

    `send_default_pii=False` 가 쿠키·헤더·클라이언트 IP 를 이미 막지만 주소는 그
    대상이 아니다.
    """
    request = event.get("request")
    if isinstance(request, dict):
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = scrub_url(url)
        # 쿼리는 남겨서 얻을 것이 없다.
        request.pop("query_string", None)

    breadcrumbs = event.get("breadcrumbs")
    values = breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else None
    if isinstance(values, list):
        for crumb in values:
            data = crumb.get("data") if isinstance(crumb, dict) else None
            if isinstance(data, dict) and isinstance(data.get("url"), str):
                data["url"] = scrub_url(data["url"])

    return event


def init_sentry() -> bool:
    """Sentry 를 켠다. 켰으면 True, DSN 이 없어 건너뛰었으면 False.

    FastAPI·Starlette 통합은 SDK 가 알아서 붙인다(의존성에 fastapi 가 있으면
    자동이다). 트레이싱은 켜지 않는다 — 1단계는 에러만 본다.
    """
    global _initialized
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    if _initialized:
        return True

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "local"),
        release=os.environ.get("SENTRY_RELEASE", "unknown"),
        # 쿠키·헤더·IP·요청 본문을 SDK 가 알아서 담지 않게 한다.
        send_default_pii=False,
        traces_sample_rate=0.0,
        before_send=_scrub_event,
    )
    _initialized = True
    return True
