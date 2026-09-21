/**
 * 연습 1.0.0 API 의 임시 타입 (practice.record·library·start·resume·analyze, SOMA-546 PW1).
 *
 * ⚠ 생성 타입이 아니다. api 갈래(PA1~PA6)가 엔드포인트를 내고 OpenAPI 스냅샷이 갱신되면 통합 작업(PI1)이
 * `pnpm --filter web generate:v2-schema` 로 생성 타입을 만들고 이 파일의 타입을 `components["schemas"][…]` 로
 * 바꾼 뒤 지운다. 경로·필드 이름은 `.scratch/SOMA-546-practice-spec.md` 의 API 표(2차 검토 반영)를 따른다.
 */

// ─── 영상 보관함 (videos) ─────────────────────────────────────────────────────

export interface VideoUsage {
  /** 이 영상을 쓰는 회차 수 */
  practice_count: number;
  /** 이 영상을 쓰는 챌린지 참여작 수 */
  entry_count: number;
}

export interface Video {
  id: string;
  duration_ms: number;
  byte_size: number;
  content_type: string;
  favorite: boolean;
  /** "파일만 파기"한 시각. 있으면 객체·받아쓰기가 없고 재생할 수 없다. */
  purged_at: string | null;
  created_at: string;
  usage: VideoUsage;
  /** 10분 서명 재생 주소. 목록에는 없고 상세에만 온다. */
  playback_url: string | null;
  playback_expires_at: string | null;
}

export type VideoFilter = "all" | "recent7" | "favorite";

export interface VideoListResponse {
  videos: Video[];
  next_cursor: string | null;
}

/** POST /v2/videos/intents */
export interface VideoIntentRequest {
  request_id: string;
  content_type: string;
  byte_size: number;
  duration_ms: number;
}

export interface VideoIntentResponse {
  intent_id: string;
  upload_url: string;
  expires_at: string;
}

// ─── 연습 회차·묶음 (practices) ───────────────────────────────────────────────

export type PracticeStage = "analyzing" | "conversing" | "closed";
export type AiJobStatus = "pending" | "running" | "succeeded" | "failed";
export type AnalysisStatus = "ready" | "partial";
export type ExperienceVersion = "legacy" | "three_layers_v1";
export type BlockageCategory = "분석" | "표현" | "그 외";

export interface SceneContext {
  situation: string;
  character: string;
  goal: string;
}

export interface BlockageInput {
  category: BlockageCategory;
  /** 세부(표현의 감정·움직임·화술·표정·그 외, 분석의 캐릭터 분석·대사 분석·그 외) */
  detail: string;
  note: string | null;
}

export interface AiJobView {
  id?: string;
  status: AiJobStatus;
  failure_reason: string | null;
}

export interface AnalysisView {
  status: AnalysisStatus;
  /** 기존 갈래는 ObservationPack, 신형은 영상 기록 요약. 화면은 종류를 보고 그린다. */
  summary?: unknown;
}

export interface PracticeVideo {
  id: string;
  playback_url: string | null;
  playback_expires_at: string | null;
  purged_at: string | null;
  duration_ms: number;
}

/** POST /v2/practices, GET /v2/practices/{id} */
export interface Practice {
  id: string;
  root_id: string;
  ordinal: number;
  stage: PracticeStage;
  experience_version: ExperienceVersion;
  video: PracticeVideo;
  scene: SceneContext;
  blockage: BlockageInput;
  job: AiJobView | null;
  analysis: AnalysisView | null;
  /** 가장 최근 대화. 회차와 1:1이고 열린 것은 같은 id 로 재개한다. */
  conversation: { id: string; status: string } | null;
  /**
   * 옛 자료에서 한 연습에 여럿 있던 대화. 새 자료에는 비어 있고, 화면은 이것을 "이전 대화"로만
   * 보여 준다(읽기 전용). 턴은 대화 조회로 읽는다.
   */
  previous_conversations?: { id: string; status: string; created_at: string }[];
  note: { id: string; title: string | null; kind: string } | null;
  created_at: string;
  updated_at: string;
}

export interface PracticeCreateRequest {
  request_id: string;
  video_id: string;
  scene: SceneContext;
  blockage: BlockageInput;
}

/** POST /v2/practices/{id}/continue — video_id 가 없으면 같은 영상 */
export interface PracticeContinueRequest {
  request_id: string;
  video_id?: string;
  scene: SceneContext;
  blockage: BlockageInput;
}

/** GET /v2/practices/{id}/status */
export interface PracticeStatusResponse {
  stage: PracticeStage;
  job: AiJobView | null;
  analysis: { status: AnalysisStatus } | null;
}

