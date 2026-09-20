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

/** 대본 상세의 마지막 회차 요약. 회차의 전체 모양은 RW2 가 정한다. */
export interface ScriptLastSession {
  id: string;
  status: "in_progress" | "completed" | "stopped";
  my_character_ids: string[];
}

/** GET /v2/reading/scripts/{id}, POST·PATCH 의 응답 */
export interface ScriptDetail {
  id: string;
  title: string;
  source: ScriptSource;
  raw_text: string;
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
