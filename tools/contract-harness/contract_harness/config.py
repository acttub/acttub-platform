"""하네스 전역 설정과 고정 시드 ID.

여기 있는 UUID 는 **시드가 만드는 것만** 고정한다(`spec/M1-harness.md` §채택 방식 2).
API 가 런타임에 만드는 ID 는 고정하지 않고 symbolic 으로 정규화한다.
"""

from __future__ import annotations

import os
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_ROOT.parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"
ACTING_API_ROOT = API_ROOT / "acting-api"
COMMITTED_OPENAPI = API_ROOT / "spec" / "openapi.json"
FIXTURES_DIR = HARNESS_ROOT / "fixtures"

DEFAULT_DATABASE_URL = "postgresql://acttub:acttub@localhost:55432/harness_claude"


def database_url() -> str:
    return os.environ.get("HARNESS_DATABASE_URL") or DEFAULT_DATABASE_URL


BASELINE_SCHEMA = "harness_baseline"
TARGET_SCHEMA = "harness_target"

JWT_SECRET = "contract-harness-jwt-secret"
ADMIN_OPS_TOKEN = "contract-harness-admin-token"
S3_BUCKET = "harness-videos"
AWS_REGION = "ap-northeast-2"
SUMMARY_MODEL = "harness-summary-model"

CONTROL_PREFIX = "/__harness"

# 제어 표면 5개 (§백엔드 adapter 계약 ①). 이름은 양쪽 백엔드가 공유하는 계약이다.
CONTROL_SURFACE = (
    "run-worker-once",
    "run-sweep",
    "stub-state",
    "advance-clock",
    "db-projection",
)


def _uuid(tag: int) -> str:
    return f"00000000-0000-4000-8000-{tag:012d}"


# --- 고정 시드 ID ---------------------------------------------------------

SEED_USERS = (
    # (id, email, nickname)
    (_uuid(101), "actor-one@harness.test", "배우하나"),
    (_uuid(102), "actor-two@harness.test", "배우둘"),
    (_uuid(103), "actor-three@harness.test", "배우셋"),
    (_uuid(104), "actor-four@harness.test", None),
)
SEED_USER_IDS = tuple(user[0] for user in SEED_USERS)

# 정지 계정. 로그인 자체가 403 이라 API 만으로는 만들 수 없으므로 시드에 둔다.
SEED_SUSPENDED_USER = (_uuid(109), "suspended@harness.test", "정지된배우")
# 정지 계정의 refresh token 도 시드가 고정한다(jti 까지 고정해야 두 스키마가 같아진다).
SEED_SUSPENDED_REFRESH_JTI = _uuid(190)
SEED_SUSPENDED_REFRESH_IAT = 1767225600  # 2026-01-01T00:00:00Z
SEED_SUSPENDED_REFRESH_TTL_SEC = 3600 * 24 * 3650

# 탈퇴 계정. DELETE /v2/me 로 만들 수도 있지만, 그러면 "탈퇴 직후" 만 검사하게 된다.
# 이미 탈퇴한 계정으로 되돌아오는 경로(로그인·refresh·잔여 액세스 토큰)를 보려면
# 시드에 있어야 한다. refresh token 은 탈퇴 시점에 폐기된 상태로 심는다.
SEED_DEACTIVATED_USER = (_uuid(110), "deactivated@harness.test", "떠난배우")
SEED_DEACTIVATED_REFRESH_JTI = _uuid(192)

# manifest.json 의 (type, version) 과 정확히 같아야 startup seed 가 no-op 이 된다.
SEED_CONSENT_DOCUMENTS = (
    # (id, type, version, file, title, required)
    (_uuid(201), "terms", "v1", "terms_v1.md", "이용약관", True),
    (_uuid(202), "privacy", "v2", "privacy_v2.md", "개인정보처리방침", True),
    (_uuid(203), "ai_analysis", "v1", "ai_analysis_v1.md", "AI 분석 동의", True),
)

# 시나리오가 "없는 리소스" 자리에 쓰는 고정 placeholder. 응답의 422 detail 이
# 요청 입력을 그대로 되돌려주므로 심볼로 등록해야 한다.
PLACEHOLDER_UUIDS = (
    _uuid(9001),
    _uuid(9002),
    _uuid(9003),
)

# storage 미설정(503) 분기는 데이터가 있어야 도달한다 — 시드에 완결된 세션 하나를 둔다.
SEED_UPLOAD_INTENT_ID = _uuid(701)
SEED_PRACTICE_SESSION_ID = _uuid(702)
SEED_SUMMARY_ID = _uuid(703)
SEED_COACH_SESSION_ID = _uuid(704)
SEED_HANDOFF_ID = _uuid(705)
SEED_PRACTICE_REPORT_ID = _uuid(706)
SEED_OBJECT_KEY = f"users/{_uuid(101)}/uploads/seedvideo.mp4"

SEED_POST_COUNT = 15
SEED_POST_IDS = tuple(_uuid(300 + index) for index in range(1, SEED_POST_COUNT + 1))
SEED_COMMENT_COUNT = 8
SEED_COMMENT_IDS = tuple(_uuid(400 + index) for index in range(1, SEED_COMMENT_COUNT + 1))

# 시드가 넣는 고정 시각. 커서 순회가 결정적이 되도록 1초 간격으로 벌린다.
SEED_EPOCH = "2026-01-01T00:00:00+00:00"

# 시드 truncate 에서 제외할 테이블 — alembic 이 데이터까지 만든 것들.
TRUNCATE_EXCLUDE = frozenset({"alembic_version", "community_categories"})
