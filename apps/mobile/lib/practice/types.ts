/**
 * 회차(practice) 계약 타입 — 1.0.0에서 연습은 묶음의 n차이고, 영상은 보관함의 독립 자산이다.
 *
 * 서버(PA2)가 아직 없어 스펙의 API 표와 요구사항(02-practice practice.start·resume·analyze)을
 * 기준으로 둔다. 통합(PI1)이 생성 타입으로 바꾼다. 경험 판(legacy·three_layers_v1)은 서버가
 * 정하고 앱은 `X-Acttub-Contract: three_layers_v1` 헤더로 알린다(api-request).
 */

/** 회차 진행 상태. 분석 결과의 상태(analysis.status)와 다른 것이다. */
export type PracticeStage = 'analyzing' | 'conversing' | 'closed';

/** 분석 작업(ai_jobs)의 상태. */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** 분석 결과(analyses)의 상태. 부분 실패는 partial로 남고 대화는 시작된다. */
export type AnalysisStatus = 'ready' | 'partial';

/** 막힘 큰 갈래. 고르지 않으면 '그 외'(막힘 미특정)다. */
export type BlockageCategory = '분석' | '표현' | '그 외';

/** 막힘 세부. 표현의 넷과 '그 외'뿐이고 고르지 않으면 '그 외'다. */
export type BlockageDetail = '감정' | '움직임' | '화술' | '표정' | '캐릭터 분석' | '대사 분석' | '그 외';

/** 상황·인물·목표. 셋 다 선택이고 비우면 빈 문자열로 저장된다(시작 뒤 불변). */
export type PracticeScene = {
  situation: string;
  character: string;
  goal: string;
};

export type PracticeBlockage = {
  category: BlockageCategory;
  detail: BlockageDetail;
  note: string | null;
};

export type PracticeJob = {
  id: string;
  status: JobStatus;
  failure_reason?: string | null;
};

/** 시작·이어하기 응답. */
export type Practice = {
  id: string;
  root_id: string;
  ordinal: number;
  stage: PracticeStage;
  analysis_status: AnalysisStatus | null;
  job: PracticeJob;
};

/** 회차 상세(GET /v2/practices/{id}). 코치·노트는 PM3가 쓴다. */
export type PracticeDetail = Practice & {
  video_id: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
  created_at: string;
  playback_url?: string | null;
};

/** 폴링이 읽는 것(GET /v2/practices/{id}/status). */
export type PracticeStatus = {
  stage: PracticeStage;
  job: { status: JobStatus; failure_reason?: string | null };
  analysis: { status: AnalysisStatus } | null;
};

/** 묶음 목록의 한 줄. 진행 중 회차 id로 복귀시킨다(409의 본문은 코드뿐이다). */
export type PracticeGroup = {
  root_id: string;
  /** 서버가 계산해 준 제목. 없으면 앱이 노트 제목 → 상황 문장 → 대체 제목 순으로 고른다. */
  title: string | null;
  /** 마지막 회차 노트의 제목(초점 원문). record_only 면 null. */
  note_title?: string | null;
  /** 첫 회차의 상황 문장. 노트 제목이 없을 때 쓴다. */
  situation?: string | null;
  ordinal_count: number;
  in_progress_practice_id: string | null;
  favorite: boolean;
  hidden_at: string | null;
  tags?: string[];
  last_practiced_at?: string | null;
};

export type PracticeGroupFilter = 'all' | 'favorite' | 'recent30';

export type CreatePracticeBody = {
  request_id: string;
  video_id: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
};

/** 이어하기. video_id가 없으면 서버가 이전 회차의 영상을 그대로 쓴다. */
export type ContinuePracticeBody = {
  request_id: string;
  video_id?: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
};

/** 시작·이어하기·분석이 내는 코드. 본문 코드만 오고 화면이 문구를 고른다. */
export const PRACTICE_ERROR_CODES = [
  'video_not_ready',
  'practice_in_progress',
  'guest_daily_analysis_limit',
  'request_fingerprint_mismatch',
  'analysis_not_ready',
] as const;

export type PracticeErrorCode = (typeof PRACTICE_ERROR_CODES)[number];

