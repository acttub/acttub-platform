/**
 * 리딩 대본의 서버 계약 타입(reading.script). 경로·필드 이름은 `.scratch/SOMA-546-reading-spec.md`의
 * API 표를 따른 계획안이다 — api 갈래가 계약을 굳히면(CONTRACT.md §6-14) 여기를 맞춘다. 앱에는 생성
 * 타입이 없어 손으로 든다.
 */

/** 대본을 넣은 길. 예시 대본을 저장해도 보통 대본이고 이 값만 sample이다. */
export type ScriptSource = 'file' | 'paste' | 'typed' | 'sample';

/** 줄의 종류. 대사는 배역 하나에 매달리고 지문·장면은 배역이 없다. */
export type LineKind = 'dialogue' | 'direction' | 'scene';

/** 대본 카드의 상태 칩. 열린 회차 → reading, 마지막 회차 completed → completed, 그 밖 → no_cast. */
export type ScriptCardStatus = 'reading' | 'completed' | 'no_cast';

export type CreateScriptLine = {
  /** 대본 안 줄 순서. 1부터. 대사 번호는 이 순서에서 대사만 세어 얻는다(저장하지 않음). */
  ordinal: number;
  kind: LineKind;
  /** characters 배열의 자리(0부터). 지문·장면은 null. */
  character_index: number | null;
  text: string;
};

/** POST /v2/reading/scripts 본문. 같은 request_id·같은 본문은 먼저 만든 대본을 돌려준다. */
export type CreateScriptBody = {
  request_id: string;
  title: string;
  source: ScriptSource;
  raw_text: string;
  characters: { name: string }[];
  lines: CreateScriptLine[];
};

export type ScriptCharacter = {
  id: string;
  name: string;
  order: number;
  /** 상대역 목소리 프리셋 id. null이면 자동(reading.cast). */
  voice_preset: string | null;
  dialogue_count: number;
};

export type ScriptLineRecord = {
  id: string;
  ordinal: number;
  kind: LineKind;
  character_id: string | null;
  text: string;
  /** 대사 줄만 1부터. 지문·장면은 null. */
  dialogue_no: number | null;
};

/** 목록 카드(R00). 수치는 모두 서버 집계다. */
export type ScriptCard = {
  id: string;
  title: string;
  /** 마지막 회차의 내 배역 이름. 회차가 없으면 빈 배열("배역 미선택"). */
  my_character_names: string[];
  dialogue_count: number;
  /** 모든 회차의 녹음 수 합. 삭제 확인(R00.4)에 보여 준다. */
  recording_count: number;
  last_activity_at: string | null;
  status: ScriptCardStatus;
  updated_at: string;
};

export type ScriptListResponse = {
  scripts: ScriptCard[];
  total_count: number;
  in_progress_count: number;
};

export type ScriptLastSession = {
  id: string;
  status: 'in_progress' | 'completed' | 'stopped';
  my_character_ids: string[];
};

/** 상세(R00.5)와 생성·수정 응답. */
export type ScriptDetail = {
  id: string;
  title: string;
  source: ScriptSource;
  characters: ScriptCharacter[];
  lines: ScriptLineRecord[];
  recording_count: number;
  open_session_id: string | null;
  last_session: ScriptLastSession | null;
  created_at: string;
  updated_at: string;
};

/** PATCH /v2/reading/scripts/{id}. 제목과 배역 이름·목소리만 고친다. 줄은 불변이다. */
export type PatchScriptBody = {
  title?: string;
  characters?: { id: string; name?: string; voice_preset?: string | null }[];
};

export type MemorizationStatus = 'memorized' | 'not_yet';

export type LineMemorization = { line_id: string; status: MemorizationStatus; updated_at: string };

/** 422 사유 코드(공통 규칙: 본문은 코드 하나). */
export const SCRIPT_ERROR_CODES = [
  'script_too_long',
  'script_limit',
  'no_characters',
  'invalid_characters',
  'request_fingerprint_mismatch',
] as const;
export type ScriptErrorCode = (typeof SCRIPT_ERROR_CODES)[number];
