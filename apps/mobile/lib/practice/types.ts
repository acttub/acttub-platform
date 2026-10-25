import type { PracticeReport } from '../api';

/**
 * 회차(practice) 계약 타입 — 0.1.0에서 연습은 묶음의 n차이고, 영상은 보관함의 독립 자산이다.
 *
 * 서버 PracticeDtos·ConversationDtos와 OpenAPI가 요청·응답의 정본이다.
 * 화면용 scene·blockage와 묶음 요약은 api.ts가 서버의 평평한 응답에서 구성한다.
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
  attempt_count?: number;
};

/** 시작·이어하기 응답. */
export type Practice = {
  id: string;
  root_id: string;
  ordinal: number;
  stage: PracticeStage;
  analysis_status: AnalysisStatus | null;
  job: PracticeJob | null;
};

/** 회차 상세(GET /v2/practices/{id}). 코치·노트는 PM3가 쓴다. */
export type PracticeDetail = Practice & {
  video_id: string | null;
  scene: PracticeScene;
  blockage: PracticeBlockage;
  created_at: string;
  playback_url?: string | null;
  video_purged: boolean;
  conversation_id: string | null;
  previous_conversations: PreviousConversation[];
};

/** 폴링이 읽는 것(GET /v2/practices/{id}/status). */
/**
 * 분석 공개 요약(`GET /v2/practices/{id}/analysis`, practice.analyze). summary 는 갈래(format)마다 모양이 달라
 * (legacy ObservationPackResponse · video_record_v1 VideoRecordSummaryResponse) 읽는 쪽이 모양을 확인한다.
 */
export type PracticeAnalysis = {
  id: string;
  format: 'legacy' | 'video_record_v1';
  status: AnalysisStatus;
  summary: unknown;
};

export type PracticeStatus = {
  stage: PracticeStage;
  close_reason: string | null;
  job: PracticeJob | null;
  analysis_status: AnalysisStatus | null;
};

export type PreviousConversation = { id: string; status: ConversationStatus; created_at: string };

/** PracticeDtos.PracticeResponse: 장면·막힘은 응답 최상위에 있다. */
export type PracticeResponse = Practice & {
  video_id: string | null;
  close_reason: string | null;
  experience_version: 'legacy' | 'three_layers_v1';
  situation: string;
  character: string;
  goal: string;
  blockage_category: BlockageCategory;
  blockage_detail: BlockageDetail;
  blockage_note: string | null;
  created_at: string;
  conversation_id: string | null;
  conversation_status: ConversationStatus | null;
  conversation_count: number;
  note_id: string | null;
  note_title: string | null;
  note_kind: NoteKind | null;
  previous_conversations: PreviousConversation[];
  /** 그 회차 영상의 첫 장면 사진(서명 주소, 10분). 서버가 만들기 전이거나 옛 서버면 없다(SOMA-671). */
  poster_url?: string | null;
};

export type PracticeGroupResponse = {
  root_id: string;
  title: string | null;
  ordinal_count: number;
  last_conversation_at: string | null;
  tags: string[];
  favorite: boolean;
  hidden_at: string | null;
  in_progress_practice_id: string | null;
  practices: PracticeResponse[];
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
  /** 가장 최근 회차 중 사진이 있는 회차의 첫 장면 사진. */
  poster_url?: string | null;
  practices: PracticeRound[];
};

export type PracticeGroupFilter = 'all' | 'favorite' | 'recent30';

export type CreatePracticeBody = {
  request_id: string;
  video_id: string;
  /** 묶음 제목(선택, 200자). 비우면 싣지 않고, 목록은 노트 제목 → 상황 → 대체 제목으로 고른다(SOMA-671). */
  title?: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
  /** 얼굴 가리기(P3.26). 선택 — 켠 때만 싣고, 서버가 모르면 무시한다. */
  face_mosaic?: boolean;
};

/**
 * 영상 없이 말로 시작(SOMA-745). video_id 를 싣지 않고 목적만 보낸다 — 서버가 분석 없이 바로 대화 단계 회차를 만든다.
 */
export type CreateTalkPracticeBody = {
  request_id: string;
  session_purpose: 'stuck' | 'character' | 'concern';
};