/** 분석 작업이 실패한 사유(ai_jobs.failure_reason). 그 밖의 값은 일반 문구로 떨어진다. */
export type AnalysisFailureReason =
  | 'timeout'
  | 'parse'
  | 'unsupported'
  | 'cancelled'
  | 'account_deactivated';

// ─── 대화(practice.coach) ────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'closed';

export type CoachMessage = {
  turn_index: number;
  role: 'coach' | 'actor';
  text: string;
};

/**
 * 회차와 1:1 인 대화. 열린 대화는 같은 id 로 재개하고, 닫힌 뒤 다시 코칭하려면 새 회차다.
 * 동시 요청은 revision 으로 가른다(다르면 409 conversation_conflict).
 */
export type CoachConversation = {
  id: string;
  practice_id: string;
  status: ConversationStatus;
  revision: number;
  /** 시작 응답을 포함한 코치 응답 수. 상한은 기존 갈래 8, 신형 10이다. */
  coach_reply_count: number;
  reply_limit: number;
  messages: CoachMessage[];
};

/** 시작·답장의 결과. 종료면 노트가 함께 올 수 있다(없을 수도 있다). */
export type CoachTurnResult = {
  conversation: CoachConversation;
  /** 이번 코치 응답. 없을 수 있다(영상만 올린 첫 시작 등). */
  message: string | null;
  note: PracticeNote | null;
};

export type CoachStartBody = { practice_id: string; request_id: string };

export type CoachReplyBody = {
  conversation_id: string;
  request_id: string;
  text: string;
  revision: number;
};

export const COACH_ANSWER_MAX = 300;

// ─── 연습 노트(practice.note) ────────────────────────────────────────────────

/** 종류는 성공·실패 표시가 아니다. 제안이 있으면 action, 초점만 있으면 observation, 둘 다 없으면 record_only. */
export type NoteKind = 'action' | 'observation' | 'record_only';

export type NoteFormat = 'legacy' | 'v2';

export type NoteQuote = {
  text: string;
  /** 인용의 출처 — 배우가 한 말인지 영상 관찰인지. */
  source: 'actor' | 'observation';
};

export type PracticeNote = {
  id: string;
  practice_id: string;
  format: NoteFormat;
  kind: NoteKind;
  /** 초점 문구 원문. record_only 는 null 이고 목록은 묶음의 대체 제목을 쓴다. */
  title: string | null;
  /** 배우 말·관찰의 원문 발췌, 최대 둘. */
  summary_quotes: NoteQuote[];
  /** 다음 촬영에서 해볼 한 가지. 근거가 없으면 null. */
  next_take: string | null;
  actor_words: string[];
  corrections: string[];
  tags: string[];
  /** 생성이 두 번 실패해 확인된 것만 담았다. */
  fallback: boolean;
  cheer: string | null;
  source_revision: number;
  created_at: string;
};

// ─── 기록(practice.library 의 연습 묶음) ─────────────────────────────────────

export type PracticeRound = {
  id: string;
  ordinal: number;
  created_at: string;
  stage: PracticeStage;
  /** 그 회차의 대화 메시지 수(배우+코치). */
  message_count: number;
  note: { id: string; title: string | null; kind: NoteKind } | null;
};

export type PracticeGroupDetail = PracticeGroup & {
  video_id: string | null;
  last_conversation: string | null;
  practices: PracticeRound[];
};

export type GroupPatch = {
  favorite?: boolean;
  hidden?: boolean;
  title?: string;
};

// ─── 이탈 설문(practice.feedback) ────────────────────────────────────────────

export type FeedbackScreen = 'coach' | 'report';

/** 계기는 셋뿐이다. 홈 의견·스토어 평점·노트 미니 평가는 이 기능이 아니다. */
export type FeedbackTrigger = 'x' | 'leave' | 'back';

export const FEEDBACK_BODY_MAX = 100;
export const FEEDBACK_CONTACT_MAX = 80;

export type FeedbackBody = {
  request_id: string;
  practice_id: string | null;
  screen: FeedbackScreen;
  trigger: FeedbackTrigger;
  /** 건너뛰기(dismissed)면 없다. */
  body?: string;
  contact_email?: string;
  contact_phone?: string;
};
