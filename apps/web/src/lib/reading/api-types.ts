/**
 * 리딩 API 타입 (reading.script·cast·session·recording·memorization).
 *
 * 생성 타입(`src/lib/api/v2-schema.d.ts`, `pnpm --filter web generate:v2-schema`)의 별칭만 둔다.
 * 리딩 모듈이 쓰는 이름을 한 곳에 모아 두는 파일이며(`src/lib/api/v2/types.ts` 와 같은 관례),
 * 여기서 새 모양을 만들지 않는다. 서버 응답이 바뀌면 스냅샷을 다시 생성한다.
 */

import type { components } from "../api/v2-schema";

/** 대본을 넣은 길. 서버는 예시(sample)를 구분하지 않고 보통 대본으로 둔다. */
export type ScriptSource = components["schemas"]["ScriptSource"];

/** POST /v2/reading/scripts */
export type ScriptCreateRequest = components["schemas"]["ReadingScriptCreateRequest"];

/** PATCH /v2/reading/scripts/{id} — 제목·배역 이름·목소리만. 줄은 저장 뒤 고정이다. */
export type ScriptUpdateRequest = components["schemas"]["ReadingScriptPatch"];

export type ScriptLine = components["schemas"]["ReadingScriptLine"];

/**
 * GET /v2/reading/scripts/{id}, POST·PATCH 의 응답.
 * 서버는 상세·목록에 원문을 싣지 않는다(RA1 결정) — 원문은 등록 요청에만 보낸다.
 */
export type ScriptDetail = components["schemas"]["ReadingScript"];

/** GET /v2/reading/scripts 의 카드 하나 */
export type ScriptCard = components["schemas"]["ReadingScriptCard"];

/** GET /v2/reading/scripts — 최근 고친 순 */
export type ScriptListResponse = components["schemas"]["ReadingScriptList"];

// ─── 리딩 회차 (reading.cast · reading.session) ───────────────────────────────

export type ReadingMode = components["schemas"]["ReadingMode"];
export type ReadingAdvance = components["schemas"]["ReadingAdvance"];
export type SessionStatus = components["schemas"]["ReadingSessionStatus"];
/** passed 대조 통과 · unmatched 2회 미달 뒤 넘어감(read 는 1회) · skipped quiz 의 넘어가기 */
export type LineOutcome = components["schemas"]["ReadingLineResult"]["outcome"];

/** 줄마다 하나. 마지막 사건이 이긴다. misses 는 미달 횟수. */
export type LineResult = components["schemas"]["ReadingLineResult"];

/** 진행 저장에 싣는 줄 결과 — 말한 것 said(서버가 원문과 비교한다) 또는 기기가 정한 outcome·misses */
export type LineResultInput = components["schemas"]["ReadingLineResultInput"];

/** 원문과 다르게 말한 대사 — 완료 응답과 회차 상세의 different_lines, 줄 순서 */
export type DifferentLine = components["schemas"]["ReadingDifferentLine"];

/** POST /v2/reading/scripts/{id}/sessions */
export type SessionCreateRequest = components["schemas"]["ReadingSessionCreateRequest"];

/** GET /v2/reading/scripts/{id}/sessions 의 카드 하나. 최근순. */
export type SessionCard = components["schemas"]["ReadingSessionCard"];

export type SessionListResponse = components["schemas"]["ReadingSessionList"];

/** 회차 상세의 녹음 하나(reading.recording). 재생 주소는 10분 서명이며 저장소가 없으면 null 이다. */
export type SessionRecording = components["schemas"]["ReadingSessionRecording"];

/** 줄 단위 암기 상태(reading.memorization). 행이 없으면 아직 표시하지 않은 줄이다. */
export type MemorizationStatus = components["schemas"]["MemorizationStatus"];

export type MemorizationEntry = components["schemas"]["ReadingLineMemorization"];

/** GET /v2/reading/sessions/{id}, POST 의 응답 */
export type SessionDetail = components["schemas"]["ReadingSession"];

/** PATCH /v2/reading/sessions/{id}/progress */
export type ProgressRequest = components["schemas"]["ReadingSessionProgressRequest"];

/** 200 — seq 가 작거나 같으면 무시하고 현재 값 */
export type ProgressResponse = components["schemas"]["ReadingSessionProgress"];
