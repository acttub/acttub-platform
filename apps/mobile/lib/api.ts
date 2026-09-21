import type {
  AdmissionsResponse,
} from './admissions';
import { normalizeAdmissions } from './admissions';

import Constants from 'expo-constants';
import {
  createUploadTask,
  FileSystemUploadType,
} from 'expo-file-system/legacy';

import {
  clearTokensIfCurrent,
  commitRefreshedTokens,
  emitAccountDeactivated,
  emitConsentRequired,
  emitProfileRequired,
  emitUpdateRequired,
  getAccessToken,
  getAuthSessionEpoch,
  getRefreshToken,
  waitForCredentialReady,
} from '@/lib/token-store';
import {
  ApiError,
  createApiRequestClient,
  type PostIdempotentOptions,
} from '@/lib/api-request';
import type { SignupDecision } from '@/lib/consent-entry-submission';
import type { TransferRequestBody } from '@/lib/guest-transfer';
import type { LoginRequestBody, LoginResponse } from '@/lib/login-flow';
import type {
  CreditPayload,
  Portfolio,
  PortfolioCredit,
  PortfolioShare,
} from '@/lib/portfolio';
import type { ProfilePayload, ServerProfile } from '@/lib/profile-form';
import type { NotificationSettings } from '@/lib/push-policy';
import type { Video, VideoFilter, VideoIntentRequest, VideoIntentResponse, VideoListResponse } from '@/lib/library/types';
import type {
  ChallengeDetail,
  ChallengeListResponse,
  ChallengeTab,
  CreateChallengeBody,
  EntriesResponse,
  EntryCard,
  EntrySort,
} from '@/lib/challenge/types';
import type {
  CoachConversation,
  CoachReplyBody,
  CoachTurnResult,
  ContinuePracticeBody,
  CreatePracticeBody,
  FeedbackBody,
  GroupPatch,
  Practice,
  PracticeDetail,
  PracticeGroup,
  PracticeGroupDetail,
  PracticeGroupFilter,
  PracticeNote,
  PracticeStatus,
} from '@/lib/practice/types';
import type {
  CreateScriptBody,
  LineMemorization,
  MemorizationStatus,
  PatchScriptBody,
  ProgressBody,
  ProgressResponse,
  ScriptDetail,
  ScriptListResponse,
  SessionCard,
  SessionDetail,
  SessionRecording,
  StartSessionBody,
} from '@/lib/reading/types';
import { currentLanguage, translate } from './i18n.ts';

export { ApiError, NetworkError, RequestAbortError } from '@/lib/api-request';

/**
 * acttub v2 API (https://dev.acttub.com).
 * v1(Render, X-API-Key) → v2(Bearer JWT)로 전환.
 * - 인증: 소셜 로그인으로 받은 access/refresh 토큰. 401 시 refresh로 1회 자동 재발급 후 재시도.
 * - 업로드: multipart 직접 전송이 아니라 intent → presigned URL PUT → complete.
 * - 분석: 비동기 — practice-session 생성 후 상태를 폴링해 analyzed까지 기다린다.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://dev.acttub.com';
// 요청마다 보내는 클라이언트 종류와 판(X-Acttub-Client). 판은 app.json의 version이다.
// 이 헤더가 없으면 서버는 1.0.0 이전 빌드로 보고 426으로 답한다.
const CLIENT_HEADER = `app/${Constants.expoConfig?.version ?? '0.0.0'}`;
const requestClient = createApiRequestClient({
  baseUrl: BASE_URL,
  clientHeader: CLIENT_HEADER,
  fetchImpl: (...args) => fetch(...args),
  getLanguage: currentLanguage,
  waitForCredentialReady,
  getAccessToken,
  getRefreshToken,
  getAuthSessionEpoch,
  setTokens: commitRefreshedTokens,
  clearTokens: clearTokensIfCurrent,
  emitConsentRequired,
  emitProfileRequired,
  emitAccountDeactivated,
  emitUpdateRequired,
});

// ─── 도메인 타입 ────────────────────────────────────────────────────────────

/** 앱 내부 표현. API로 보낼 땐 character → character_context 로 매핑한다. */
export type SceneContext = {
  situation: string;
  character: string;
  goal: string;
};

/**
 * 배우가 고른 막히는 지점. 서버가 이걸로 분석 코치와 표현 코치를 가른다.
 * 값의 정의와 단계 규칙은 `lib/blockage.ts`(웹과 동일)에 있다.
 */
export type BlockageSelection = {
  blockage_kind: string;
  sub_branch: string;
  blockage_detail: string | null;
};

export type SceneSummary = {
  summary_id: string;
  observations: {
    start_ms: number;
    end_ms: number;
    label: string;
    confidence: number;
  }[];
  uncertainties: string[];
};

export type CoachTurnResponse = {
  session_id: string;
  message: string | null;
  status: 'continue' | 'complete';
  handoff: { id: string; branch_kind: 'analysis' | 'expression' | 'coaching' } | null;
  /** 대화가 정리돼 카드가 만들어졌으면 함께 온다. status==='complete' 여도 없을 수 있다. */
  report: PracticeReport | null;
  turns: CoachTurn[];
};

export type CoachTurn = { role: 'ai' | 'actor'; text: string };

/** 코치가 배우에 대해 기억하고 있는 한 칸. */
export type MemoryItem = {
  field: MemoryField;
  value: string;
  /** actor 면 배우가 직접 쓰거나 고친 칸이다. 코치(agent)는 이 칸을 덮지 않는다. */
  written_by: 'actor' | 'agent';
  /** 이 말이 나온 회차. 그 연습이 숨겨졌으면 null 이라 링크만 없다. */
  source_practice_id: string | null;
  updated_at: string;
};

/**
 * 화면에 여는 칸. 성별·나이는 1.0.0에서 프로필로 옮겼다(practice.memory) — 코치는 영상이나
 * 말투에서 그것을 추론하지 않고, 기억 화면은 연습에서 나온 넷만 다룬다.
 */
