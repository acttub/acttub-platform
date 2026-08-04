"""입시 공고 조회 — 데이터 파일이 곧 계약이라 파일 자체도 함께 검증한다."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from acting_api.admissions import build_router, load_admissions
from acting_api.config import DEFAULT_ADMISSIONS_FILE

REPO_FILE = DEFAULT_ADMISSIONS_FILE


def _client(path: Path) -> TestClient:
    app = FastAPI()
    router = build_router(admissions_file=path)
    assert router is not None
    app.include_router(router)
    return TestClient(app)


def _write(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "notices.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def _payload(**overrides) -> dict:
    base = {
        "updated_at": "2026-07-31",
        "disclaimer": "최종 확인은 반드시 각 대학 입학처 공고로 해주세요.",
        "universities": [
            {
                "id": "sejong",
                "name": "세종대학교",
                "admission_url": "https://ipsi.sejong.ac.kr",
                "verified_at": "2026-07-31",
            }
        ],
        "notices": [
            {
                "id": "sejong-2027-susi",
                "university_id": "sejong",
                "department": "영화예술학과 연기예술전공",
                "admission_year": 2027,
                "track": "수시",
                "apply_start": "2026-09-08",
            }
        ],
    }
    base.update(overrides)
    return base


def test_returns_universities_and_notices(tmp_path):
    client = _client(_write(tmp_path, _payload()))
    body = client.get("/v2/admissions").json()
    assert body["updated_at"] == "2026-07-31"
    assert [u["id"] for u in body["universities"]] == ["sejong"]
    assert body["notices"][0]["department"] == "영화예술학과 연기예술전공"


def test_filters_by_university(tmp_path):
    payload = _payload()
    payload["universities"].append(
        {"id": "cau", "name": "중앙대학교", "admission_url": "https://admission.cau.ac.kr"}
    )
    client = _client(_write(tmp_path, payload))

    body = client.get("/v2/admissions/sejong").json()
    assert [u["id"] for u in body["universities"]] == ["sejong"]
    assert len(body["notices"]) == 1

    other = client.get("/v2/admissions/cau").json()
    assert other["notices"] == []
    assert client.get("/v2/admissions/nope").status_code == 404


def test_requires_no_auth(tmp_path):
    # 가입 전에도 보여야 재방문 이유가 된다. Authorization 헤더 없이 200.
    client = _client(_write(tmp_path, _payload()))
    assert client.get("/v2/admissions").status_code == 200


def test_router_is_absent_when_file_missing(tmp_path):
    # 배포에서 데이터 파일이 빠져도 기동은 되어야 한다.
    assert build_router(admissions_file=tmp_path / "없는파일.json") is None
    assert build_router(admissions_file=None) is None


def test_notice_pointing_at_unknown_university_is_rejected(tmp_path):
    # 링크가 끊긴 공고는 화면에서 학교명 없이 떠버린다. 파일 단계에서 막는다.
    payload = _payload()
    payload["notices"][0]["university_id"] = "hongdae"
    with pytest.raises(ValueError, match="hongdae"):
        load_admissions(_write(tmp_path, payload))


def test_unknown_field_is_rejected(tmp_path):
    # 오타난 필드가 조용히 무시되면 화면에 안 나오는 이유를 못 찾는다.
    payload = _payload()
    payload["notices"][0]["practical_dates"] = "2026-09-29"
    with pytest.raises(Exception):
        load_admissions(_write(tmp_path, payload))


# --- 저장소에 실린 실제 데이터 ---------------------------------------------


def test_repo_data_file_is_valid():
    payload = load_admissions(REPO_FILE)
    assert payload.universities, "입학처가 하나도 없다"
    assert payload.disclaimer


def test_repo_universities_have_verified_source():
    # 확인하지 않은 링크를 싣지 않는다 — 입시 정보는 틀리면 실제 피해가 간다.
    for university in load_admissions(REPO_FILE).universities:
        assert university.admission_url.startswith("https://"), university.id
        assert university.verified_at, f"{university.id}: verified_at 비어 있음"


def test_repo_notices_carry_source_and_verified_at():
    for notice in load_admissions(REPO_FILE).notices:
        assert notice.source_url, f"{notice.id}: source_url 비어 있음"
        assert notice.verified_at, f"{notice.id}: verified_at 비어 있음"


def test_repo_notice_dates_are_iso():
    for notice in load_admissions(REPO_FILE).notices:
        for field in ("apply_start", "apply_end", "practical_date"):
            value = getattr(notice, field)
            if value is None:
                continue
            assert len(value) == 10 and value[4] == value[7] == "-", (
                f"{notice.id}.{field} = {value!r} — YYYY-MM-DD 형식이어야 한다"
            )


# ---- 구조화 필드 검증 ----
# 대학이 쉰 곳으로 늘면 손으로 채우다 오탈자가 난다. 오탈자 하나가 화면에서
# 필터를 조용히 비우는데, 그건 데이터가 없는 것보다 나쁘다 — 부팅 때 세운다.


def test_accepts_structured_fields(tmp_path):
    payload = _payload()
    payload["universities"][0].update({"campus": "서울", "type": "univ"})
    payload["notices"][0].update(
        {
            "discipline": "acting",
            "announce_date": "2026-12-12",
            "weights": {"practical": 70.0, "transcript": 30.0},
            "stages": [
                {
                    "order": 1,
                    "name": "1차 실기",
                    "evaluates": ["free_acting"],
                    "multiple": "5배수",
                    "weight": 0.0,
                }
            ],
            "practical_items": [
                {"category": "free_acting", "time_limit_sec": 120, "stage": 1}
            ],
        }
    )
    body = _client(_write(tmp_path, payload)).get("/v2/admissions").json()
    notice = body["notices"][0]
    assert notice["weights"]["practical"] == 70.0
    assert notice["stages"][0]["multiple"] == "5배수"
    assert notice["practical_items"][0]["category"] == "free_acting"
    assert body["universities"][0]["type"] == "univ"


@pytest.mark.parametrize(
    "mutate, expected",
    [
        (lambda p: p["notices"][0].update({"discipline": "연기"}), "discipline"),
        (lambda p: p["universities"][0].update({"type": "대학교"}), "type"),
        (
            lambda p: p["notices"][0].update(
                {"practical_items": [{"category": "자유연기"}]}
            ),
            "category",
        ),
        (
            lambda p: p["notices"][0].update(
                {"stages": [{"order": 1, "name": "1차", "evaluates": ["노래"]}]}
            ),
            "evaluates",
        ),
    ],
)
def test_rejects_unknown_enum_values(tmp_path, mutate, expected):
    payload = _payload()
    mutate(payload)
    with pytest.raises(ValueError, match=expected):
        load_admissions(_write(tmp_path, payload))


def test_rejects_practical_item_pointing_at_missing_stage(tmp_path):
    """없는 단계를 가리키면 상세 화면에서 그 종목이 어디에도 안 붙는다."""
    payload = _payload()
    payload["notices"][0].update(
        {
            "stages": [{"order": 1, "name": "1차", "evaluates": []}],
            "practical_items": [{"category": "song", "stage": 2}],
        }
    )
    with pytest.raises(ValueError, match="stage=2"):
        load_admissions(_write(tmp_path, payload))


def test_rejects_duplicate_ids(tmp_path):
    payload = _payload()
    payload["universities"].append(dict(payload["universities"][0]))
    with pytest.raises(ValueError, match="중복"):
        load_admissions(_write(tmp_path, payload))


def test_repo_file_passes_every_check():
    """실제 배포되는 파일이 위 규칙을 전부 지키는지."""
    payload = load_admissions(REPO_FILE)
    assert payload.universities, "대학이 비어 있다"
    for notice in payload.notices:
        assert notice.university_id, notice.id
