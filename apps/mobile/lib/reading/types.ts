/**
 * 리딩 대본의 서버 계약 타입(reading.script). 앱에는 생성 타입이 없어 손으로 들며, 모양은
 * `apps/api/spec/openapi.json`의 `Reading*` 컴포넌트(CONTRACT.md §6-14)와 맞춰 둔다 — 계약이
 * 바뀌면 그 스냅샷을 보고 여기를 고친다.
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
  /** 내 배역이 아닐 때 읽을 목소리(서버가 정함). 고정값이면 그 값, 자동이면 대본 전체 순환의 값이다. */
  voice: string;
  dialogue_count: number;
};

/** 「장면으로 찾기」의 한 줄(서버가 나눔). 대사가 없는 장면은 없다. */
export type ScriptScene = {
  /** 1부터. */
  no: number;
  /** 막·장 머리 줄의 글. 지문으로 나눈 장면은 null이고 화면이 번호로 부른다. */
  title: string | null;
  /** 장면 안 첫·마지막 대사 줄. */
  start_line_id: string;
  end_line_id: string;
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
  /** 마지막 회차의 마지막 갱신 시각. 회차가 없으면 null. */
  last_practiced_at: string | null;
  /** 마지막 활동 — 회차가 있으면 last_practiced_at, 없으면 등록 시각. 서버는 늘 채워 보낸다. */
  last_activity_at: string;
  status: ScriptCardStatus;
  created_at: string;
  updated_at: string;
};

export type ScriptListResponse = {
  scripts: ScriptCard[];
  total_count: number;
  in_progress_count: number;
};

export type ReadingSessionStatus = 'in_progress' | 'completed';

/** 대본 상세와 카드가 함께 보는 마지막 회차(그 대본에서 가장 늦게 시작한 회차). */
export type ScriptLastSession = {
  id: string;
  status: ReadingSessionStatus;
  my_character_ids: string[];
  my_character_names: string[];
  started_at: string;
  ended_at: string | null;
};

/** 상세(R00.5)와 생성·수정 응답. */
export type ScriptDetail = {
  id: string;
  title: string;
  source: ScriptSource;
  characters: ScriptCharacter[];
  lines: ScriptLineRecord[];
  scenes: ScriptScene[];
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

// ─── 리딩 회차(reading.cast · reading.session) ──────────────────────────────

export type ReadingMode = 'read' | 'quiz';
export type ReadingAdvance = 'silence' | 'manual';

/** 진행 저장에 싣는 내 줄 하나의 말한 것(기기 음성 인식 결과). 원문과의 비교·통과 판정은 서버가 한다. */
export type LineSaid = { line_id: string; said: string };

/**
 * 원문과 다르게 말한 대사 하나(서버가 비교한 결과, 줄 순서). different_words 는 원문 어절 전부이고 differs 가 노란 표시다.
 * said 가 null 이면 말한 것 없이 결과만 저장된 줄(옛 앱)이라 표시가 없다.
 */
export type DifferentLine = {
  line_id: string;
  dialogue_no: number;
  said: string | null;
  different_words: { text: string; differs: boolean }[];
};

/** POST /v2/reading/scripts/{id}/sessions. 속성은 시작할 때 정하고 뒤에 바꾸지 않는다. */
export type StartSessionBody = {
  request_id: string;
  my_character_ids: string[];
  mode: ReadingMode;
  start_line_id: string;
  end_line_id: string;
  advance: ReadingAdvance;
  record: boolean;
};

/** 회차 구간의 이름(서버가 정함). 화면 글(「장면 2」·「대사 5~12번」)은 기기가 번역 키로 만든다. start·end 는 대사 번호. */
export type RangeName =
  | { kind: 'all' | 'dialogues'; scene_no: null; scene_title: null; start: number; end: number }
  | { kind: 'scene'; scene_no: number; scene_title: string | null; start: number; end: number };

/** 진행 중 회차의 K/N. done 은 지난 대사 수, total 은 구간 대사 수. */
export type SessionProgress = { done: number; total: number };

/** 회차 목록 카드(R00.5). ordinal 은 그 대본에서 시작한 순(집계). */
export type SessionCard = {
  id: string;
  ordinal: number;
  status: ReadingSessionStatus;
  my_character_ids: string[];
  my_character_names: string[];
  range: { start_dialogue_no: number; end_dialogue_no: number };
  range_name: RangeName;
  /** in_progress 일 때만. */
  progress: SessionProgress | null;
  my_dialogue_count: number;
  recorded_line_count: number;
  elapsed_seconds: number;
  started_at: string;
  ended_at: string | null;
};

export type SessionRecording = {
  id: string;
  line_id: string;
  attempt_no: number;
  duration_ms: number;
  content_type: string;
  byte_size: number;
  transcript: string | null;
  transcript_source: 'stt' | 'none';
  playback_url: string | null;
  playback_expires_at: string | null;
};

export type SessionDetail = SessionCard & {
  script_id: string;
  mode: ReadingMode;
  start_line_id: string;
  end_line_id: string;
  advance: ReadingAdvance;
  record: boolean;
  /** 다음에 할 대사 줄. completed 면 null. */
  current_line_id: string | null;
  progress_seq: number;
  recordings: SessionRecording[];
  different_lines: DifferentLine[];
};

/** PATCH /v2/reading/sessions/{id}/progress. seq 가 저장값보다 클 때만 반영된다. */
export type ProgressBody = {
  progress_seq: number;
  current_line_id?: string | null;
  elapsed_seconds?: number;
  line_results?: LineSaid[];
  complete?: boolean;
};

export type ProgressResponse = {
  current_line_id: string | null;
  elapsed_seconds: number;
  progress_seq: number;
  status: ReadingSessionStatus;
  /** 적용됐든 옛 순번이라 무시됐든 지금 서버가 아는 값. 완료 저장의 응답이 완료 화면의 「원문과 다르게 말한 대사」다. */
  different_lines: DifferentLine[];
};
