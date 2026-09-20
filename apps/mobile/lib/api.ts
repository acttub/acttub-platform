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
import {
  sceneValueForSubmit,
  sendUploadIntent,
  type UploadIntentInput,
} from '@/lib/upload-input';
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
  /** true 면 배우가 직접 쓰거나 고친 칸이다. 코치는 이 칸을 덮지 않는다. */
  edited_by_me: boolean;
  /** 이 말이 나온 연습. 배우가 "왜 이렇게 적혔지" 를 되짚을 근거다. */
  source_practice_session_id: string | null;
};

/**
 * 화면에 여는 칸.
 *
 * 성별·나이는 **배우만 쓴다.** 코치는 영상이나 말투에서 추론하지 않는다 — 틀리면
 * 그 상태로 이후 모든 연습의 전제가 되고, 민감정보 추론이기도 하다. 데이터베이스
 * 제약이 코치의 쓰기를 막고 있어서, 화면이 그 칸을 채우는 유일한 통로다.
 */
export type MemoryField =
  | 'gender'
  | 'age'
  | 'goal'
  | 'blockage'
  | 'speech_self'
  | 'speech_actual';

/** 코치가 절대 쓰지 않는 칸. 화면에서 다르게 안내한다. */
export const ACTOR_ONLY_MEMORY_FIELDS: readonly MemoryField[] = ['gender', 'age'];

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

export type UploadIntent = {
  intent_id: string;
  upload_url: string;
  expires_at: string;
};

export type SessionStatus = 'analyzing' | 'analyzed' | 'failed';

export type PracticeSessionCreate = {
  session_id: string;
  status: SessionStatus;
  summary_id?: string | null;
};

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

export type PracticeSessionStatusPayload = {
  status: SessionStatus;
  error_code: PracticeSessionDetail['error_code'];
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

  // 업로드 ---------------------------------------------------------------------
  createUploadIntent(
    input: UploadIntentInput,
    options: ApiCallOptions = {},
  ): Promise<UploadIntent> {
    return sendUploadIntent(input, (body) =>
      postIdempotent<UploadIntent>(
        '/v2/uploads/intents',
        body,
        {
          timeoutMs: 30_000,
          signal: options.signal,
        },
      ),
    );
  },

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

  completeUpload(
    intentId: string,
    options: ApiCallOptions = {},
  ): Promise<{ intent_id: string; status: 'finalized' }> {
    return request(
      `/v2/uploads/intents/${encodeURIComponent(intentId)}/complete`,
      { method: 'POST' },
      { requestId: true, timeoutMs: 30_000, signal: options.signal },
    );
  },

  // 연습 세션 -------------------------------------------------------------------
  createPracticeSession(input: {
    upload_intent_id: string;
    scene: SceneContext;
    /** 배우가 고른 막히는 지점. 없으면 분기가 안 걸리므로 화면에서 반드시 채워 보낸다. */
    blockage: BlockageSelection;
    /** 이어서 연습 — 코치가 이 연습의 대화를 이어받는다. 없으면 가장 최근 대화(서버 기본). */
    continued_from?: string | null;
  }, options: ApiCallOptions = {}): Promise<PracticeSessionCreate> {
    return postIdempotent<PracticeSessionCreate>(
      '/v2/practice-sessions',
      {
        upload_intent_id: input.upload_intent_id,
        situation: sceneValueForSubmit(input.scene.situation),
        character_context: sceneValueForSubmit(input.scene.character),
        goal: sceneValueForSubmit(input.scene.goal),
        blockage_kind: input.blockage.blockage_kind,
        sub_branch: input.blockage.sub_branch,
        blockage_detail: input.blockage.blockage_detail,
        continued_from: input.continued_from ?? null,
      },
      { timeoutMs: 30_000, signal: options.signal },
    );
  },

  listPracticeSessions(): Promise<{ sessions: PracticeSessionListItem[] }> {
    return request('/v2/practice-sessions', {}, { timeoutMs: 30_000 });
  },

  getPracticeSession(
    sessionId: string,
    options: ApiCallOptions = {},
  ): Promise<PracticeSessionDetail> {
    return request<PracticeSessionDetail>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  getPracticeSessionStatus(
    sessionId: string,
    options: ApiCallOptions = {},
  ): Promise<PracticeSessionStatusPayload> {
    return request<PracticeSessionStatusPayload>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}/status`,
      {},
      { timeoutMs: 20_000, signal: options.signal },
    );
  },

  reanalyze(
    sessionId: string,
    options: ApiCallOptions = {},
  ): Promise<PracticeSessionCreate> {
    return request<PracticeSessionCreate>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}/analyze`,
      { method: 'POST' },
      { requestId: true, timeoutMs: 30_000, signal: options.signal },
    );
  },

  deletePracticeSession(sessionId: string): Promise<void> {
    return request<void>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
      { timeoutMs: 15_000 },
    );
  },

  // 코치 -----------------------------------------------------------------------
  /**
   * 질문 대화를 시작하거나 이어받는다.
   *
   * 서버는 열린 대화가 있으면 새로 만들지 않고 그대로 돌려준다 — 앱을 껐다 켜도
   * 하던 대화가 이어진다. 처음부터 다시 하려면 `restart` 를 켠다.
   */
  coachStart(
    practiceSessionId: string,
    options: { restart?: boolean } = {},
  ): Promise<CoachTurnResponse> {
    return postIdempotent<CoachTurnResponse>(
      '/v2/coach/start',
      {
        practice_session_id: practiceSessionId,
        ...(options.restart ? { restart: true } : {}),
      },
      { timeoutMs: 120_000 },
    );
  },

  coachReply(sessionId: string, text: string): Promise<CoachTurnResponse> {
    return postIdempotent<CoachTurnResponse>(
      '/v2/coach/reply',
      { session_id: sessionId, text },
      { timeoutMs: 120_000 },
    );
  },

  coachConfirm(
    coachSessionId: string,
    confirmed: boolean,
    rebuttalText?: string,
  ): Promise<CoachConfirmResponse> {
    return postIdempotent<CoachConfirmResponse>(
      '/v2/coach/confirm',
      {
        coach_session_id: coachSessionId,
        confirmed,
        ...(confirmed ? {} : { rebuttal_text: rebuttalText }),
      },
      { timeoutMs: 120_000 },
    );
  },

  // 리포트 ---------------------------------------------------------------------
  createReport(sessionId: string): Promise<PracticeReport> {
    return postIdempotent<PracticeReport>(
      '/v2/reports',
      { session_id: sessionId },
      { timeoutMs: 120_000 },
    );
  },

  reportHistory(): Promise<ReportHistoryResponse> {
    return request<ReportHistoryResponse>('/v2/reports', {}, { timeoutMs: 30_000 });
  },

  getReport(practiceSessionId: string): Promise<ReportDetail> {
    return request<ReportDetail>(
      `/v2/reports/${encodeURIComponent(practiceSessionId)}`,
      {},
      { timeoutMs: 20_000 },
    );
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
