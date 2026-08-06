"""두 스키마에 넣는 동일 시드.

시드가 만드는 ID·시각은 전부 고정한다. 그래야 ① Python 이 발급한 토큰 하나가
양쪽에서 유효하고 ② 커서 순회가 결정적이 된다.

동의 문서는 `consent_docs/manifest.json` 과 정확히 같은 (type, version, title,
body, required) 로 넣는다 — 그래야 앱 startup 의 `seed_consent_documents` 가
아무 것도 새로 만들지 않는다(고정 UUID 가 유지된다).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import text

from acting_api.db.engine import create_db_engine

from contract_harness import config as cfg
from contract_harness.dbsetup import scoped_url

SEED_EPOCH = datetime.fromisoformat(cfg.SEED_EPOCH)

# 커뮤니티 시드가 붙는 카테고리
SEED_POST_CATEGORY = "free"


def _post_row(index: int) -> dict:
    post_id = cfg.SEED_POST_IDS[index]
    author = cfg.SEED_USER_IDS[index % 3]
    anonymous = index % 4 == 3
    return {
        "id": post_id,
        "author_id": author,
        "title": f"시드 글 {index + 1:02d}",
        "body": f"시드 본문 {index + 1:02d} — 연습하다 든 생각",
        "anonymous": anonymous,
        # 오래된 것부터 1초 간격. 목록은 DESC 이므로 15번이 가장 위에 온다.
        "created_at": SEED_EPOCH + timedelta(seconds=index),
    }


def _comment_row(index: int) -> dict:
    return {
        "id": cfg.SEED_COMMENT_IDS[index],
        "post_id": cfg.SEED_POST_IDS[0],
        "author_id": cfg.SEED_USER_IDS[index % 3],
        "body": f"시드 댓글 {index + 1:02d}",
        "anonymous": index % 3 == 1,
        "created_at": SEED_EPOCH + timedelta(seconds=100 + index),
    }


def apply_seed(database_url: str, schema: str) -> None:
    engine = create_db_engine(scoped_url(database_url, schema))
    try:
        with engine.begin() as connection:
            _seed_users(connection)
            _seed_consent_documents(connection)
            _seed_user_consents(connection)
            _seed_completed_practice(connection)
            _seed_community(connection)
    finally:
        engine.dispose()


def suspended_refresh_token() -> str:
    """시드가 심어 두는 정지 계정용 refresh token. jti·iat 까지 고정한다."""
    import base64
    import hashlib
    import hmac
    import json as _json

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": "acting-api",
        "aud": "acting-app",
        "sub": cfg.SEED_SUSPENDED_USER[0],
        "jti": cfg.SEED_SUSPENDED_REFRESH_JTI,
        "token_type": "refresh",
        "iat": cfg.SEED_SUSPENDED_REFRESH_IAT,
        "exp": cfg.SEED_SUSPENDED_REFRESH_IAT + cfg.SEED_SUSPENDED_REFRESH_TTL_SEC,
    }

    def _b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    encoded = (
        _b64(_json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
        + "."
        + _b64(_json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    )
    signature = hmac.new(
        cfg.JWT_SECRET.encode(), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{encoded}.{_b64(signature)}"


def _seed_suspended_user(connection) -> None:
    from acting_api.security import hash_token

    user_id, email, nickname = cfg.SEED_SUSPENDED_USER
    connection.execute(
        text(
            "INSERT INTO users (id, email, nickname, status, created_at, updated_at)"
            " VALUES (:id, :email, :nickname, 'suspended'::user_status_t, :ts, :ts)"
        ),
        {"id": UUID(user_id), "email": email, "nickname": nickname, "ts": SEED_EPOCH},
    )
    connection.execute(
        text(
            "INSERT INTO user_identities (id, user_id, provider, provider_uid,"
            " created_at) VALUES (:id, :user_id, 'google'::identity_provider_t,"
            " :uid, :ts)"
        ),
        {
            "id": UUID(f"00000000-0000-4000-8000-{159:012d}"),
            "user_id": UUID(user_id),
            "uid": "harness-seed-suspended",
            "ts": SEED_EPOCH,
        },
    )
    connection.execute(
        text(
            "INSERT INTO refresh_tokens (id, user_id, token_hash, device_info,"
            " issued_at, expires_at) VALUES (:id, :user_id, :hash, NULL, :ts, :exp)"
        ),
        {
            "id": UUID(f"00000000-0000-4000-8000-{191:012d}"),
            "user_id": UUID(user_id),
            "hash": hash_token(suspended_refresh_token()),
            "ts": SEED_EPOCH,
            "exp": SEED_EPOCH + timedelta(days=3650),
        },
    )


def _seed_users(connection) -> None:
    _seed_suspended_user(connection)
    for index, (user_id, email, nickname) in enumerate(cfg.SEED_USERS):
        connection.execute(
            text(
                "INSERT INTO users (id, email, nickname, status, created_at, updated_at)"
                " VALUES (:id, :email, :nickname, 'active'::user_status_t, :ts, :ts)"
            ),
            {
                "id": UUID(user_id),
                "email": email,
                "nickname": nickname,
                "ts": SEED_EPOCH + timedelta(seconds=index),
            },
        )
        connection.execute(
            text(
                "INSERT INTO user_identities (id, user_id, provider, provider_uid,"
                " created_at) VALUES (:id, :user_id,"
                " 'google'::identity_provider_t, :uid, :ts)"
            ),
            {
                "id": UUID(f"00000000-0000-4000-8000-{150 + index:012d}"),
                "user_id": UUID(user_id),
                "uid": f"harness-seed-{index + 1}",
                "ts": SEED_EPOCH,
            },
        )


def _seed_consent_documents(connection) -> None:
    docs_dir = cfg.ACTING_API_ROOT / "consent_docs"
    for index, (doc_id, doc_type, version, filename, title, required) in enumerate(
        cfg.SEED_CONSENT_DOCUMENTS
    ):
        body = (docs_dir / filename).read_text(encoding="utf-8")
        connection.execute(
            text(
                "INSERT INTO consent_documents"
                " (id, type, version, title, body, required, published_at)"
                " VALUES (:id, CAST(:type AS consent_type_t), :version, :title,"
                " :body, :required, :ts)"
            ),
            {
                "id": UUID(doc_id),
                "type": doc_type,
                "version": version,
                "title": title,
                "body": body,
                "required": required,
                "ts": SEED_EPOCH + timedelta(seconds=index),
            },
        )


def _seed_user_consents(connection) -> None:
    """시드 유저는 이미 전 필수 약관에 동의한 상태로 둔다.

    동의 게이트 자체는 별도 시나리오(§동의 전 matrix)가 신규 로그인 유저로 검증한다.
    """
    counter = 0
    for user_index, (user_id, _email, _nickname) in enumerate(cfg.SEED_USERS):
        for doc_index, (doc_id, *_rest) in enumerate(cfg.SEED_CONSENT_DOCUMENTS):
            counter += 1
            connection.execute(
                text(
                    "INSERT INTO user_consents (id, user_id, document_id, action,"
                    " occurred_at) VALUES (:id, :user_id, :document_id,"
                    " 'granted'::consent_action_t, :ts)"
                ),
                {
                    "id": UUID(f"00000000-0000-4000-8000-{600 + counter:012d}"),
                    "user_id": UUID(user_id),
                    "document_id": UUID(doc_id),
                    "ts": SEED_EPOCH + timedelta(seconds=user_index * 10 + doc_index),
                },
            )


def _seed_completed_practice(connection) -> None:
    """시드 유저 1의 완결된 연습 세션 하나(업로드→분석→코치→리포트).

    `storage_not_configured` 503 분기는 리소스가 존재해야 도달한다 — 404 검사가
    먼저 걸리기 때문이다. 그 경로를 밟으려면 이 시드가 필요하다.
    """
    import json as _json

    llm = _json.loads(
        (cfg.HARNESS_ROOT / "fixtures" / "llm.json").read_text(encoding="utf-8")
    )
    user_id = UUID(cfg.SEED_USER_IDS[0])
    connection.execute(
        text(
            "INSERT INTO upload_intents (id, user_id, status, storage_provider,"
            " object_key, mime_type, size_bytes, duration_ms, etag, created_at,"
            " expires_at, finalized_at) VALUES (:id, :user_id,"
            " 'finalized'::upload_status_t, 's3', :object_key, 'video/mp4', 4096,"
            " 1500, :etag, :ts, :expires, :ts)"
        ),
        {
            "id": UUID(cfg.SEED_UPLOAD_INTENT_ID),
            "user_id": user_id,
            "object_key": cfg.SEED_OBJECT_KEY,
            "etag": '"9f86d081884c7d659a2feaa0c55ad015"',
            "ts": SEED_EPOCH,
            "expires": SEED_EPOCH + timedelta(days=3650),
        },
    )
    connection.execute(
        text(
            "INSERT INTO practice_sessions (id, user_id, upload_intent_id, status,"
            " situation, character_context, goal, blockage_kind, sub_branch,"
            " blockage_detail, created_at, updated_at) VALUES (:id, :user_id,"
            " :intent, 'analyzed'::practice_status_t, '시드 상황', '시드 인물',"
            " '시드 목표', '분석', '대사 분석', NULL, :ts, :ts)"
        ),
        {
            "id": UUID(cfg.SEED_PRACTICE_SESSION_ID),
            "user_id": user_id,
            "intent": UUID(cfg.SEED_UPLOAD_INTENT_ID),
            "ts": SEED_EPOCH,
        },
    )
    connection.execute(
        text(
            "INSERT INTO summaries (id, session_id, observations_json,"
            " uncertainties_json, model, was_compressed, raw, created_at)"
            " VALUES (:id, :session_id, CAST(:observations AS jsonb),"
            " CAST(:uncertainties AS jsonb), :model, false,"
            " CAST(:raw AS jsonb), :ts)"
        ),
        {
            "id": UUID(cfg.SEED_SUMMARY_ID),
            "session_id": UUID(cfg.SEED_PRACTICE_SESSION_ID),
            "observations": _json.dumps(llm["observation_pack"]["observations"]),
            "uncertainties": _json.dumps(llm["observation_pack"]["uncertainties"]),
            "model": cfg.SUMMARY_MODEL,
            "raw": _json.dumps(llm["observation_pack"]),
            "ts": SEED_EPOCH,
        },
    )
    connection.execute(
        text(
            "INSERT INTO coach_sessions (id, practice_session_id, summary_id, status,"
            " conversation_summary, created_at, updated_at) VALUES (:id, :session_id,"
            " :summary_id, 'closed'::session_status_t, '', :ts, :ts)"
        ),
        {
            "id": UUID(cfg.SEED_COACH_SESSION_ID),
            "session_id": UUID(cfg.SEED_PRACTICE_SESSION_ID),
            "summary_id": UUID(cfg.SEED_SUMMARY_ID),
            "ts": SEED_EPOCH,
        },
    )
    connection.execute(
        text(
            "INSERT INTO coaching_handoffs (id, coach_session_id, practice_session_id,"
            " branch_kind, handoff_json, created_at) VALUES (:id, :coach_session_id,"
            " :session_id, 'analysis', CAST(:handoff AS jsonb), :ts)"
        ),
        {
            "id": UUID(cfg.SEED_HANDOFF_ID),
            "coach_session_id": UUID(cfg.SEED_COACH_SESSION_ID),
            "session_id": UUID(cfg.SEED_PRACTICE_SESSION_ID),
            "handoff": _json.dumps(llm["analysis_handoff"], ensure_ascii=False),
            "ts": SEED_EPOCH,
        },
    )
    report = dict(llm["report"]["default"])
    report["source_handoff_id"] = cfg.SEED_HANDOFF_ID
    connection.execute(
        text(
            "INSERT INTO practice_reports (id, practice_session_id, report_type,"
            " report_json, source_handoff_id, created_at) VALUES (:id, :session_id,"
            " 'analysis', CAST(:report AS jsonb), :handoff_id, :ts)"
        ),
        {
            "id": UUID(cfg.SEED_PRACTICE_REPORT_ID),
            "session_id": UUID(cfg.SEED_PRACTICE_SESSION_ID),
            "report": _json.dumps(report, ensure_ascii=False),
            "handoff_id": UUID(cfg.SEED_HANDOFF_ID),
            "ts": SEED_EPOCH,
        },
    )


def _seed_community(connection) -> None:
    category_id = connection.execute(
        text("SELECT id FROM community_categories WHERE slug = :slug"),
        {"slug": SEED_POST_CATEGORY},
    ).scalar_one()
    for index in range(cfg.SEED_POST_COUNT):
        row = _post_row(index)
        connection.execute(
            text(
                "INSERT INTO community_posts (id, category_id, author_id, title, body,"
                " anonymous, status, like_count, comment_count, view_count,"
                " created_at, updated_at)"
                " VALUES (:id, :category_id, :author_id, :title, :body, :anonymous,"
                " 'visible'::content_status_t, 0, 0, 0, :created_at, :created_at)"
            ),
            {**row, "category_id": category_id, "id": UUID(row["id"]),
             "author_id": UUID(row["author_id"])},
        )
    comment_count = 0
    for index in range(cfg.SEED_COMMENT_COUNT):
        row = _comment_row(index)
        connection.execute(
            text(
                "INSERT INTO community_comments (id, post_id, author_id, body,"
                " anonymous, status, created_at, updated_at)"
                " VALUES (:id, :post_id, :author_id, :body, :anonymous,"
                " 'visible'::content_status_t, :created_at, :created_at)"
            ),
            {
                **row,
                "id": UUID(row["id"]),
                "post_id": UUID(row["post_id"]),
                "author_id": UUID(row["author_id"]),
            },
        )
        comment_count += 1
    connection.execute(
        text(
            "UPDATE community_posts SET comment_count = :count WHERE id = :id"
        ),
        {"count": comment_count, "id": UUID(cfg.SEED_POST_IDS[0])},
    )
    # 익명 댓글에 붙는 번호를 시드에서 고정한다 — 발급 순서가 곧 계약이다.
    ordinal = 0
    seen: dict[str, int] = {}
    for index in range(cfg.SEED_COMMENT_COUNT):
        row = _comment_row(index)
        if not row["anonymous"]:
            continue
        author = row["author_id"]
        post_author = _post_row(0)["author_id"]
        if _post_row(0)["anonymous"] and author == post_author:
            continue
        if author in seen:
            continue
        ordinal += 1
        seen[author] = ordinal
        connection.execute(
            text(
                "INSERT INTO community_anonymous_aliases (id, post_id, user_id,"
                " ordinal, created_at) VALUES (:id, :post_id, :user_id, :ordinal, :ts)"
            ),
            {
                "id": UUID(f"00000000-0000-4000-8000-{500 + ordinal:012d}"),
                "post_id": UUID(cfg.SEED_POST_IDS[0]),
                "user_id": UUID(author),
                "ordinal": ordinal,
                "ts": SEED_EPOCH,
            },
        )
