#!/usr/bin/env python3
"""수집 에이전트가 쓴 batch*.json / enrich*.json 을 notices.json 에 병합한다.

에이전트가 스키마를 조금씩 어길 수 있으므로(빈 문자열, 알 수 없는 category,
없는 university_id 등) 병합 전에 걸러 낸다. 걸러 낸 것은 전부 화면에 보고한다 —
조용히 버리면 "왜 저 대학만 비어 있지"를 나중에 추적할 수 없다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

WT = Path(
    "/Users/ryujisung/Desktop/Project/acttub-platform/.claude/worktrees/admissions-expand"
)
NOTICES = WT / "apps/api/acting-api/admissions/notices.json"
TMP = Path("/Users/ryujisung/.claude/jobs/7c0528a9/tmp")

CATEGORIES = {
    "free_acting", "assigned_acting", "improv", "song", "dance",
    "movement", "special", "interview", "essay", "audition_etc",
}
DISCIPLINES = {"acting", "musical"}
TRACKS = {"수시", "정시"}
WEIGHT_KEYS = {"practical", "transcript", "csat", "interview", "portfolio", "other"}

# AdmissionNotice 가 받는 필드. 모르는 키는 extra="forbid" 라 부팅을 깬다.
NOTICE_KEYS = {
    "id", "university_id", "department", "discipline", "admission_year", "track",
    "screening", "apply_start", "apply_end", "practical_date", "practical_date_end",
    "announce_date", "practical_task", "quota", "fee", "csat_minimum", "documents",
    "dress_code", "preparation", "designated_works", "essay_questions", "weights",
    "weights_note", "stages", "practical_items", "results", "source_url",
    "verified_at", "note",
}
STAGE_KEYS = {"order", "name", "date", "evaluates", "multiple", "weight", "note"}
ITEM_KEYS = {
    "category", "label", "required", "time_limit_sec", "count", "weight",
    "stage", "note",
}
RESULT_KEYS = {
    "year", "quota", "applicants", "competition_rate", "transcript_avg",
    "transcript_cut50", "transcript_cut70", "transcript_low", "practical_avg",
    "practical_cut50", "practical_cut70", "fill_rate", "waitlist_last",
    "waitlist_count", "source_url", "verified_at", "note",
}

rejected: list[str] = []


def blank_to_none(value):
    """빈 문자열은 null 로. csat_minimum 이 ""이면 '수능 최저 없음' 필터가 깨진다."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # 에이전트가 HTML에서 URL을 긁어 오면 &amp; 가 그대로 남는다. 그대로 두면
        # 쿼리스트링이 깨져 '원문 공고 보기'가 엉뚱한 데로 간다.
        if "&amp;" in text and ("http://" in text or "https://" in text):
            text = text.replace("&amp;", "&")
        return text
    return value


def clean_subdict(raw, allowed, where):
    out = {}
    for key, value in raw.items():
        if key not in allowed:
            rejected.append(f"{where}: 알 수 없는 필드 {key!r} 무시")
            continue
        out[key] = blank_to_none(value)
    return out


