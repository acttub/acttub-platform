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


class AdmissionResource(_StrictResponse):
    """입시생이 참고할 만한 영상·글. 링크만 담고 본문은 옮기지 않는다(저작권).

    `source_type`을 반드시 붙인다 - 학원 홍보 영상과 대학 공식 영상을 같은 줄에
    늘어놓으면 입시생이 광고를 정보로 읽는다.
    """

    kind: str  # "video" | "article"
    title: str
    url: str
    # 채널명·매체명을 원문 그대로.
    publisher: str
    # official(대학 공식) | school(고교) | academy(입시학원) | personal(개인)
    source_type: str
    note: str | None = None
    verified_at: str | None = None


class AdmissionUniversity(_StrictResponse):
    id: str
    name: str
    admission_url: str
    # "경기 수원"처럼 캠퍼스 소재지. 통학 가능 여부가 지원 결정을 가른다.
    region: str | None = None
    # 한 대학이 캠퍼스별로 다른 전형을 내는 경우가 있다(한양대 서울/ERICA,
    # 명지대 인문/자연). 이름에 묻어 두지 않고 따로 둔다.
    campus: str | None = None
    # "univ"(4년제) | "college"(전문대). 지원 전략이 갈리므로 필터로 쓴다.
    type: str | None = None
    verified_at: str | None = None
    # 전형 정보를 확인하지 못한 사정을 적는다(자동 수집 차단, JS 렌더링 등).
    note: str | None = None
    resources: list[AdmissionResource] = []


class AdmissionResult(_StrictResponse):
    """전년도 입시결과. 대학이 공개한 값만 담고, 나머지는 None으로 남긴다."""

    year: int
    quota: int | None = None
    applicants: int | None = None
    # "63.61:1" 형태로 원문 표기를 그대로 옮긴다.
    competition_rate: str | None = None
    # 최종등록자의 학생부 교과 성적.
    transcript_avg: str | None = None
    transcript_cut50: str | None = None
    transcript_cut70: str | None = None
    transcript_low: str | None = None
    # 최종등록자의 실기 성적. 대부분의 대학은 공개하지 않지만 경기대처럼 내는 곳이 있다.
    practical_avg: str | None = None
    practical_cut50: str | None = None
    practical_cut70: str | None = None
    fill_rate: str | None = None
    # 예비번호가 어디까지 돌았는지. 연기 전형은 추가합격이 많아 실질 커트라인이다.
    waitlist_last: int | None = None
    # 실제로 추가합격한 인원. waitlist_last와 다르다 — 예비 30번까지 돌았어도
    # 충원 인원은 그보다 적을 수 있다(중복 합격자가 빠진 자리만 채워지므로).
    waitlist_count: int | None = None
    source_url: str | None = None
    verified_at: str | None = None
    note: str | None = None


class AdmissionWeights(_StrictResponse):
    """전형요소 반영비율(%). 원문에 숫자가 그대로 적힌 경우에만 채운다.

    PDF 표를 텍스트로 뽑으면 행·열이 뒤엉켜 오독하기 쉬운데, 이 값이 틀리면
    지원 전략을 통째로 그르친다. 판독이 조금이라도 애매하면 전부 None으로 두고
    `AdmissionNotice.weights_note`에 원문 표기를 그대로 옮겨 적는다.
    """

    practical: float | None = None
    transcript: float | None = None
    csat: float | None = None
    interview: float | None = None
    portfolio: float | None = None
    # 위 다섯으로 안 나뉘는 항목(출결·봉사·서류 등)의 합.
    other: float | None = None


class AdmissionStage(_StrictResponse):
    """단계별 전형. 1차에서 몇 배수를 뽑는지가 지원 판단을 가른다."""

    order: int
    # "1차 실기", "2차 실기·면접"처럼 원문 표기.
    name: str
    date: str | None = None
    # 그 단계에서 평가하는 것. practical_items[].category와 같은 값을 쓴다.
    evaluates: list[str] = []
    # "5배수", "3배수" 같은 원문 표기. 숫자로 바꾸지 않는다(모집인원 대비인지
    # 지원자 대비인지 대학마다 다르다).
    multiple: str | None = None
    # 그 단계 성적이 최종에 반영되는 비율. "1단계 성적 미반영"이면 0.
    weight: float | None = None
    note: str | None = None


class AdmissionPracticalItem(_StrictResponse):
    """실기 종목 하나. 서술형 `practical_task`를 필터·비교용으로 쪼갠 것이다.

    원문 서술이 정본이고 이쪽은 보조다 — 대학마다 실기 구성이 제각각이라
    category로 다 담기지 않는 경우 `note`에 원문을 남긴다.
    """

    # free_acting(자유연기) | assigned_acting(지정연기) | improv(즉흥)
    # song(노래) | dance(무용·춤) | movement(신체·움직임) | special(특기)
    # interview(면접·구술) | essay(작문·논술) | audition_etc(그 외)
    category: str
    # 원문에 적힌 종목명 그대로. 예: "지정 희곡 대사 연기"
    label: str | None = None
    # 필수인지 선택인지. 선택 종목(택1)이면 False.
    required: bool | None = None
    # 시간 제한(초). "2분 이내"면 120.
    time_limit_sec: int | None = None
    # 준비해 가야 하는 개수. "자유연기 2편"이면 2.
    count: int | None = None
    # 그 단계 안에서의 배점 비율(%).
    weight: float | None = None
    # 몇 차 전형에 속하는지. AdmissionStage.order와 맞춘다.
    stage: int | None = None
    note: str | None = None


