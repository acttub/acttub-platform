"""연기 입시 공고 조회.

`admissions/notices.json`을 읽어 그대로 내보낸다. 대학 입학처와 대입정보포털이 자동 수집을
막아 두어(각 사이트 robots.txt) 크롤러 대신 사람이 원문을 확인해 채우는 파일이다.
자세한 사정은 admissions/README.md 참고.

인증이 필요 없다 — 공개 정보이고, 가입 전에도 보여줄 수 있어야 재방문 이유가 된다.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdmissionUniversity(_StrictResponse):
    id: str
    name: str
    admission_url: str
    verified_at: str | None = None
    # 전형 정보를 확인하지 못한 사정을 적는다(자동 수집 차단, JS 렌더링 등).
    note: str | None = None


class AdmissionResult(_StrictResponse):
    """전년도 입시결과. 대학이 공개한 값만 담고, 나머지는 None으로 남긴다."""

    year: int
    quota: int | None = None
    applicants: int | None = None
    # "63.61:1" 형태로 원문 표기를 그대로 옮긴다.
    competition_rate: str | None = None
    # 최종등록자의 학생부 교과 성적. 실기 성적은 어느 대학도 공개하지 않는다.
    transcript_avg: str | None = None
    transcript_cut70: str | None = None
    transcript_low: str | None = None
    fill_rate: str | None = None
    waitlist_last: int | None = None
    source_url: str | None = None
    verified_at: str | None = None
    note: str | None = None


class AdmissionNotice(_StrictResponse):
    id: str
    university_id: str
    department: str | None = None
    admission_year: int | None = None
    track: str | None = None
    screening: str | None = None
    apply_start: str | None = None
    apply_end: str | None = None
    practical_date: str | None = None
    practical_task: str | None = None
    quota: str | None = None
    fee: str | None = None
    csat_minimum: str | None = None
    documents: str | None = None
    # 복장·준비물 규정. 어기면 감점이나 실격이라 일정만큼 중요하다.
    dress_code: str | None = None
    # 지정 희곡·지정곡처럼 미리 준비해야 하는 목록.
    designated_works: list[str] = []
    # 원서접수 때 써 내는 자기소개성 문항.
    essay_questions: list[str] = []
    results: list[AdmissionResult] = []
    source_url: str | None = None
    verified_at: str | None = None
    note: str | None = None


class AdmissionsResponse(_StrictResponse):
    updated_at: str
    disclaimer: str
    universities: list[AdmissionUniversity]
    notices: list[AdmissionNotice]


def load_admissions(path: Path) -> AdmissionsResponse:
    """파일을 읽어 검증한다. 형식이 깨지면 여기서 바로 드러나게 둔다."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    payload = AdmissionsResponse.model_validate(raw)

    known = {university.id for university in payload.universities}
    orphans = sorted({n.university_id for n in payload.notices} - known)
    if orphans:
        # 링크가 끊긴 공고는 화면에서 학교명 없이 떠버린다. 파일 단계에서 막는다.
        raise ValueError(f"universities에 없는 university_id: {', '.join(orphans)}")
    return payload


def build_router(*, admissions_file: Path | None) -> APIRouter | None:
    if admissions_file is None or not admissions_file.exists():
        return None

    router = APIRouter(prefix="/v2/admissions", tags=["v2-admissions"])

    # 파일은 배포 때만 바뀐다 — 요청마다 읽지 않고 기동 시 한 번 읽는다.
    payload = load_admissions(admissions_file)

    @router.get("", responses={status.HTTP_200_OK: {"model": AdmissionsResponse}})
    async def list_admissions() -> AdmissionsResponse:
        return payload

    @router.get(
        "/{university_id}",
        responses={status.HTTP_200_OK: {"model": AdmissionsResponse}},
    )
    async def get_university(university_id: str) -> AdmissionsResponse:
        university = next(
            (u for u in payload.universities if u.id == university_id), None
        )
        if university is None:
            raise HTTPException(status_code=404, detail="university_not_found")
        return AdmissionsResponse(
            updated_at=payload.updated_at,
            disclaimer=payload.disclaimer,
            universities=[university],
            notices=[n for n in payload.notices if n.university_id == university_id],
        )

    return router
