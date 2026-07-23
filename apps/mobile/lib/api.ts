import {
  FileSystemUploadType,
  uploadAsync,
} from 'expo-file-system/legacy';

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/lib/token-store';

/**
 * acttub v2 API (https://dev.acttub.com).
 * v1(Render, X-API-Key) → v2(Bearer JWT)로 전환.
 * - 인증: 소셜 로그인으로 받은 access/refresh 토큰. 401 시 refresh로 1회 자동 재발급 후 재시도.
 * - 업로드: multipart 직접 전송이 아니라 intent → presigned URL PUT → complete.
 * - 분석: 비동기 — practice-session 생성 후 상태를 폴링해 analyzed까지 기다린다.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://dev.acttub.com';

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
  created_at: string;
  /** 코치 세션 id (리포트를 만든 대화 세션). 연습 기록 삭제에는 쓰지 말 것 */
  session_id: string;
  /** 연습 세션 id — DELETE /v2/practice-sessions/{id} 에 사용 */
  practice_session_id: string;
  report: ActingReport;
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
  summary_id: string | null;
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
  playback_url: string;
  summary: SceneSummary | null;
  error_code:
    | 'gemini_timeout'
    | 'gemini_parse_error'
    | 'unsupported_media'
    | 'max_attempts_exceeded'
    | null;
};

// ─── 에러 ─────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 상태 코드를 사용자 언어로. */
async function friendlyError(res: Response): Promise<string> {
  switch (res.status) {
    case 401:
      return '로그인이 만료됐어요. 다시 로그인해주세요.';
    case 403:
      return '이 작업을 할 권한이 없어요.';
    case 413:
      return '영상이 너무 커서 서버가 받지 못했어요. 구간을 잘라 더 작게 올려주세요.';
    case 429:
      return '요청이 잠시 몰렸어요. 1분 뒤에 다시 시도해주세요.';
    case 502:
    case 503:
    case 504:
      return '서버가 잠시 불안정해요. 잠시 후 다시 시도해주세요.';
    default: {
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') return body.detail;
        if (Array.isArray(body?.detail) && body.detail[0]?.msg)
          return String(body.detail[0].msg);
      } catch {
        // JSON이 아니면 상태 코드만
      }
      return `HTTP ${res.status}`;
    }
  }
}

// ─── refresh (single-flight) ──────────────────────────────────────────────────

let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${BASE_URL}/v2/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };
    await setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

/** 동시에 여러 요청이 401을 만나도 refresh는 한 번만 돈다. */
function ensureRefreshed(): Promise<boolean> {
  if (!refreshing) {
    refreshing = refreshOnce().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// ─── 공통 요청 ────────────────────────────────────────────────────────────────

type ReqOpts = {
  auth?: boolean;
  timeoutMs?: number;
  requestId?: boolean;
};

function randomId(): string {
  const s = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${s()}${s()}-${s()}-${s()}-${s()}-${s()}${s()}${s()}`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: ReqOpts = {},
  _retried = false,
): Promise<T> {
  const { auth = true, timeoutMs = 60_000, requestId = false } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (auth) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (requestId && !headers['X-Request-Id']) headers['X-Request-Id'] = randomId();

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (res.status === 401 && auth && !_retried) {
      const ok = await ensureRefreshed();
      if (ok) return request<T>(path, init, opts, true);
      await clearTokens();
      throw new ApiError(401, '로그인이 만료됐어요. 다시 로그인해주세요.');
    }
    if (!res.ok) throw new ApiError(res.status, await friendlyError(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, '요청 시간이 초과됐어요. 네트워크를 확인하고 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
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

  recordConsent(documentId: string, action: 'granted' | 'declined' | 'revoked') {
    return request('/v2/consents', jsonInit({ document_id: documentId, action }), {
      requestId: true,
    });
  },

  // 업로드 ---------------------------------------------------------------------
  createUploadIntent(input: {
    mime_type: string;
    size_bytes: number;
    duration_ms?: number | null;
  }): Promise<UploadIntent> {
    return request<UploadIntent>('/v2/uploads/intents', jsonInit(input), {
      requestId: true,
      timeoutMs: 30_000,
    });
  },

  /** presigned URL에 파일 바이트를 그대로 PUT (우리 API가 아니라 스토리지로 직접). */
  async putToUploadUrl(uploadUrl: string, fileUri: string, mimeType: string): Promise<void> {
    const res = await uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': mimeType },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, '영상 업로드에 실패했어요. 네트워크를 확인해주세요.');
    }
  },

  completeUpload(intentId: string): Promise<{ intent_id: string; status: string }> {
    return request(
      `/v2/uploads/intents/${encodeURIComponent(intentId)}/complete`,
      { method: 'POST' },
      { requestId: true, timeoutMs: 30_000 },
    );
  },

  // 연습 세션 -------------------------------------------------------------------
  createPracticeSession(input: {
    upload_intent_id: string;
    subtext: SubText;
  }): Promise<PracticeSessionCreate> {
    return request<PracticeSessionCreate>(
      '/v2/practice-sessions',
      jsonInit({
        upload_intent_id: input.upload_intent_id,
        situation: input.subtext.situation,
        character_context: input.subtext.character,
        subtext: input.subtext.subtext,
      }),
      { requestId: true, timeoutMs: 30_000 },
    );
  },

  listPracticeSessions(): Promise<{ sessions: PracticeSessionListItem[] }> {
    return request('/v2/practice-sessions', {}, { timeoutMs: 30_000 });
  },

  getPracticeSession(sessionId: string): Promise<PracticeSessionDetail> {
    return request<PracticeSessionDetail>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}`,
      {},
      { timeoutMs: 20_000 },
    );
  },

  reanalyze(sessionId: string): Promise<PracticeSessionCreate> {
    return request<PracticeSessionCreate>(
      `/v2/practice-sessions/${encodeURIComponent(sessionId)}/analyze`,
      { method: 'POST' },
      { requestId: true, timeoutMs: 30_000 },
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
    return request<CoachTurnResponse>(
      '/v2/coach/start',
      jsonInit({ summary_id: summaryId }),
      { requestId: true, timeoutMs: 120_000 },
    );
  },

  coachReply(sessionId: string, text: string): Promise<CoachTurnResponse> {
    return request<CoachTurnResponse>(
      '/v2/coach/reply',
      jsonInit({ session_id: sessionId, text }),
      { requestId: true, timeoutMs: 120_000 },
    );
  },

  // 리포트 ---------------------------------------------------------------------
  createReport(sessionId: string): Promise<CreateReportResponse> {
    return request<CreateReportResponse>(
      '/v2/reports',
      jsonInit({ session_id: sessionId }),
      { requestId: true, timeoutMs: 120_000 },
    );
  },

  reportHistory(): Promise<ReportHistoryResponse> {
    return request<ReportHistoryResponse>('/v2/reports', {}, { timeoutMs: 30_000 });
  },
};

export type VideoFile = { uri: string; name: string; mimeType: string };
