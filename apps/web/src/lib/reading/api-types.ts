/**
 * 리딩 대본 API 의 임시 타입 (reading.script, SOMA-546 RW1).
 *
 * ⚠ 생성 타입이 아니다. api 갈래가 엔드포인트를 내고 OpenAPI 스냅샷이 갱신되면 통합 작업(RI1)이
 * `pnpm --filter web generate:v2-schema` 로 `src/lib/api/v2-schema.d.ts` 를 만들고, 이 파일의 타입을
 * `components["schemas"][…]` 로 바꾼 뒤 지운다. 그때까지 웹 리딩 모듈은 여기서만 타입을 가져온다.
 * 경로·필드 이름은 `.scratch/SOMA-546-reading-spec.md` 의 API 표를 따른다.
 */

/** 대본을 넣은 길. 서버는 예시(sample)를 구분하지 않고 보통 대본으로 둔다. */
export type ScriptSource = "file" | "paste" | "typed" | "sample";

/** 줄의 종류. 대사는 배역 하나에 매달리고 지문·장면은 배역이 없다. */
export type ScriptLineKind = "dialogue" | "direction" | "scene";

/** 목록 카드의 상태 칩. 열린 회차 → reading, 없고 마지막 회차가 완료 → completed, 그 밖 → no_cast. */
export type ScriptStatus = "reading" | "completed" | "no_cast";

export interface ScriptCharacterRequest {
  name: string;
}

export interface ScriptLineRequest {
  /** 대본 안 줄 순서. 1부터. */
  ordinal: number;
  kind: ScriptLineKind;
  /** characters 배열의 자리. 지문·장면은 null. */
  character_index: number | null;
  text: string;
}

/** POST /v2/reading/scripts */
export interface ScriptCreateRequest {
  /** 기기가 만든 UUID. 같은 id·같은 본문의 재전송에는 먼저 만든 대본이 온다. */
  request_id: string;
  title: string;
  source: ScriptSource;
  raw_text: string;
  characters: ScriptCharacterRequest[];
  lines: ScriptLineRequest[];
}

/** PATCH /v2/reading/scripts/{id} — 제목·배역 이름·목소리만. 줄은 저장 뒤 고정이다. */
export interface ScriptUpdateRequest {
  title?: string;
  characters?: { id: string; name?: string; voice_preset?: string | null }[];
}

export interface ScriptCharacter {
  id: string;
  name: string;
  order: number;
  /** 기기 프리셋 id(M1~M5·F1~F5). null 이면 자동(reading.cast). */
  voice_preset: string | null;
  dialogue_count: number;
}

export interface ScriptLine {
  id: string;
  ordinal: number;
  kind: ScriptLineKind;
  character_id: string | null;
  text: string;
  /** 대사 줄만 1부터. 지문·장면은 null. */
  dialogue_no: number | null;
}

/** 대본 상세의 마지막 회차 요약 */
export interface ScriptLastSession {
  id: string;
  status: SessionStatus;
  my_character_ids: string[];
  my_character_names: string[];
  started_at?: string;
  ended_at?: string | null;
}

/** GET /v2/reading/scripts/{id}, POST·PATCH 의 응답 */
export interface ScriptDetail {
  id: string;
  title: string;
  source: ScriptSource;
  /** 서버는 상세·목록에 원문을 싣지 않는다(RA1 결정). 등록 요청에만 보낸다. */
  raw_text?: string;
  characters: ScriptCharacter[];
  lines: ScriptLine[];
  recording_count: number;
  open_session_id: string | null;
  last_session: ScriptLastSession | null;
  created_at: string;
  updated_at: string;
}

/** GET /v2/reading/scripts 의 카드 하나 */
export interface ScriptCard {
  id: string;
  title: string;
  /** 마지막 회차의 내 배역 이름. 회차가 없으면 빈 배열. */
  my_character_names: string[];
  dialogue_count: number;
  /** 모든 회차의 녹음 수 합 */
  recording_count: number;
  /** 회차의 마지막 갱신 시각. 회차가 없으면 null. */
  last_practiced_at: string | null;
  /** 마지막 활동 — 회차가 있으면 그 시각, 없으면 등록 시각 */
  last_activity_at: string;
  status: ScriptStatus;
  updated_at: string;
}