export type MemoryField = 'goal' | 'blockage' | 'speech_self' | 'speech_actual';

export type AnalysisReport = {
  report_type: 'analysis';
  title: string;
  actor_discovery: string;
  line_meaning: string;
  timing_reason: string;
  target_effect: string;
  next_take: { direction: string; tested: false };
  acting_caution: string;
  evidence: string[];
  uncertainties: string[];
  source_handoff_id: string;
};

export type ExpressionReport = {
  report_type: 'expression';
  title: string;
  blocked_point: string;
  expression_core: string;
  line_meaning: string;
  timing_reason: string;
  playable_action: string;
  effective_experiment: { instruction: string; tested: true };
  observed_change: string;
  next_take: string;
  acting_trap: string;
  actor_training: {
    title: string;
    purpose: string;
    duration_minutes: number;
    steps: string[];
    focus: string;
    success_check: string;
    tested: false;
  };
  evidence: string[];
  actor_words: string[];
  uncertainties: string[];
  source_handoff_ids: { analysis: string | null; expression: string };
};

export type PublicPracticeNote = {
  schema_version: 'acttub.public_practice_note.v1';
  report_type: 'practice_note';
  note_id: string;
  revision: number;
  title: string;
  summary: string | null;
  mode: 'action' | 'observation' | 'record_only';
  end_reason: 'actor_finished' | 'turn_budget' | 'interrupted' | 'system_failure';
  lifecycle: 'draft' | 'saved';
  record_ref: { record_id: string; version: number; duration_ms: number } | null;
  direction: { text: string; origin: 'actor_stated' | 'actor_selected' | 'coach_proposed' } | null;
  focus: { label: string; start_ms: number | null; end_ms: number | null; quote: string | null } | null;
  reading: string | null;
  practice: { proposal_id: string; selection: 'proposed' | 'selected'; instruction: string; comparison: string; keep: string | null } | null;
  attempts: { attempt_id: string; proposal_id: string; instruction: string;
    execution: 'unknown' | 'not_tried' | 'reported_tried';
    result: { direction: 'closer' | 'further' | 'mixed' | 'same' | 'unclear'; statement: string; basis: 'actor_report' } | null }[];
  open_points: string[];
  evidence: { id: string; kind: 'video_utterance' | 'video_observation' | 'record_limitation'; text: string; start_ms: number | null; end_ms: number | null }[];
};

export type VideoRecordSummary = {
  schema_version: 'acttub.video_record_summary.v1';
  record_id: string;
  record_version: number;
  duration_ms: number;
  status: 'ready' | 'partial';
  processed_ranges: { start_ms: number; end_ms: number }[];
  missing_ranges: { start_ms: number; end_ms: number }[];
  observed_scene: string[];
  spoken_content: string[];
  limitations: { start_ms: number; end_ms: number; description: string }[];
};

export type BlockedReport = {
  report_type: 'blocked';
  reason:
    | 'confirmed_analysis_handoff_required'
    | 'confirmed_expression_handoff_required';
};

export type PracticeReport = AnalysisReport | ExpressionReport | BlockedReport | PublicPracticeNote;
export type SavedPracticeReport = AnalysisReport | ExpressionReport | PublicPracticeNote;

export type CoachConfirmResponse = {
  session_id: string;
  confirmed: boolean;
  handoff: CoachTurnResponse['handoff'];
  report: PracticeReport;
};

export type ReportRecord = {
  practice_session_id: string;
  report_type: 'analysis' | 'expression' | 'practice_note';
  title: string;
  created_at: string;
};

export type ReportDetail = {
  practice_session_id: string;
  created_at: string;
  report: SavedPracticeReport;
  playback_url: string;
};

export type ReportHistoryResponse = {
  count: number;
  reports: ReportRecord[];
};

// ─── 인증 타입 ──────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string | null;
  status: 'active' | 'deactivated';
};

export type ConsentDocument = {
  id: string;
  type: string;
  version: string;
  title: string;
  body: string;
  required: boolean;
  published_at: string;
};

/** 앱이 보내는 결정은 둘뿐이다. 철회(revoked)는 운영자만 기록하고 API로 받지 않는다. */
export type ConsentDecision = 'granted' | 'declined';

export type ConsentEntryDocument = ConsentDocument & {
  current_decision: ConsentDecision | null;
  decided_at?: string | null;
};

export type ConsentEntryStatus = 'allowed' | 'decision_required';

export type ConsentEntryResponse = {
  entry_status: ConsentEntryStatus;
  documents: ConsentEntryDocument[];
  undecided_documents: ConsentEntryDocument[];
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
  pending_consents: ConsentDocument[];
};

/** GET /v2/me. 앱은 profile_complete로 프로필 입력 화면을 띄울지 정한다. */
export type MeResponse = AuthUser & {
  account_type: 'member' | 'guest';
  profile_complete: boolean;
  profile: ServerProfile | null;
};

// ─── 업로드 / 세션 타입 ──────────────────────────────────────────────────────

export type SessionStatus = 'analyzing' | 'analyzed' | 'failed';

export type PracticeSessionListItem = {
  session_id: string;
  status: SessionStatus;
  situation: string;
  character_context: string;
  goal: string;
  blockage_kind: '분석' | '표현' | '그 외';
  sub_branch: string;
  blockage_detail?: string | null;
  created_at: string;
  updated_at: string;
};

export type PracticeSessionDetail = {
  session_id: string;
  status: SessionStatus;
  situation: string;
  character_context: string;
  goal: string;
  blockage_kind: '분석' | '표현' | '그 외';
  sub_branch: string;
  blockage_detail?: string | null;
  created_at: string;
  updated_at: string;
  playback_url?: string;
  summary?: SceneSummary | VideoRecordSummary | null;
  error_code?:
    | 'gemini_timeout'
    | 'gemini_parse_error'
    | 'unsupported_media'
    | 'max_attempts_exceeded'
    | null;
};

// ─── 공통 요청 ────────────────────────────────────────────────────────────────