def clean_notice(raw, known_ids):
    nid = raw.get("id")
    uid = raw.get("university_id")
    if not nid or not uid:
        rejected.append(f"id/university_id 없음: {str(raw)[:80]}")
        return None
    if uid not in known_ids:
        rejected.append(f"{nid}: universities 에 없는 university_id={uid!r}")
        return None

    notice = {}
    for key, value in raw.items():
        if key not in NOTICE_KEYS:
            rejected.append(f"{nid}: 알 수 없는 필드 {key!r} 무시")
            continue
        notice[key] = blank_to_none(value)

    if notice.get("discipline") not in DISCIPLINES:
        rejected.append(f"{nid}: discipline={notice.get('discipline')!r} → acting 으로")
        notice["discipline"] = "acting"
    if notice.get("track") is not None and notice["track"] not in TRACKS:
        rejected.append(f"{nid}: track={notice['track']!r} → note 로 옮김")
        notice["note"] = " ".join(
            filter(None, [notice.get("note"), f"전형 구분 원문: {notice['track']}"])
        )
        notice["track"] = None

    weights = notice.get("weights")
    if isinstance(weights, dict):
        kept = {k: v for k, v in weights.items() if k in WEIGHT_KEYS and v is not None}
        bad = set(weights) - WEIGHT_KEYS
        if bad:
            rejected.append(f"{nid}: weights 알 수 없는 키 {sorted(bad)} 무시")
        notice["weights"] = kept or None

    stages = []
    for stage in notice.get("stages") or []:
        stage = clean_subdict(stage, STAGE_KEYS, f"{nid} stage")
        if not isinstance(stage.get("order"), int):
            rejected.append(f"{nid}: stage.order 가 정수가 아님 → 단계 버림")
            continue
        keep, drop = [], []
        for category in stage.get("evaluates") or []:
            (keep if category in CATEGORIES else drop).append(category)
        if drop:
            rejected.append(f"{nid}: stage {stage['order']} evaluates {drop} 무시")
        stage["evaluates"] = keep
        stage.setdefault("name", f"{stage['order']}단계")
        stages.append(stage)
    seen_orders = set()
    deduped = []
    for stage in sorted(stages, key=lambda s: s["order"]):
        if stage["order"] in seen_orders:
            rejected.append(f"{nid}: stage.order {stage['order']} 중복 → 뒤엣것 버림")
            continue
        seen_orders.add(stage["order"])
        deduped.append(stage)
    notice["stages"] = deduped

    items = []
    for item in notice.get("practical_items") or []:
        item = clean_subdict(item, ITEM_KEYS, f"{nid} item")
        if item.get("category") not in CATEGORIES:
            rejected.append(f"{nid}: category={item.get('category')!r} 버림")
            continue
        if item.get("stage") is not None and seen_orders and item["stage"] not in seen_orders:
            rejected.append(f"{nid}: item.stage={item['stage']} 가 없는 단계 → null 로")
            item["stage"] = None
        if not seen_orders:
            item["stage"] = None
        items.append(item)
    notice["practical_items"] = items

    notice["results"] = [
        clean_subdict(r, RESULT_KEYS, f"{nid} result") for r in notice.get("results") or []
    ]
    notice.setdefault("designated_works", [])
    notice.setdefault("essay_questions", [])
    return notice


def main() -> int:
    data = json.loads(NOTICES.read_text(encoding="utf-8"))
    known_ids = {u["id"] for u in data["universities"]}
    by_id = {n["id"]: n for n in data["notices"]}

    added = patched = 0
    blocked: list[str] = []
    problems: list[str] = []

    # 순서가 곧 우선순위다. 수집 결과를 먼저 넣고 그 위에 다듬은 문장을 덮는다.
    # 순서가 뒤바뀌면 다듬은 note 가 원본으로 되돌아간다. zz_manual 은 다듬기 패스
    # 이후에 손으로 고친 것들이라 반드시 맨 마지막이다.
    sources = (
        sorted(TMP.glob("batch*.json"))
        + sorted(TMP.glob("enrich*.json"))
        + sorted(TMP.glob("notes_polish.json"))
        + sorted(TMP.glob("zz_manual.json"))
    )
    for path in sources:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # 에이전트가 JSON 을 깨뜨렸을 때
            problems.append(f"{path.name}: 읽기 실패 {exc}")
            continue

        blocked += payload.get("blocked") or []
        problems += [f"{path.name}: {p}" for p in payload.get("problems") or []]

        for raw in (payload.get("notices") or []) + (payload.get("new_notices") or []):
            notice = clean_notice(raw, known_ids)
            if notice is None:
                continue
            if notice["id"] in by_id:
                rejected.append(f"{notice['id']}: 이미 있는 공고 → 덮어씀")
            by_id[notice["id"]] = notice
            added += 1

        for patch in payload.get("patches") or []:
            target = by_id.get(patch.get("id"))
            if target is None:
                problems.append(f"{path.name}: 없는 공고에 패치 {patch.get('id')}")
                continue
            merged = dict(target)
            merged.update(patch.get("set") or {})
            for key in ("source_url", "verified_at"):
                if patch.get(key):
                    merged[key] = patch[key]
            cleaned = clean_notice(merged, known_ids)
            if cleaned is not None:
                by_id[cleaned["id"]] = cleaned
                patched += 1

    data["notices"] = list(by_id.values())
    data["updated_at"] = "2026-08-04"
    NOTICES.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"신규/갱신 공고 {added}건, 패치 {patched}건 → 총 {len(data['notices'])}건")
    print(f"공고 있는 대학 {len({n['university_id'] for n in data['notices']})}/{len(known_ids)}곳")
    if blocked:
        print(f"\nrobots 차단 {len(blocked)}곳: {', '.join(sorted(set(blocked)))}")
    if problems:
        print(f"\n문제 {len(problems)}건:")
        for p in problems[:30]:
            print(f"  - {p}")
    if rejected:
        print(f"\n걸러 낸 값 {len(rejected)}건:")
        for r in rejected[:40]:
            print(f"  - {r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
