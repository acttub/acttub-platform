import type {
  AdmissionsResponse,
} from './admissions';
import { normalizeAdmissions } from './admissions';
import type {
  CommentListResponse,
  CommunityCategory,
  CommunityComment,
  CommunityPost,
  PostListResponse,
} from './community';

import {
  createUploadTask,
  FileSystemUploadType,
} from 'expo-file-system/legacy';

import {
  clearTokensIfCurrent,
  commitRefreshedTokens,
  emitConsentRequired,
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
import {
  sendUploadIntent,
  type UploadIntentInput,
} from '@/lib/upload-input';

export { ApiError, NetworkError, RequestAbortError } from '@/lib/api-request';

/**
 * acttub v2 API (https://dev.acttub.com).
 * v1(Render, X-API-Key) → v2(Bearer JWT)로 전환.
 * - 인증: 소셜 로그인으로 받은 access/refresh 토큰. 401 시 refresh로 1회 자동 재발급 후 재시도.
 * - 업로드: multipart 직접 전송이 아니라 intent → presigned URL PUT → complete.
 * - 분석: 비동기 — practice-session 생성 후 상태를 폴링해 analyzed까지 기다린다.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://dev.acttub.com';
const requestClient = createApiRequestClient({
  baseUrl: BASE_URL,
  fetchImpl: (...args) => fetch(...args),
  waitForCredentialReady,
  getAccessToken,
  getRefreshToken,
  getAuthSessionEpoch,
  setTokens: commitRefreshedTokens,
  clearTokens: clearTokensIfCurrent,
  emitConsentRequired,
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
  handoff: { id: string; branch_kind: 'analysis' | 'expression' } | null;
  /** 대화가 정리돼 카드가 만들어졌으면 함께 온다. status==='complete' 여도 없을 수 있다. */
  report: PracticeReport | null;
  turns: CoachTurn[];
};

export type CoachTurn = { role: 'ai' | 'actor'; text: string };

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

export type BlockedReport = {
  report_type: 'blocked';
  reason:
    | 'confirmed_analysis_handoff_required'
    | 'confirmed_expression_handoff_required';
};

export type PracticeReport = AnalysisReport | ExpressionReport | BlockedReport;
export type SavedPracticeReport = AnalysisReport | ExpressionReport;

export type CoachConfirmResponse = {
  session_id: string;
  confirmed: boolean;
  handoff: CoachTurnResponse['handoff'];
  report: PracticeReport;
};

export type ReportRecord = {
  practice_session_id: string;
  report_type: 'analysis' | 'expression';
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
  status: 'active' | 'suspended';
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

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
  pending_consents: ConsentDocument[];
};

// ─── 업로드 / 세션 타입 ──────────────────────────────────────────────────────

export type UploadIntent = {
  intent_id: string;
  upload_url: string;
  expires_at: string;
};

export type SessionStatus = 'created' | 'analyzing' | 'analyzed' | 'failed';

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
  summary?: SceneSummary | null;
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
  /** 소셜 로그인 id_token으로 access/refresh 토큰 교환. provider 예: 'google'. */
  login(provider: string, idToken: string): Promise<TokenPair> {
    return request<TokenPair>(
      '/v2/auth/login',
      jsonInit({ provider, id_token: idToken }),
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

  recordConsent(documentId: string, action: 'granted' | 'declined' | 'revoked') {
    return request('/v2/consents', jsonInit({ document_id: documentId, action }), {
      requestId: true,
    });
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
            '영상 업로드에 실패했어요. 네트워크를 확인해주세요.',
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
  }, options: ApiCallOptions = {}): Promise<PracticeSessionCreate> {
    return postIdempotent<PracticeSessionCreate>(
      '/v2/practice-sessions',
      {
        upload_intent_id: input.upload_intent_id,
        situation: input.scene.situation,
        character_context: input.scene.character,
        goal: input.scene.goal,
        blockage_kind: input.blockage.blockage_kind,
        sub_branch: input.blockage.sub_branch,
        blockage_detail: input.blockage.blockage_detail,
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

  // 게시판 --------------------------------------------------------------------
  // 목록·상세는 로그인 없이 열린다. 쓰기만 토큰이 필요하다.
  communityCategories(): Promise<{ categories: CommunityCategory[] }> {
    return request<{ categories: CommunityCategory[] }>('/v2/community/categories', {}, {
      auth: false,
      timeoutMs: 15_000,
    });
  },

  communityPosts(params: { category?: string; cursor?: string } = {}): Promise<PostListResponse> {
    const query = new URLSearchParams();
    if (params.category) query.set('category', params.category);
    if (params.cursor) query.set('cursor', params.cursor);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<PostListResponse>(`/v2/community/posts${suffix}`, {}, {
      auth: false,
      timeoutMs: 20_000,
    });
  },

  communityPost(postId: string): Promise<CommunityPost> {
    return request<CommunityPost>(`/v2/community/posts/${encodeURIComponent(postId)}`, {}, {
      auth: false,
      timeoutMs: 20_000,
    });
  },

  communityComments(postId: string, cursor?: string): Promise<CommentListResponse> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<CommentListResponse>(
      `/v2/community/posts/${encodeURIComponent(postId)}/comments${suffix}`,
      {},
      { auth: false, timeoutMs: 20_000 },
    );
  },

  createCommunityPost(input: {
    category_slug: string;
    title: string;
    body: string;
    anonymous: boolean;
  }): Promise<CommunityPost> {
    return request<CommunityPost>('/v2/community/posts', jsonInit(input), { timeoutMs: 20_000 });
  },

  createCommunityComment(
    postId: string,
    input: { body: string; anonymous: boolean },
  ): Promise<CommunityComment> {
    return request<CommunityComment>(
      `/v2/community/posts/${encodeURIComponent(postId)}/comments`,
      jsonInit(input),
      { timeoutMs: 20_000 },
    );
  },

  likeCommunityPost(postId: string, liked: boolean): Promise<void> {
    return request<void>(
      `/v2/community/posts/${encodeURIComponent(postId)}/likes`,
      { method: liked ? 'POST' : 'DELETE' },
      { timeoutMs: 15_000 },
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