type ReqOpts = {
  auth?: boolean;
  timeoutMs?: number;
  requestId?: boolean;
  signal?: AbortSignal;
};

function randomId(): string {
  const s = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${s()}${s()}-${s()}-${s()}-${s()}-${s()}${s()}${s()}`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: ReqOpts = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (opts.requestId && !headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', randomId());
  }
  return requestClient.request<T>(
    path,
    { ...init, headers },
    {
      auth: opts.auth,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    },
  );
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export type ApiCallOptions = {
  signal?: AbortSignal;
};

function postIdempotent<T>(
  path: string,
  body: unknown,
  options: PostIdempotentOptions = {},
): Promise<T> {
  return requestClient.postIdempotent<T>(path, body, options);
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const api = {
  // 인증 -----------------------------------------------------------------------
  /** 서버가 켜 둔 로그인 제공자. 앱은 이 목록으로 로그인 버튼을 그린다. */
  authProviders(): Promise<{ providers: string[] }> {
    return request('/v2/auth/providers', {}, { auth: false, timeoutMs: 15_000 });
  },

  /**
   * 제공자가 준 자격 값으로 로그인한다. 응답은 어느 쪽이든 200이고 result로 가른다 —
   * 이미 있는 계정은 토큰을, 처음 온 신원은 가입 토큰과 동의 문서를 받는다.
   */
  login(body: LoginRequestBody): Promise<LoginResponse> {
    return request<LoginResponse>('/v2/auth/login', jsonInit(body), {
      auth: false,
      timeoutMs: 30_000,
    });
  },

  /** 가입 제출. 현재 판 모든 문서의 결정을 담아 통과하면 그 순간 계정이 생기고 토큰을 받는다. */
  signup(signupToken: string, decisions: SignupDecision[]): Promise<TokenPair> {
    return request<TokenPair>(
      '/v2/auth/signup',
      jsonInit({ signup_token: signupToken, decisions }),
      { auth: false, timeoutMs: 30_000 },
    );
  },

  logout(refreshToken: string): Promise<void> {
    return request<void>('/v2/auth/logout', jsonInit({ refresh_token: refreshToken }), {
      timeoutMs: 15_000,
    });
  },

  // 약관 -----------------------------------------------------------------------
  consentDocuments(): Promise<{ documents: ConsentDocument[] }> {
    return request('/v2/consents/documents', {}, { auth: false });
  },

  pendingConsents(): Promise<{ documents: ConsentDocument[] }> {
    return request('/v2/consents/pending', {}, { auth: true });
  },

  consentEntry(): Promise<ConsentEntryResponse> {
    return request('/v2/consents/entry', {}, { auth: true });
  },

  recordConsent(documentId: string, action: ConsentDecision): Promise<void> {
    return request<void>('/v2/consents', jsonInit({ document_id: documentId, action }), {
      requestId: true,
    });
  },

  // 내 계정 ---------------------------------------------------------------------
  /** 내 계정과 프로필. 게이트 밖이라 동의·프로필이 끝나기 전에도 읽힌다. */
  me(): Promise<MeResponse> {
    return request<MeResponse>('/v2/me', {}, { timeoutMs: 15_000 });
  },

  /** 프로필 여섯 항목을 한 번에 저장한다. 가입 게이트의 입력 화면과 설정의 수정이 함께 쓴다. */
  saveProfile(payload: ProfilePayload): Promise<MeResponse> {
    return request<MeResponse>(
      '/v2/me/profile',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { timeoutMs: 15_000 },
    );
  },

  /** 프로필 사진을 올릴 주소. 앱이 줄인 JPEG 의 크기를 알린다(영상 업로드와 같은 방식). */
  createProfilePhotoIntent(input: {
    content_type: string;
    size_bytes: number;
  }): Promise<{ upload_url: string; expires_at: string }> {
    return request('/v2/me/photo', jsonInit(input), { timeoutMs: 30_000 });
  },

  /** 올리기가 끝났다고 알린다. 서버가 객체를 확인해 프로필 사진으로 바꾸고 옛 사진을 지운다. */
  completeProfilePhoto(): Promise<MeResponse> {
    return request<MeResponse>('/v2/me/photo/complete', { method: 'POST' }, { timeoutMs: 30_000 });
  },

  /** 프로필 사진을 지운다. 사진이 없어도 204다(멱등). */
  deleteProfilePhoto(): Promise<void> {
    return request<void>('/v2/me/photo', { method: 'DELETE' }, { timeoutMs: 15_000 });
  },

  /**
   * 회원탈퇴. 처음이든 다시든 200 과 최초 탈퇴 시각을 받는다.
   *
   * 서버는 행을 지우지 않고 이메일·이름·사진·소개·포트폴리오·로그인 연결을 파기하고
   * refresh 를 전부 끊는다. **되돌릴 수 없다.**
   *
   * 401 재시도를 막지 않는다 — 서버 처리가 멱등해서(이미 탈퇴한 계정이면 최초 탈퇴
   * 시각을 유지) 두 번 닿아도 결과가 같다. 막으면 액세스 토큰이 방금 만료된 사람만
   * 탈퇴에 실패한다. 탈퇴 도중 앱이 죽어 다시 눌러도 같은 200 이다.
   */
  deleteMe(): Promise<{ status: 'deactivated'; deactivated_at: string }> {
    return request('/v2/me', { method: 'DELETE' }, { timeoutMs: 30_000 });
  },

  // 포트폴리오 -----------------------------------------------------------------
  // 항목마다 따로 저장한다. 회원 전용이고 보호 기능이다(게스트는 403 member_only).
  /** 한 번도 편집하지 않았어도 빈 모양으로 200 이다. 배열은 저장된 순서다. */
  portfolio(): Promise<Portfolio> {
    return request<Portfolio>('/v2/portfolio', {}, { timeoutMs: 20_000 });
  },

  /** 소개글 저장. null 이나 빈 글로 지운다. 2,000자까지. */
  savePortfolioIntro(intro: string | null): Promise<Portfolio> {
    return request<Portfolio>(
      '/v2/portfolio/intro',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intro }),
      },
      { timeoutMs: 20_000 },
    );
  },

  /** 경력 추가. 맨 끝에 붙는다. 쉰한 번째는 422 portfolio_credit_limit_exceeded. */
  createPortfolioCredit(credit: CreditPayload): Promise<PortfolioCredit> {
    return request<PortfolioCredit>('/v2/portfolio/credits', jsonInit(credit), {
      timeoutMs: 20_000,
    });
  },

  /** 경력 수정. 보낸 항목만 바꾼다. */
  updatePortfolioCredit(
    creditId: string,
    patch: Partial<CreditPayload>,
  ): Promise<PortfolioCredit> {
    return request<PortfolioCredit>(
      `/v2/portfolio/credits/${encodeURIComponent(creditId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      { timeoutMs: 20_000 },
    );
  },

  /** 경력 삭제. 이미 지운 것을 다시 지우면 404 다. */
  deletePortfolioCredit(creditId: string): Promise<void> {
    return request<void>(
      `/v2/portfolio/credits/${encodeURIComponent(creditId)}`,
      { method: 'DELETE' },
      { timeoutMs: 15_000 },
    );
  },

  /** 경력 순서 바꾸기. 지금 있는 id 를 원하는 순서로 전부 보낸다(다르면 422 order_mismatch). */
  reorderPortfolioCredits(order: { ids: string[] }): Promise<Portfolio> {
    return request<Portfolio>(
      '/v2/portfolio/credits/order',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      },
      { timeoutMs: 20_000 },
    );
  },

  /** 포트폴리오 사진을 올릴 주소. 열한 번째는 422 portfolio_photo_limit_exceeded. */
  createPortfolioPhotoIntent(input: {
    content_type: string;
    size_bytes: number;
  }): Promise<{ photo_id: string; upload_url: string; expires_at: string }> {
    return request('/v2/portfolio/photos', jsonInit(input), { timeoutMs: 30_000 });
  },

  /** 올리기가 끝났다고 알린다. 서버가 객체를 확인하고 목록 맨 끝에 붙인다. */
  completePortfolioPhoto(photoId: string): Promise<Portfolio> {
    return request<Portfolio>(
      `/v2/portfolio/photos/${encodeURIComponent(photoId)}/complete`,
      { method: 'POST' },
      { timeoutMs: 30_000 },
    );
  },

  deletePortfolioPhoto(photoId: string): Promise<void> {
    return request<void>(
      `/v2/portfolio/photos/${encodeURIComponent(photoId)}`,
      { method: 'DELETE' },
      { timeoutMs: 15_000 },
    );
  },

  reorderPortfolioPhotos(order: { ids: string[] }): Promise<Portfolio> {
    return request<Portfolio>(
      '/v2/portfolio/photos/order',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      },
      { timeoutMs: 20_000 },
    );
  },

  /**
   * 공유 링크 켜기·끄기. 처음 켤 때 난수 slug 가 생기고, 꺼도 slug 는 남아 다시 켜면 같은
   * 주소가 열린다. 주소는 응답의 url 을 그대로 쓴다.
   */
  setPortfolioShare(enabled: boolean): Promise<PortfolioShare> {
    return request<PortfolioShare>(
      '/v2/portfolio/share',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
      { timeoutMs: 20_000 },
    );
  },

  // 대본 리딩 -------------------------------------------------------------------
  // 경로·필드는 리딩 스펙의 API 표(계획안)다. 계약이 굳으면(CONTRACT.md §6-14) lib/reading/types 와 함께 맞춘다.
  /** 내 대본 목록(최근 고친 순). q 는 제목·배역 이름만 찾는다 — 대사 본문은 찾지 않는다. */
  listReadingScripts(q?: string): Promise<ScriptListResponse> {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<ScriptListResponse>(`/v2/reading/scripts${query}`, {}, { timeoutMs: 20_000 });
  },

  /**
   * 대본 저장(한 요청). 같은 request_id·같은 본문이면 먼저 만든 대본을 돌려주고(200), 다른 본문이면 422
   * request_fingerprint_mismatch. 한도는 422 script_too_long·script_limit, 배역은 no_characters·invalid_characters.
   * 연결이 끊기면 요청 계층이 같은 id 로 다시 보낸다.
   */
  createReadingScript(body: CreateScriptBody): Promise<ScriptDetail> {
    return postIdempotent<ScriptDetail>('/v2/reading/scripts', body, {
      requestId: body.request_id,
      timeoutMs: 60_000,
    });
  },

  /** 없는 것과 남의 것은 같은 404 다. */
  getReadingScript(scriptId: string): Promise<ScriptDetail> {
    return request<ScriptDetail>(`/v2/reading/scripts/${encodeURIComponent(scriptId)}`, {}, { timeoutMs: 20_000 });
  },

  /** 제목·배역 이름·목소리만 고친다. 줄은 불변이다. 빈 이름·겹치는 이름은 422 invalid_characters. */
  updateReadingScript(scriptId: string, body: PatchScriptBody): Promise<ScriptDetail> {
    return request<ScriptDetail>(
      `/v2/reading/scripts/${encodeURIComponent(scriptId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs: 20_000 },
    );
  },

  /** 배역·줄·회차·녹음(객체 포함)·암기 상태가 함께 지워지고 되돌릴 수 없다. */
  deleteReadingScript(scriptId: string): Promise<void> {
    return request<void>(
      `/v2/reading/scripts/${encodeURIComponent(scriptId)}`,
      { method: 'DELETE' },
      { timeoutMs: 20_000 },
    );
  },

  /**
   * 회차 시작(reading.session). 열린 회차가 있으면 서버가 같은 트랜잭션에서 stopped 로 바꾸고 새 회차를
   * 만든다. 같은 request_id 는 같은 회차 하나. 내 배역 없음·남의 배역 422 invalid_characters, 구간 안 내
   * 대사 없음·순서 뒤집힘 422 empty_range.
   */
  startReadingSession(scriptId: string, body: StartSessionBody): Promise<SessionDetail> {
    return postIdempotent<SessionDetail>(
      `/v2/reading/scripts/${encodeURIComponent(scriptId)}/sessions`,
      body,
      { requestId: body.request_id, timeoutMs: 30_000 },
    );
  },

  /** 그 대본의 회차 목록(최근순). */
  listReadingSessions(scriptId: string): Promise<{ sessions: SessionCard[] }> {
    return request(`/v2/reading/scripts/${encodeURIComponent(scriptId)}/sessions`, {}, { timeoutMs: 20_000 });
  },

  getReadingSession(sessionId: string): Promise<SessionDetail> {
    return request<SessionDetail>(`/v2/reading/sessions/${encodeURIComponent(sessionId)}`, {}, { timeoutMs: 20_000 });
  },

  /**
   * 진행 저장. 서버는 progress_seq 가 저장값보다 큰 요청만 반영하고 작거나 같으면 무시하고 현재 값을 200 으로
   * 돌려준다. completed·stopped 회차는 409 session_closed, 구간 밖·지문 줄은 422 invalid_line.
   */
  saveReadingProgress(sessionId: string, body: ProgressBody): Promise<ProgressResponse> {
    return request<ProgressResponse>(
      `/v2/reading/sessions/${encodeURIComponent(sessionId)}/progress`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs: 15_000 },
    );
  },

  /** 회차와 그 녹음(파일 포함)을 지운다. 암기 상태는 남는다. 없는 것·남의 것은 404. */
  deleteReadingSession(sessionId: string): Promise<void> {
    return request<void>(`/v2/reading/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, { timeoutMs: 20_000 });
  },

  /**
   * 내 대사 한 줄의 녹음을 multipart 한 요청으로 올린다(reading.recording). 같은 request_id 는 같은 결과(멱등),
   * 더 큰 attempt_no 만 같은 줄의 이전 녹음을 대체하고 작은 번호는 200 현재 값이다. 서버가 m4a 가 아니면 변환해
   * 저장하고, 변환 실패는 503 audio_conversion_failed 로 답한다(같은 request_id 로 재시도). 한도는 422
   * recording_too_long·recording_quota, 구간 밖·상대역·지문 줄은 422 invalid_line, 지워진 회차는 404.
   * 회차의 진행 상태와 분리돼 completed·stopped 회차에도 받는다.
   */
  uploadReadingRecording(
    sessionId: string,
    input: {
      request_id: string;
      line_id: string;
      attempt_no: number;
      duration_ms: number;
      transcript: string | null;
      transcript_source: 'stt' | 'none';
      matched: boolean | null;
      audio: { uri: string; name: string; type: string };
    },
  ): Promise<SessionRecording> {
    const form = new FormData();
    form.append('request_id', input.request_id);
    form.append('line_id', input.line_id);
    form.append('attempt_no', String(input.attempt_no));
    form.append('duration_ms', String(input.duration_ms));
    form.append('transcript_source', input.transcript_source);
    if (input.transcript !== null) form.append('transcript', input.transcript);
    if (input.matched !== null) form.append('matched', String(input.matched));
    // React Native 의 fetch 는 {uri, name, type} 를 파일 파트로 보낸다. Content-Type 은 경계와 함께 fetch 가 붙인다.
    form.append('audio', { uri: input.audio.uri, name: input.audio.name, type: input.audio.type } as unknown as Blob);
    return request<SessionRecording>(
      `/v2/reading/sessions/${encodeURIComponent(sessionId)}/recordings`,
      { method: 'POST', headers: { 'X-Request-Id': input.request_id }, body: form },
      { timeoutMs: 120_000 },
    );
  },

  /** 개별 녹음 삭제. 그 행·객체가 없어지고 회차 진행·암기 상태는 그대로다. */
  deleteReadingRecording(recordingId: string): Promise<void> {
    return request<void>(`/v2/reading/recordings/${encodeURIComponent(recordingId)}`, { method: 'DELETE' }, { timeoutMs: 20_000 });
  },

  /** 그 대본 줄의 암기 상태 행 목록(reading.memorization). 행이 없는 줄은 아직 표시하지 않은 줄이다. */
  listLineMemorization(scriptId: string): Promise<LineMemorization[]> {
    return request<LineMemorization[]>(
      `/v2/reading/scripts/${encodeURIComponent(scriptId)}/memorization`,
      {},
      { timeoutMs: 20_000 },
    );
  },

  /** 줄 하나의 암기 상태. 그 대본의 대사 줄이면 배역과 무관하게 받고, 지문·장면 줄은 422 invalid_line. */
  setLineMemorization(lineId: string, status: MemorizationStatus): Promise<LineMemorization> {
    return request<LineMemorization>(
      `/v2/reading/lines/${encodeURIComponent(lineId)}/memorization`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
      { timeoutMs: 15_000 },
    );
  },

  // 웹 체험 자료 옮기기 ---------------------------------------------------------
  /**
   * 웹이 보여 준 여섯 자리 코드로 게스트의 자료를 이 회원으로 옮긴다. 기억이 둘 다 있는데
   * memory_choice 가 없으면 409 memory_choice_required — 아무것도 옮기지 않고 코드도 살아 있다.
   */
  transferGuestData(body: TransferRequestBody): Promise<{ transferred: boolean }> {
    return request('/v2/guest-transfers', jsonInit(body), { timeoutMs: 60_000 });
  },

  // 알림 설정 -------------------------------------------------------------------
  /** 알림 토글 셋. 프로필에 저장돼 폰을 바꿔도 유지된다. 가입 직후에는 셋 다 켜져 있다. */
  notificationSettings(): Promise<NotificationSettings> {
    return request('/v2/me/notification-settings', {}, { timeoutMs: 15_000 });
  },

  /**
   * 바꿀 토글만 보낸다. 응답은 토글 셋 전체다. 푸시 토글 둘이 다 꺼지면 서버가 그 회원의
   * 푸시 토큰을 전부 지운다.
   */
  updateNotificationSettings(patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
    return request(
      '/v2/me/notification-settings',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      { timeoutMs: 15_000 },
    );
  },

  // 푸시 알림 -------------------------------------------------------------------
  /**
   * 이 단말의 Expo push token 을 내 것으로 등록. 서버가 토큰 기준 upsert 라 멱등하다.
   * 보호 기능이라 동의와 프로필이 끝난 뒤에만 받는다(그 전에는 403).
   */
  registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
    return request<void>('/v2/push-tokens', jsonInit({ token, platform }), {
      timeoutMs: 15_000,
    });
  },

  /**
   * 이 단말의 토큰을 지운다. 없어도 204 — 멱등하다. **로그인 없이 보낸다** — 푸시 토큰을 갖고
   * 있다는 것이 본인 확인이다. 그래서 로그아웃 때 실패한 삭제를 다음 실행 때(기기에 액세스
   * 토큰이 없어도) 다시 보낼 수 있다.
   */
  unregisterPushToken(token: string): Promise<void> {
    return request<void>(
      '/v2/push-tokens',
      { ...jsonInit({ token }), method: 'DELETE' },
      { auth: false, timeoutMs: 15_000 },
    );
  },

  // 코치의 기억 -----------------------------------------------------------------
  /**
   * 코치가 나에 대해 기억하는 것 전부. 빈 칸은 행이 없으므로 4개보다 적게 온다.
   */
  actorMemory(): Promise<{ items: MemoryItem[] }> {
    return request('/v2/me/memory', {}, { timeoutMs: 15_000 });
  },

  /**
   * 한 칸을 고친다. 배우가 고친 칸은 이후 코치가 덮어쓰지 않는다.
   */
  saveActorMemory(field: MemoryField, value: string): Promise<MemoryItem> {
    return request(
      `/v2/me/memory/${encodeURIComponent(field)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      },
      { timeoutMs: 15_000 },
    );
  },

  /** 한 칸을 지운다. 없는 칸을 지워도 성공이다. */
  deleteActorMemory(field: MemoryField): Promise<void> {
    return request<void>(
      `/v2/me/memory/${encodeURIComponent(field)}`,
      { method: 'DELETE' },
      { timeoutMs: 15_000 },
    );
  },

  /** 기억을 통째로 지운다. */
  deleteAllActorMemory(): Promise<void> {
    return request<void>('/v2/me/memory', { method: 'DELETE' }, { timeoutMs: 15_000 });
  },

  // 영상 보관함 -----------------------------------------------------------------
  // 경로·필드는 연습 스펙의 API 표(계획안)다. api 갈래(PA1)가 계약을 굳히면 lib/library/types 와 함께 맞춘다.
  /**
   * 올릴 자리 받기(practice.record). 예약 장부가 request_id 를 보존해 재전송이 같은 자리를 돌려준다.
   * 100MiB·5분 초과는 422 video_too_large·video_too_long, 총량 초과는 422 video_quota.
   */
  createVideoIntent(body: VideoIntentRequest): Promise<VideoIntentResponse> {
    return postIdempotent<VideoIntentResponse>('/v2/videos/intents', body, { requestId: body.request_id, timeoutMs: 30_000 });
  },

  /**
   * 마무리 — videos 행(보관함 저장)을 만든다. 같은 request_id 의 재전송은 같은 영상이고, 자리가 만료됐으면(30분)
   * 422 upload_expired 라 처음부터 다시 올린다. 실제 바이트가 메타와 다르면 실패한다.
   */
  completeVideoIntent(intentId: string, requestId: string): Promise<Video> {
    return request<Video>(
      `/v2/videos/intents/${encodeURIComponent(intentId)}/complete`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId }, body: '{}' },
      { timeoutMs: 30_000 },
    );
  },

  /** 내 영상, 최신 저장순. 예시 영상은 섞지 않는다. filter 는 all·recent7·favorite. */
  listVideos(filter: VideoFilter = 'all'): Promise<VideoListResponse> {
    return request<VideoListResponse>(`/v2/videos?filter=${filter}`, {}, { timeoutMs: 20_000 });
  },

  /** 상세 — 서명 재생 주소(10분, 만료 시 재조회)와 사용처. 없는 것·남의 것은 404. */
  getVideo(videoId: string): Promise<Video> {
    return request<Video>(`/v2/videos/${encodeURIComponent(videoId)}`, {}, { timeoutMs: 20_000 });
  },

  setVideoFavorite(videoId: string, favorite: boolean): Promise<Video> {
    return request<Video>(
      `/v2/videos/${encodeURIComponent(videoId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }) },
      { timeoutMs: 15_000 },
    );
  },

  /** 참조(회차·참여작)가 없을 때만 된다. 있으면 422 video_in_use 이고 아무것도 지워지지 않는다. */
  deleteVideo(videoId: string): Promise<void> {
    return request<void>(`/v2/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' }, { timeoutMs: 20_000 });
  },

  /** 참조가 있는 영상의 파일만 파기 — 회차·참여작 기록은 남고 재생만 막히며 총량에서 빠진다. */
  purgeVideoFile(videoId: string): Promise<Video> {
    return request<Video>(
      `/v2/videos/${encodeURIComponent(videoId)}/purge-file`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { timeoutMs: 20_000 },
    );
  },

  // 업로드 ---------------------------------------------------------------------
  /** presigned URL PUT. UploadTask를 노출해 화면 operation이 native 취소할 수 있게 한다. */
  startUploadToUrl(
    uploadUrl: string,
    fileUri: string,
    mimeType: string,
  ): {
    result: Promise<{ kind: 'uploaded' } | { kind: 'cancelled' }>;
    cancel: () => Promise<void>;
  } {
    const task = createUploadTask(uploadUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': mimeType },
    });
    let cancelled = false;
    const result = (async () => {
      try {
        const response = await task.uploadAsync();
        if (cancelled || response === null || response === undefined) {
          return { kind: 'cancelled' as const };
        }
        if (response.status < 200 || response.status >= 300) {
          throw new ApiError(
            response.status,
            translate('errors.uploadFail'),
          );
        }
        return { kind: 'uploaded' as const };
      } catch (error) {
        if (cancelled) return { kind: 'cancelled' as const };
        throw error;
      }
    })();
    return {
      result,
      cancel: async () => {
        cancelled = true;
        await task.cancelAsync();
      },
    };
  },

  // 회차(연습) ------------------------------------------------------------------
  /**
   * 새 연습을 시작한다(practice.start). 보관함에서 확정된 영상으로만 되고, 회차 하나와 분석 작업
   * 하나가 한 트랜잭션으로 생긴다. 같은 request_id 의 재전송은 같은 회차이고, 같은 id 에 다른
   * 본문이면 422 request_fingerprint_mismatch 다. 확정 전 영상은 422 video_not_ready.
   */
  createPractice(body: CreatePracticeBody, options: ApiCallOptions = {}): Promise<Practice> {
    return postIdempotent<Practice>('/v2/practices', body, {
      requestId: body.request_id,
      timeoutMs: 30_000,
      signal: options.signal,
    });
  },

  /**
   * 같은 묶음의 다음 회차를 만든다(practice.resume). video_id 를 빼면 그 회차의 영상을 그대로
   * 쓰고(A1.2), 실으면 새 영상이다(A8.1). 묶음에 닫히지 않은 회차가 있으면 409
   * practice_in_progress 이고 본문은 코드뿐이라 회차 id 는 묶음 조회에서 얻는다.
   */
  continuePractice(
    practiceId: string,
    body: ContinuePracticeBody,
    options: ApiCallOptions = {},
  ): Promise<Practice> {
    return postIdempotent<Practice>(
      `/v2/practices/${encodeURIComponent(practiceId)}/continue`,
      body,
      { requestId: body.request_id, timeoutMs: 30_000, signal: options.signal },
    );
  },

  /** 묶음 목록. 진행 중 회차 id 가 있으면 그 회차로 복귀시킨다. */
  listPracticeGroups(
    filter: PracticeGroupFilter = 'all',
    options: ApiCallOptions = {},
  ): Promise<{ groups: PracticeGroup[] }> {
    return request<{ groups: PracticeGroup[] }>(
      `/v2/practices?filter=${filter}`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  getPractice(practiceId: string, options: ApiCallOptions = {}): Promise<PracticeDetail> {
    return request<PracticeDetail>(
      `/v2/practices/${encodeURIComponent(practiceId)}`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  /** 묶음 상세(A1.2) — 회차 흐름·마지막 대화·영상. */
  getPracticeGroup(rootId: string, options: ApiCallOptions = {}): Promise<PracticeGroupDetail> {
    return request<PracticeGroupDetail>(
      `/v2/practices/${encodeURIComponent(rootId)}/group`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  /** 묶음 속성(즐겨찾기·숨김·제목). 숨김은 묶음 전체이고 노트·대화·기억은 지우지 않는다. */
  patchPracticeGroup(rootId: string, patch: GroupPatch): Promise<PracticeGroup> {
    return request<PracticeGroup>(
      `/v2/practices/${encodeURIComponent(rootId)}/group`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
      { timeoutMs: 20_000 },
    );
  },

  /** 회차 진행 상태(A10 폴링). 작업 상태와 분석 결과 상태는 다른 것이다. */
  getPracticeStatus(practiceId: string, options: ApiCallOptions = {}): Promise<PracticeStatus> {
    return request<PracticeStatus>(
      `/v2/practices/${encodeURIComponent(practiceId)}/status`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  /** "그만두기" — 작업을 failed/cancelled 로 끝낸다. 연습을 숨기지 않는다. */
  cancelPractice(practiceId: string, options: ApiCallOptions = {}): Promise<PracticeStatus> {
    return request<PracticeStatus>(
      `/v2/practices/${encodeURIComponent(practiceId)}/cancel`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { requestId: true, timeoutMs: 20_000, signal: options.signal },
    );
  },

  /**
   * 실패한 회차를 명시적으로 다시 시도한다 — 새 작업이 생기고 stage 가 analyzing 으로 돌아간다.
   * 다른 진행 중 회차가 있으면 409 practice_in_progress.
   */
  retryPracticeAnalysis(practiceId: string, options: ApiCallOptions = {}): Promise<Practice> {
    return request<Practice>(
      `/v2/practices/${encodeURIComponent(practiceId)}/analyze`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { requestId: true, timeoutMs: 30_000, signal: options.signal },
    );
  },

  // 대화(practice.coach) --------------------------------------------------------
  /**
   * 회차의 대화를 시작한다. 회차에 대화는 하나이고, 열린 대화가 있으면 같은 대화를 돌려준다.
   * 같은 request_id 재전송은 같은 대화다. 분석이 끝나지 않았으면 409 analysis_not_ready.
   */
  startConversation(practiceId: string, requestId: string): Promise<CoachTurnResult> {
    return postIdempotent<CoachTurnResult>(
      '/v2/coach/start',
      { practice_id: practiceId, request_id: requestId },
      { requestId, timeoutMs: 120_000 },
    );
  },

  /**
   * 답을 보낸다. revision 이 어긋나면 409 conversation_conflict 라 화면은 입력을 보존하고
   * 최신 대화를 다시 읽는다. 닫힌 대화면 409 conversation_closed.
   */
  replyToCoach(body: CoachReplyBody): Promise<CoachTurnResult> {
    return postIdempotent<CoachTurnResult>('/v2/coach/reply', body, {
      requestId: body.request_id,
      timeoutMs: 120_000,
    });
  },

  /** 충돌 뒤 다시 읽기·앱 재시작 때 쓰는 대화 조회. */
  getConversation(conversationId: string, options: ApiCallOptions = {}): Promise<CoachConversation> {
    return request<CoachConversation>(
      `/v2/coach/conversations/${encodeURIComponent(conversationId)}`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  // 연습 노트(practice.note) ------------------------------------------------------
  /** 회차의 노트. 없으면 404(대화가 짧아 노트를 만들지 않은 회차). */
  getPracticeNote(practiceId: string, options: ApiCallOptions = {}): Promise<PracticeNote> {
    return request<PracticeNote>(
      `/v2/practices/${encodeURIComponent(practiceId)}/note`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  // 이탈 설문(practice.feedback) --------------------------------------------------
  /**
   * 자동 노출 표식을 원자적으로 선점한다. 선점한 기기만 시트를 띄운다(두 기기가 동시에
   * 물어도 하나만). 이미 물어본 계정이면 asked_now 가 거짓이다.
   */
  claimFeedbackAsk(): Promise<{ asked_now: boolean }> {
    return request<{ asked_now: boolean }>(
      '/v2/me/practice-feedback/claim',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { requestId: true, timeoutMs: 15_000 },
    );
  },

  /** 소감 접수. 건너뛰기도 본문 없는 행으로 남는다. 실패해도 나가기를 막지 않는다. */
  submitPracticeFeedback(body: FeedbackBody): Promise<{ id: string }> {
    return postIdempotent<{ id: string }>('/v2/practice-feedback', body, {
      requestId: body.request_id,
      timeoutMs: 20_000,
    });
  },

  // 챌린지(04-challenge) ---------------------------------------------------------
  /**
   * 대사 목록. 탭은 인기·최신·종료·내 챌린지이고 q 는 2자 이상일 때만 보낸다(대사·작품·참여작
   * 작성자 이름만 찾는다). 오늘의 챌린지는 featured 로 따로 온다(인기·최신 탭에서만 고정).
   * 게스트·한국어가 아닌 회원은 403 member_only.
   */
  listChallenges(
    params: { tab: ChallengeTab; q?: string; cursor?: string } = { tab: 'popular' },
    options: ApiCallOptions = {},
  ): Promise<ChallengeListResponse> {
    const query = new URLSearchParams({ tab: params.tab });
    if (params.q) query.set('q', params.q);
    if (params.cursor) query.set('cursor', params.cursor);
    return request<ChallengeListResponse>(`/v2/challenges?${query.toString()}`, {}, {
      timeoutMs: 20_000,
      signal: options.signal,
    });
  },

  /** 대사 상세 + 집계. review·hidden·deleted 챌린지는 남의 눈에 404 다. */
  getChallenge(challengeId: string, options: ApiCallOptions = {}): Promise<ChallengeDetail> {
    return request<ChallengeDetail>(`/v2/challenges/${encodeURIComponent(challengeId)}`, {}, {
      timeoutMs: 20_000,
      signal: options.signal,
    });
  },

  /**
   * 대사 등록(A16.2). 같은 request_id 재전송은 같은 챌린지이고, 같은 대사로 진행 중 챌린지가
   * 있으면 422 duplicate_challenge, 하루 3개를 넘기면 429 daily_challenge_limit 다.
   */
  createChallenge(body: CreateChallengeBody): Promise<ChallengeDetail> {
    return postIdempotent<ChallengeDetail>('/v2/challenges', body, {
      requestId: body.request_id,
      timeoutMs: 30_000,
    });
  },

  /** 참여작이 없는 자기 챌린지만 지울 수 있다(422 challenge_has_entries). */
  deleteChallenge(challengeId: string): Promise<void> {
    return request<void>(`/v2/challenges/${encodeURIComponent(challengeId)}`, { method: 'DELETE' }, { timeoutMs: 20_000 });
  },

  /**
   * 참여작 목록(A17 랭킹·A15 피드). 좋아요순은 처음 조회한 순서를 10분 고정하고, 정렬 기준이
   * 바뀌면 410 cursor_expired 라 새로 조회한다.
   */
  listChallengeEntries(
    challengeId: string,
    params: { sort: EntrySort; cursor?: string; fromEntry?: string } = { sort: 'likes' },
    options: ApiCallOptions = {},
  ): Promise<EntriesResponse> {
    const query = new URLSearchParams({ sort: params.sort });
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.fromEntry) query.set('from_entry', params.fromEntry);
    return request<EntriesResponse>(
      `/v2/challenges/${encodeURIComponent(challengeId)}/entries?${query.toString()}`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  /** 저장한 참여작(A15.5). 반응·해제는 CM3 가 잇는다. */
  listSavedEntries(cursor?: string): Promise<{ entries: EntryCard[]; my_entry_count: number; saved_count: number }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request(`/v2/me/saved-entries${query}`, {}, { timeoutMs: 20_000 });
  },

  /** 내 참여작(P03). 분류별 수와 목록이 함께 온다. */
  listMyChallengeEntries(visibility?: 'public' | 'private'): Promise<{
    counts: { all: number; public: number; private: number; under_review: number };
    entries: EntryCard[];
  }> {
    const query = visibility ? `?visibility=${visibility}` : '';
    return request(`/v2/me/challenge-entries${query}`, {}, { timeoutMs: 20_000 });
  },

  // 입시 ----------------------------------------------------------------------
  // 공개 정보다. 가입 전에도 보여야 재방문 이유가 된다.
  async admissions(): Promise<AdmissionsResponse> {
    const data = await request<AdmissionsResponse>('/v2/admissions', {}, {
      auth: false,
      timeoutMs: 20_000,
    });
    return normalizeAdmissions(data);
  },

  /** 대학 하나만. 상세 화면이 쉰 곳치 공고를 통째로 받을 이유가 없다. */
  async admissionsByUniversity(universityId: string): Promise<AdmissionsResponse> {
    const data = await request<AdmissionsResponse>(
      `/v2/admissions/${encodeURIComponent(universityId)}`,
      {},
      { auth: false, timeoutMs: 20_000 },
    );
    return normalizeAdmissions(data);
  },
};

export type VideoFile = { uri: string; name: string; mimeType: string };
