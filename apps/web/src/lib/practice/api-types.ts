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
  conversation: { id: string; status: string } | null;
  note: { id: string; title: string | null; kind: string } | null;
  created_at: string;
  updated_at: string;
}

export interface PracticeCreateRequest {
  request_id: string;
  video_id: string;
  scene: SceneContext;
  blockage: BlockageInput;
  client_experience: ExperienceVersion;
}

/** POST /v2/practices/{id}/continue — video_id 가 없으면 같은 영상 */
export interface PracticeContinueRequest {
  request_id: string;
  video_id?: string;
  scene: SceneContext;
  blockage: BlockageInput;
  client_experience: ExperienceVersion;
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
