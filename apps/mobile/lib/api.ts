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
  getAccessToken,
  getRefreshToken,
  getAuthSessionEpoch,
  setTokens: commitRefreshedTokens,
  clearTokens: clearTokensIfCurrent,
  emitConsentRequired,
});

// ─── 도메인 타입 ────────────────────────────────────────────────────────────

/** 앱 내부 표현. API로 보낼 땐 character → character_context 로 매핑한다. */
export type SubText = {
  situation: string;
  character: string;
  subtext: string;
};

export type SceneSummary = {
  summary_id: string;
  observation?: Record<string, unknown> | null;
  summary?: string | null;
  intent_alignment?: string | null;
  key_moment?: string | null;
  key_dimension?: string | null;
  anomalies?: Record<string, unknown>[] | null;
};

export type CoachTurnResponse = {
  session_id: string;
  action: 'probe_intent' | 'dig_cause' | 'deflect' | 'close';
  utterance: string;
  focus_timestamp: string;
  done: boolean;
  reason: 'gap_stated' | 'exhausted' | 'limit' | 'user_ended' | null;
};

export type CoachTurn = { role: 'ai' | 'actor'; text: string };

export type BiggestProblem = {
  start: string;
  end: string;
  dimension: string;
  description: string;
};

export type ActingReport = {
  headline: string;
  biggest_problem: BiggestProblem;
  evidence: string;
  self_discovery: string;
  encouragement: string;
  next_step: string;
  comparison: string;
};

export type CreateReportResponse = {
  report: ActingReport;
  report_count: number;
};

export type ReportRecord = {
  practice_session_id: string;
  headline: string;
  created_at: string;
};

export type ReportDetail = {
  practice_session_id: string;
  created_at: string;
  report: ActingReport;
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
  subtext: string;
  created_at: string;
  updated_at: string;
};

export type PracticeSessionDetail = {
  session_id: string;
  status: SessionStatus;
  situation: string;
  character_context: string;
  subtext: string;
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
    subtext: SubText;
  }, options: ApiCallOptions = {}): Promise<PracticeSessionCreate> {
    return postIdempotent<PracticeSessionCreate>(
      '/v2/practice-sessions',
      {
        upload_intent_id: input.upload_intent_id,
        situation: input.subtext.situation,
        character_context: input.subtext.character,
        subtext: input.subtext.subtext,
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
  coachStart(summaryId: string): Promise<CoachTurnResponse> {
    return postIdempotent<CoachTurnResponse>(
      '/v2/coach/start',
      { summary_id: summaryId },
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

  // 리포트 ---------------------------------------------------------------------
  createReport(sessionId: string): Promise<CreateReportResponse> {
    return postIdempotent<CreateReportResponse>(
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
};

export type VideoFile = { uri: string; name: string; mimeType: string };