/** GET /v2/reading/scripts — 최근 고친 순 */
export interface ScriptListResponse {
  scripts: ScriptCard[];
  total_count: number;
  in_progress_count: number;
}

// ─── 리딩 회차 (reading.cast · reading.session) ───────────────────────────────

export type ReadingMode = "read" | "quiz";
export type ReadingAdvance = "silence" | "manual";
export type SessionStatus = "in_progress" | "completed" | "stopped";
/** passed 대조 통과 · unmatched 2회 미달 뒤 넘어감(read 는 1회) · skipped quiz 의 넘어가기 */
export type LineOutcome = "passed" | "unmatched" | "skipped";

/** 줄마다 하나. 마지막 사건이 이긴다. misses 는 미달 횟수. */
export interface LineResult {
  line_id: string;
  outcome: LineOutcome;
  misses: number;
}

/** POST /v2/reading/scripts/{id}/sessions */
export interface SessionCreateRequest {
  request_id: string;
  my_character_ids: string[];
  mode: ReadingMode;
  start_line_id: string;
  end_line_id: string;
  advance: ReadingAdvance;
  record: boolean;
}

/** GET /v2/reading/scripts/{id}/sessions 의 카드 하나. 최근순. */
export interface SessionCard {
  id: string;
  /** 그 대본에서 시작한 순서(집계) */
  ordinal: number;
  status: SessionStatus;
  my_character_ids: string[];
  my_character_names: string[];
  range: { start_dialogue_no: number; end_dialogue_no: number };
  /** 구간 안 내 대사 수 */
  my_dialogue_count: number;
  /** 녹음된 줄 수(reading.recording) */
  recorded_line_count: number;
  elapsed_seconds: number;
  started_at: string;
  ended_at: string | null;
}

export interface SessionListResponse {
  sessions: SessionCard[];
}

/** 회차 상세의 녹음 하나(reading.recording). 재생 주소는 10분 서명이며 RA3 전에는 null 이다. */
export interface SessionRecording {
  id: string;
  line_id: string;
  attempt_no: number;
  duration_ms: number;
  content_type: string;
  byte_size: number;
  transcript: string | null;
  transcript_source: "stt" | "none";
  matched: boolean | null;
  playback_url: string | null;
  playback_expires_at: string | null;
}

/** 줄 단위 암기 상태(reading.memorization). 행이 없으면 아직 표시하지 않은 줄이다. */
export type MemorizationStatus = "memorized" | "not_yet";

export interface MemorizationEntry {
  line_id: string;
  status: MemorizationStatus;
  updated_at: string;
}

/** GET /v2/reading/sessions/{id}, POST 의 응답 */
export interface SessionDetail extends SessionCard {
  script_id: string;
  mode: ReadingMode;
  advance: ReadingAdvance;
  record: boolean;
  start_line_id: string;
  end_line_id: string;
  /** 다음에 할 대사 줄. completed 면 null. */
  current_line_id: string | null;
  progress_seq: number;
  line_results: LineResult[];
  recordings: SessionRecording[];
}

/** PATCH /v2/reading/sessions/{id}/progress */
export interface ProgressRequest {
  /** 기기가 1씩 늘리는 순번. 서버는 저장된 값보다 큰 요청만 반영한다. */
  progress_seq: number;
  current_line_id?: string | null;
  /** 누적, 일시정지 제외. 줄지 않는다. */
  elapsed_seconds?: number;
  line_results?: LineResult[];
  complete?: boolean;
}

/** 200 — seq 가 작거나 같으면 무시하고 현재 값 */
export interface ProgressResponse {
  current_line_id: string | null;
  elapsed_seconds: number;
  progress_seq: number;
  status: SessionStatus;
}
