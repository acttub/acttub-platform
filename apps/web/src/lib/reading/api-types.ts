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

/** 줄의 종류. 대사는 배역 하나에 매달리고 지문·장면은 배역이 없다. */
export type ScriptLineKind = components["schemas"]["ScriptLineKind"];

/** 목록 카드의 상태 칩. 열린 회차 → reading, 없고 마지막 회차가 완료 → completed, 그 밖 → no_cast. */
export type ScriptStatus = components["schemas"]["ReadingScriptCard"]["status"];

export type ScriptCharacterRequest = components["schemas"]["ReadingScriptCharacterInput"];

export type ScriptLineRequest = components["schemas"]["ReadingScriptLineInput"];

/** POST /v2/reading/scripts */
export type ScriptCreateRequest = components["schemas"]["ReadingScriptCreateRequest"];

/** PATCH /v2/reading/scripts/{id} — 제목·배역 이름·목소리만. 줄은 저장 뒤 고정이다. */
export type ScriptUpdateRequest = components["schemas"]["ReadingScriptPatch"];

export type ScriptCharacter = components["schemas"]["ReadingScriptCharacter"];

export type ScriptLine = components["schemas"]["ReadingScriptLine"];

/** 대본 상세의 마지막 회차 요약 */
export type ScriptLastSession = components["schemas"]["ReadingScriptLastSession"];

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