export interface PracticeSummary {
  id: string;
  ordinal: number;
  stage: PracticeStage;
  created_at: string;
  situation: string;
  note_title: string | null;
  conversation_count: number;
}

/** GET /v2/practices 의 묶음 하나. 즐겨찾기·숨김은 첫 회차(root)의 속성이다. */
export interface PracticeGroup {
  root_id: string;
  /** 서버가 계산한 제목(마지막 회차 노트 제목 → 상황 → null) */
  title: string | null;
  ordinal_count: number;
  last_conversation_at: string | null;
  tags: string[];
  favorite: boolean;
  hidden_at: string | null;
  /** 닫히지 않은 회차. 있으면 새 회차 대신 여기로 돌아간다. */
  in_progress_practice_id: string | null;
  practices: PracticeSummary[];
}

export type PracticeGroupFilter = "all" | "favorite" | "recent30";

export interface PracticeGroupListResponse {
  groups: PracticeGroup[];
}

export interface PracticeGroupPatch {
  favorite?: boolean;
  hidden?: boolean;
  title?: string;
}

export interface PracticeCancelResponse {
  job: AiJobView;
}

/* ── 코치 대화 (practice.coach) ─────────────────────────────────
 * 회차와 1:1인 대화. 열린 대화는 같은 id 로 재개하고, 닫힌 뒤 다시 코칭하려면 새 회차다(practice.resume).
 * 동시 요청은 revision 으로 가른다 — 저장 때 값이 다르면 409 conversation_conflict 이고 화면은 입력을
 * 보존한 채 대화를 다시 읽는다.
 */
export type ConversationStatus = "open" | "closed";
export type ConversationRole = "actor" | "coach";

export interface ConversationTurn {
  turn_index: number;
  role: ConversationRole;
  text: string;
  created_at: string;
}

/** 대화 머리 — 응답마다 따라와 화면이 다음 요청에 실을 revision 을 안다. */
export interface ConversationHead {
  id: string;
  revision: number;
  status: ConversationStatus;
}

export interface Conversation extends ConversationHead {
  practice_id: string;
  closed_reason: string | null;
  created_at: string;
  turns: ConversationTurn[];
}

export interface ConversationStartRequest {
  practice_id: string;
  request_id: string;
}

export interface ConversationReplyRequest {
  conversation_id: string;
  request_id: string;
  text: string;
  revision: number;
}

/** 코치 한 턴의 답. 종료 턴이면 status 가 complete 이고 노트가 함께 온다. */
export interface ConversationTurnResponse {
  conversation: ConversationHead;
  message: string;
  status: "continue" | "complete";
  note: PracticeNote | null;
}

/* ── 연습 노트 (practice.note) ─────────────────────────────────
 * 대화가 닫힌 뒤 한 번 만든다. 종류는 action(다음 촬영 제안 있음)·observation(초점만)·record_only(초점 없이
 * 종료)이고 성공·실패 표시가 아니다. 제목은 초점 원문이며 record_only 는 없다(묶음 대체 제목을 쓴다).
 */
export type NoteKind = "action" | "observation" | "record_only";
export type NoteFormat = "legacy" | "v2";
/** 인용은 어디서 나온 말인지와 함께 둔다 — 배우가 자기 말을 알아볼 수 있어야 한다. */
export type QuoteSource = "actor" | "observation";

export interface NoteQuote {
  text: string;
  source: QuoteSource;
}

export interface PracticeNote {
  id: string;
  format: NoteFormat;
  kind: NoteKind;
  /** 초점 문구 원문. 초점이 없는 record_only 는 null 이다. */
  title: string | null;
  /** 배우 말·관찰의 원문 발췌, 최대 둘. */
  summary_quotes: NoteQuote[];
  /** 다음 촬영에서 해볼 한 가지. 근거가 없으면 null 이다. */
  next_take: string | null;
  actor_words: string[];
  corrections: string[];
  tags: string[];
  /** 생성이 거듭 실패해 확인된 것만 담았다. */
  fallback: boolean;
  cheer: string | null;
  source_revision: number;
  created_at: string;
}

/** 이탈 설문 (practice.feedback) */
export type FeedbackScreen = "coach" | "report";
export type FeedbackTrigger = "x" | "leave" | "back";

export interface FeedbackRequest {
  request_id: string;
  practice_id: string | null;
  screen: FeedbackScreen;
  trigger: FeedbackTrigger;
  /** 건너뛰기(dismissed)면 없다. */
  body?: string;
  contact_email?: string;
  contact_phone?: string;
}