/** 이어하기. video_id가 없으면 서버가 이전 회차의 영상을 그대로 쓴다. */
export type ContinuePracticeBody = {
  request_id: string;
  video_id?: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
  face_mosaic?: boolean;
};

// ─── 대화(practice.coach) ────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'closed';

export type CoachMessage = {
  turn_index: number;
  role: 'coach' | 'actor';
  text: string;
  created_at: string | null;
};

/**
 * 회차와 1:1 인 대화. 열린 대화는 같은 id 로 재개하고, 닫힌 뒤 다시 코칭하려면 새 회차다.
 * 동시 요청은 revision 으로 가른다(다르면 409 conversation_conflict).
 */
export type CoachPurpose = {
  purpose: 'evaluate' | 'stuck' | 'character' | 'concern';
  step: string;
  choices: { label: string; at: number | null }[];
  scene: { situation: string; character: string; partner: string } | null;
  lines: { at: number | null; text: string }[];
  card: { good: CoachCardItem | null; issue: CoachCardItem | null; next: CoachCardItem | null } | null;
  character_card: { cells: { key: string; label: string; value: string; source: string }[] } | null;
};
export type CoachCardItem = { at: number | null; text: string };

export type CoachConversation = {
  purpose?: CoachPurpose | null;
  /** 목적 없는 질문 대화에서 지금 코치 질문 아래에 보일 예시 답(0~2개). 옛 서버는 보내지 않는다. */
  answer_examples?: string[];
  id: string;
  practice_id: string | null;
  status: ConversationStatus;
  close_reason: 'user_ended' | 'limit' | 'exhausted' | 'system_failure' | null;
  created_at: string | null;
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

export type CoachReplyBody = {
  conversation_id: string;
  request_id: string;
  text: string;
  revision: number;
};

export const COACH_ANSWER_MAX = 300;

// ─── 연습 노트(practice.note) ────────────────────────────────────────────────

/** 종류는 성공·실패 표시가 아니다. 제안이 있으면 action, 초점만 있으면 observation, 둘 다 없으면 record_only. */
export type NoteKind = 'action' | 'observation' | 'record_only' | 'analysis' | 'expression';

export type NoteFormat = 'legacy' | 'v2';

export type NoteQuote = {
  quote: string;
  /** 인용의 출처 — 배우가 한 말인지 영상 관찰인지. */
  kind: 'actor' | 'observation';
  source_ref: string;
};

export type PracticeNote = {
  id: string;
  conversation_id: string;
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
  /** 서버가 공개용으로 변환한 원문. 내부 출처 목록은 노출하지 않는다. */
  report: PracticeReport | null;
  source_revision: number;
  created_at: string;
  /** 이 노트에 남긴 평가. 없으면 null. 코치 응답에 실린 노트는 언제나 null 이다(노트 조회만 채운다). */
  my_rating?: NoteRating | null;
};

// ─── 노트 평가(practice.note) ────────────────────────────────────────────────

export type NoteRatingValue = 'helpful' | 'not_helpful';

/** 남긴 평가 — 저장 응답이자 노트 조회의 my_rating. */
export type NoteRating = {
  rating: NoteRatingValue;
  comment: string | null;
  updated_at: string;
};

export type NoteRatingBody = {
  request_id: string;
  rating: NoteRatingValue;
  /** 앞뒤 공백을 걷은 1~100자. 빼면 서버가 한 줄을 비운다. */
  comment?: string;
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
  conversation_id: string | null;
  previous_conversations: PreviousConversation[];
};

export type PracticeGroupDetail = PracticeGroup & {
  video_id: string | null;
  last_conversation_id: string | null;
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

/** 코치 답을 스트림으로 받을 때 화면이 쥐는 끈. 모두 선택이다 — 없으면 일반 호출과 같다. */
export type CoachStreamCallbacks = {
  /** 코치가 쓰는 글이 한 조각 올 때마다. */
  onDelta?: (text: string) => void;
  /** 쓰던 조각을 버린다(오류·끊김·일반 호출로 전환). */
  onReset?: () => void;
  signal?: AbortSignal;
};