class AdmissionNotice(_StrictResponse):
    id: str
    university_id: str
    department: str | None = None
    # "acting"(연기·연극) | "musical"(뮤지컬). 연기 지망생이 목록에서
    # 뮤지컬 전형을 가려낼 수 있어야 한다.
    discipline: str | None = None
    admission_year: int | None = None
    track: str | None = None
    screening: str | None = None
    apply_start: str | None = None
    apply_end: str | None = None
    practical_date: str | None = None
    # 실기가 여러 날에 걸치면 마지막 날. practical_date는 첫날이다.
    practical_date_end: str | None = None
    announce_date: str | None = None
    practical_task: str | None = None
    quota: str | None = None
    fee: str | None = None
    csat_minimum: str | None = None
    documents: str | None = None
    # 복장·준비물 규정. 어기면 감점이나 실격이라 일정만큼 중요하다.
    dress_code: str | None = None
    # 악보·소품처럼 당일 들고 가야 하는 것.
    preparation: str | None = None
    # 지정 희곡·지정곡처럼 미리 준비해야 하는 목록.
    designated_works: list[str] = []
    # 원서접수 때 써 내는 자기소개성 문항.
    essay_questions: list[str] = []
    weights: AdmissionWeights | None = None
    # 반영비율을 숫자로 확정하지 못했을 때 원문 표기를 그대로 옮겨 둔다.
    weights_note: str | None = None
    stages: list[AdmissionStage] = []
    practical_items: list[AdmissionPracticalItem] = []
    results: list[AdmissionResult] = []
    source_url: str | None = None
    verified_at: str | None = None
    note: str | None = None


class AdmissionsResponse(_StrictResponse):
    updated_at: str
    disclaimer: str
    universities: list[AdmissionUniversity]
    notices: list[AdmissionNotice]


DISCIPLINES = frozenset({"acting", "musical"})
UNIVERSITY_TYPES = frozenset({"univ", "college"})
PRACTICAL_CATEGORIES = frozenset(
    {
        "free_acting",
        "assigned_acting",
        "improv",
        "song",
        "dance",
        "movement",
        "special",
        "interview",
        "essay",
        "audition_etc",
    }
)


def _check_enums(payload: AdmissionsResponse) -> list[str]:
    """오탈자 하나가 화면에서 필터를 조용히 비게 만든다. 부팅 때 걸러 낸다."""
    problems: list[str] = []

    for university in payload.universities:
        if university.type is not None and university.type not in UNIVERSITY_TYPES:
            problems.append(f"{university.id}: type={university.type!r}")

    for notice in payload.notices:
        if notice.discipline is not None and notice.discipline not in DISCIPLINES:
            problems.append(f"{notice.id}: discipline={notice.discipline!r}")

        orders = [stage.order for stage in notice.stages]
        if len(orders) != len(set(orders)):
            problems.append(f"{notice.id}: stages[].order 중복 {sorted(orders)}")

        for item in notice.practical_items:
            if item.category not in PRACTICAL_CATEGORIES:
                problems.append(f"{notice.id}: category={item.category!r}")
            if item.stage is not None and orders and item.stage not in orders:
                # 없는 단계를 가리키면 상세 화면에서 그 종목이 어디에도 안 붙는다.
                problems.append(f"{notice.id}: practical_items[].stage={item.stage}")

        for stage in notice.stages:
            unknown = sorted(set(stage.evaluates) - PRACTICAL_CATEGORIES)
            if unknown:
                problems.append(f"{notice.id}: stage {stage.order} evaluates={unknown}")

    return problems


def load_admissions(path: Path) -> AdmissionsResponse:
    """파일을 읽어 검증한다. 형식이 깨지면 여기서 바로 드러나게 둔다."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    payload = AdmissionsResponse.model_validate(raw)

    known = {university.id for university in payload.universities}
    orphans = sorted({n.university_id for n in payload.notices} - known)
    if orphans:
        # 링크가 끊긴 공고는 화면에서 학교명 없이 떠버린다. 파일 단계에서 막는다.
        raise ValueError(f"universities에 없는 university_id: {', '.join(orphans)}")

    duplicates = sorted({i for i in known if [u.id for u in payload.universities].count(i) > 1})
    if duplicates:
        raise ValueError(f"universities[].id 중복: {', '.join(duplicates)}")

    notice_ids = [n.id for n in payload.notices]
    dup_notices = sorted({i for i in notice_ids if notice_ids.count(i) > 1})
    if dup_notices:
        raise ValueError(f"notices[].id 중복: {', '.join(dup_notices)}")

    problems = _check_enums(payload)
    if problems:
        raise ValueError("허용되지 않은 값: " + "; ".join(problems))
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
