import { translate } from './i18n.ts';
import { newRequestId } from './request-id.ts';
import { consumeCoachStream, streamFailureAction, type ByteReader } from './coach-stream.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;
  /** 오류 본문 전체. 코드 말고 정보를 더 싣는 오류 둘(pending_consents·providers)을 여기서 읽는다. */
  readonly body?: unknown;

  constructor(
    status: number,
    message: string,
    code?: string,
    detail?: unknown,
    body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }
}

export class NetworkError extends ApiError {
  constructor(message = translate('errors.network'), cause?: unknown) {
    super(0, message, 'network_error', cause);
    this.name = 'NetworkError';
  }
}

export type RequestAbortKind = 'timeout' | 'cancelled';

export class RequestAbortError extends ApiError {
  readonly kind: RequestAbortKind;

  constructor(kind: RequestAbortKind) {
    super(
      0,
      kind === 'timeout'
        ? translate('errors.timeout')
        : translate('errors.aborted'),
      kind,
    );
    this.name = 'RequestAbortError';
    this.kind = kind;
  }
}

export type RequestClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

export type ApiRequestDependencies = {
  baseUrl: string;
  /** 요청마다 보내는 클라이언트 종류와 판. 예: app/0.1.0. 없으면 서버가 426으로 답한다. */
  clientHeader: string;
  fetchImpl: typeof fetch;
  /**
   * 본문을 스트림으로 읽을 수 있는 fetch(RN 은 expo/fetch). 없으면 postIdempotentStream 은 곧장 일반 호출로 간다.
   */
  streamFetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * 서버가 AI 답변을 어느 말로 쓸지 정하는 데 쓴다(Accept-Language).
   * 없으면 한국어 — 옛 동작 그대로다.
   */
  getLanguage?: () => string;
  waitForCredentialReady: () => Promise<void>;
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  getAuthSessionEpoch: () => number;
  setTokens: (
    accessToken: string,
    refreshToken: string,
    expectation: AuthCredentialExpectation,
  ) => Promise<RefreshCommitResult>;
  clearTokens: (
    expectation: AuthCredentialExpectation,
  ) => Promise<boolean>;
  emitConsentRequired: (pendingConsents: unknown[]) => void;
  emitProfileRequired: () => void;
  emitAccountDeactivated: () => void;
  emitUpdateRequired: () => void;
  clock?: RequestClock;
  random?: () => number;
};

export type ApiRequestOptions = {
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  retryOn401?: boolean;
};

export type RetryWaitReason = 'processing' | 'rate_limited' | 'network';

export type PostIdempotentStreamOptions = PostIdempotentOptions & {
  /** 코치가 쓰는 글이 한 조각 올 때마다. */
  onDelta?: (text: string) => void;
  /** 쓰던 조각을 버려야 할 때(오류·끊김·일반 호출로 전환). */
  onReset?: () => void;
};

export type PostIdempotentOptions = ApiRequestOptions & {
  requestId?: string;
  deadlineMs?: number;
  onWait?: (info: {
    reason: RetryWaitReason;
    attempt: number;
    delayMs: number;
  }) => void;
};

type ParsedResponse = {
  response: Response;
  payload: unknown;
};

type RefreshResult =
  | { kind: 'refreshed' }
  | { kind: 'invalid' }
  | { kind: 'session_changed' };

export type AuthCredentialExpectation = {
  authSessionEpoch: number;
  refreshToken: string | null;
};

export type RefreshCommitResult =
  | 'refreshed'
  | 'principal_changed'
  | 'stale';

const defaultClock: RequestClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function errorDetail(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return 'detail' in body ? body.detail : undefined;
}

/** JSON 응답의 사본 — 합친 GET 응답을 나눠 줄 때 쓴다. 글·숫자·빈 응답은 그대로 둔다. */
function copyPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  return JSON.parse(JSON.stringify(payload));
}

export function friendlyError(status: number, body: unknown): string {
  if (errorDetail(body) === 'client_contract_required') return translate('errors.clientContractRequired');
  switch (status) {
    case 401:
      return translate('errors.sessionExpired');
    case 403:
      // 탈퇴한 계정은 "권한이 없다" 가 아니라 계정이 사라진 것이다. 그대로 두면
      // 왜 아무것도 안 되는지 알 수 없다.
      return errorDetail(body) === 'account_deactivated'
        ? translate('errors.withdrawn')
        : translate('errors.forbidden');
    case 413:
      return translate('errors.tooLarge');
    case 422:
      return translate('errors.badInput');
    case 429:
      return translate('errors.rateLimited');
    case 500:
      return translate('errors.server');
    case 502:
    case 503:
    case 504:
      return translate('errors.unstable');
    default: {
      const detail = errorDetail(body);
      if (typeof detail === 'string') return detail;
      return translate('errors.generic', { status });
    }
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const detail = errorDetail(body);
  // 426의 detail은 코드가 아니라 안내 문장이다. 상태 코드로 알아본다.
  const code =
    status === 426
      ? 'update_required'
      : typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? 'validation_error'
          : 'unknown_error';
  return new ApiError(status, friendlyError(status, body), code, detail, body);
}

/**
 * 하루·횟수 한도에 걸린 429(daily_entry_limit, free_daily_coaching_limit 같은 `*_limit`)인지. 잠깐 붐빈 429
 * (rate limit exceeded, script_upload_busy)와 달리 다시 보내도 풀리지 않으니 기다리지 않고 바로 알린다.
 */
export function isQuotaLimit(error: unknown): boolean {
  return errorStatus(error) === 429 && /_limit$/.test(errorCode(error) ?? '');
}

/** 오류의 사유 코드와 상태. ApiError 가 아니어도 code·status 칸의 모양만 본다. */
export function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function errorStatus(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/** 연결 실패로 본다 — 끊겼거나(NetworkError) 상태가 없거나 서버 5xx. 시간 초과·취소(RequestAbortError)는 아니다. */
export function isOfflineError(error: unknown): boolean {
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  const status = errorStatus(error);
  return name === 'NetworkError' || status === null || (status >= 500 && status <= 599);
}

function siblingList(error: unknown, key: string): unknown[] {
  if (!(error instanceof ApiError)) return [];
  const body = error.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

/** 403 consent_required에 함께 실린 미결정 문서 목록. 없으면 빈 목록. */
export function pendingConsentsOf(error: unknown): unknown[] {
  return siblingList(error, 'pending_consents');
}

/** 이메일 겹침 409에 함께 실린 기존 계정의 제공자 이름. 없으면 빈 목록. */
export function conflictProviders(error: unknown): string[] {
  return siblingList(error, 'providers').filter(
    (provider): provider is string => typeof provider === 'string',
  );
}

export type UnprocessableKind =
  | { kind: 'reason'; code: string }
  | { kind: 'client_bug' };

/**
 * 422를 가른다. detail이 글자면 규칙에 걸린 사유 코드이고, 배열이면 본문 모양이 틀린
 * 것이라 앱 버그다. 422가 아니면 null.
 */
export function classifyUnprocessable(error: unknown): UnprocessableKind | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  return typeof error.detail === 'string'
    ? { kind: 'reason', code: error.detail }
    : { kind: 'client_bug' };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestAbortError('cancelled');
}

function attemptSignal(
  source: AbortSignal | undefined,
  timeoutMs: number,
  clock: RequestClock,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new RequestAbortError('cancelled'));
  if (source?.aborted) onAbort();
  else source?.addEventListener('abort', onAbort, { once: true });
  const timer = clock.setTimeout(
    () => controller.abort(new RequestAbortError('timeout')),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clock.clearTimeout(timer);
      source?.removeEventListener('abort', onAbort);
    },
  };
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError(translate('errors.readCut'), error);
    }
    throw error;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function waitForShared<T>(source: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return source;
  throwIfCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new RequestAbortError('cancelled'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void source.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function wait(delayMs: number, signal: AbortSignal | undefined, clock: RequestClock): Promise<void> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clock.clearTimeout(timer);
      cleanup();
      reject(new RequestAbortError('cancelled'));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createApiRequestClient(dependencies: ApiRequestDependencies) {
  const clock = dependencies.clock ?? defaultClock;
  const random = dependencies.random ?? Math.random;
  let refreshing: Promise<RefreshResult> | null = null;

  function sessionChangedError(): ApiError {
    return new ApiError(
      401,
      translate('errors.accountChanged'),
      'session_changed',
    );
  }

  function assertSameAuthSession(expectedEpoch: number): void {
    if (dependencies.getAuthSessionEpoch() !== expectedEpoch) {
      throw sessionChangedError();
    }
  }

  function supersededRefreshResult(expectedEpoch: number): RefreshResult {
    return dependencies.getAuthSessionEpoch() === expectedEpoch
      ? { kind: 'refreshed' }
      : { kind: 'session_changed' };
  }

  function buildHeaders(source: HeadersInit | undefined, options: ApiRequestOptions): Headers {
    const headers = new Headers(source);
    headers.set('X-Acttub-Contract', 'three_layers_v1');
    headers.set('X-Acttub-Client', dependencies.clientHeader);
    headers.set('Accept-Language', dependencies.getLanguage?.() ?? 'ko');
    if (options.auth !== false) {
      const token = dependencies.getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  /** 403 은 코드로 갈린다 — 동의와 프로필은 채우면 풀리고, 탈퇴는 풀 수 없어 내보내야 한다. */
  function emitForbiddenSideEffects(error: ApiError): void {
    if (error.status !== 403) return;
    if (error.code === 'consent_required') {
      dependencies.emitConsentRequired(pendingConsentsOf(error));
    } else if (error.code === 'profile_required') {
      dependencies.emitProfileRequired();
    } else if (error.code === 'account_deactivated') {
      dependencies.emitAccountDeactivated();
    }
  }

  async function fetchParsed(
    path: string,
    init: RequestInit,
    options: ApiRequestOptions,
  ): Promise<ParsedResponse> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const composed = attemptSignal(options.signal, timeoutMs, clock);
    try {
      const headers = buildHeaders(init.headers, options);
      let response: Response;
      try {
        response = await dependencies.fetchImpl(`${dependencies.baseUrl}${path}`, {
          ...init,
          headers,
          signal: composed.signal,
        });
      } catch (error) {
        if (composed.signal.aborted) {
          const reason = composed.signal.reason;
          throw reason instanceof RequestAbortError
            ? reason
            : new RequestAbortError(options.signal?.aborted ? 'cancelled' : 'timeout');
        }
        if (error instanceof TypeError) throw new NetworkError(undefined, error);
        throw error;
      }
      if (composed.signal.aborted) {
        throw composed.signal.reason instanceof RequestAbortError
          ? composed.signal.reason
          : new RequestAbortError(options.signal?.aborted ? 'cancelled' : 'timeout');
      }
      const payload = await readPayload(response);
      // 로그인·갱신을 포함해 어느 요청이든 426이면 이 빌드로는 더 쓸 수 없다.
      if (response.status === 426) dependencies.emitUpdateRequired();
      return { response, payload };
    } finally {
      composed.cleanup();
    }
  }

  async function refreshOnce(failedAccess?: string): Promise<RefreshResult> {
    if (
      failedAccess !== undefined &&
      dependencies.getAccessToken() !== null &&
      dependencies.getAccessToken() !== failedAccess
    ) {
      return { kind: 'refreshed' };
    }
    const expectedEpoch = dependencies.getAuthSessionEpoch();
    const refreshToken = dependencies.getRefreshToken();
    const expectation: AuthCredentialExpectation = {
      authSessionEpoch: expectedEpoch,
      refreshToken,
    };
    if (!refreshToken) {
      const cleared = await dependencies.clearTokens(expectation);
      return cleared === false
        ? supersededRefreshResult(expectedEpoch)
        : { kind: 'invalid' };
    }

    const { response, payload } = await fetchParsed(
      '/v2/auth/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      { auth: false, timeoutMs: 30_000 },
    );
    if (response.status === 401 || response.status === 422) {
      const cleared = await dependencies.clearTokens(expectation);
      return cleared === false
        ? supersededRefreshResult(expectedEpoch)
        : { kind: 'invalid' };
    }
    if (!response.ok) {
      const error = toApiError(response.status, payload);
      // 탈퇴한 계정은 refresh 도 403 account_deactivated 다. 다시 시도로 풀리지 않으니 탈퇴 신호를 내 기기 세션을 지운다 —
      // 내지 않으면 재동의 창이 「다시 불러오기」만 되풀이하고 로그인으로 나갈 길이 없었다(SOMA-925).
      emitForbiddenSideEffects(error);
      throw error;
    }
    const tokens = payload as {
      access_token: string;
      refresh_token: string;
    };
    if (dependencies.getAuthSessionEpoch() !== expectedEpoch) {
      return { kind: 'session_changed' };
    }
    if (dependencies.getRefreshToken() !== refreshToken) return { kind: 'refreshed' };
    const commit = await dependencies.setTokens(
      tokens.access_token,
      tokens.refresh_token,
      expectation,
    );
    if (commit === 'principal_changed') {
      return { kind: 'session_changed' };
    }
    if (commit === 'stale') return supersededRefreshResult(expectedEpoch);
    return { kind: 'refreshed' };
  }

  function ensureRefreshed(failedAccess?: string): Promise<RefreshResult> {
    if (refreshing) return refreshing;
    const pending = refreshOnce(failedAccess);
    refreshing = pending;
    void pending.then(
      () => {
        if (refreshing === pending) refreshing = null;
      },
      () => {
        if (refreshing === pending) refreshing = null;
      },
    );
    return pending;
  }

  // 같은 GET이 동시에 여러 번 나가면 하나만 보내고 응답을 나눈다(SOMA-829). 탭 레이아웃·홈·탭 화면이 앱을 열 때
  // 같은 목록을 한꺼번에 읽어 계정 1분 요청 한도(SOMA-825)를 빨리 채웠다. 끝난 응답은 남기지 않는다 — 캐시가 아니다.
  // 취소 신호가 있거나(한쪽 취소가 다른 쪽을 끊지 않게) 401 재시도 중인 요청은 합치지 않는다. 나눠 받는 쪽은 사본을
  // 받아, 한 화면이 응답을 고쳐도 다른 화면에 번지지 않는다.
  const inflightGets = new Map<string, Promise<unknown>>();

  function request<T>(
    path: string,
    init: RequestInit = {},
    options: ApiRequestOptions = {},
    retried = false,
    originalAuthSessionEpoch?: number,
  ): Promise<T> {
    const method = (init.method ?? 'GET').toUpperCase();
    const shareable =
      method === 'GET' &&
      init.body == null &&
      !options.signal &&
      !retried &&
      originalAuthSessionEpoch === undefined;
    if (!shareable) return requestOnce<T>(path, init, options, retried, originalAuthSessionEpoch);
    const key = [
      options.auth === false ? 'anon' : dependencies.getAuthSessionEpoch(),
      path,
      JSON.stringify(init.headers ?? null),
    ].join('|');
    const existing = inflightGets.get(key);
    if (existing) return existing.then((payload) => copyPayload(payload) as T);
    const pending = requestOnce<T>(path, init, options, retried, originalAuthSessionEpoch);
    inflightGets.set(key, pending);
    const clear = () => {
      if (inflightGets.get(key) === pending) inflightGets.delete(key);
    };
    pending.then(clear, clear);
    return pending;
  }

  async function requestOnce<T>(
    path: string,
    init: RequestInit = {},
    options: ApiRequestOptions = {},
    retried = false,
    originalAuthSessionEpoch?: number,
  ): Promise<T> {
    throwIfCancelled(options.signal);
    const auth = options.auth !== false;
    if (auth) {
      await waitForShared(dependencies.waitForCredentialReady(), options.signal);
      throwIfCancelled(options.signal);
    }
    const authSessionEpoch = auth
      ? originalAuthSessionEpoch ?? dependencies.getAuthSessionEpoch()
      : null;
    if (authSessionEpoch !== null) assertSameAuthSession(authSessionEpoch);
    const failedAccess = auth ? dependencies.getAccessToken() : null;
    const { response, payload } = await fetchParsed(path, init, options);
    throwIfCancelled(options.signal);
    if (authSessionEpoch !== null) assertSameAuthSession(authSessionEpoch);

    if (response.status === 401 && auth && options.retryOn401 !== false && !retried) {
      assertSameAuthSession(authSessionEpoch!);
      const refresh = await waitForShared(
        ensureRefreshed(failedAccess ?? undefined),
        options.signal,
      );
      throwIfCancelled(options.signal);
      if (refresh.kind === 'invalid') {
        throw new ApiError(401, translate('errors.sessionExpired'), 'unauthorized');
      }
      if (refresh.kind === 'session_changed') throw sessionChangedError();
      assertSameAuthSession(authSessionEpoch!);
      return request<T>(path, init, options, true, authSessionEpoch!);
    }

    if (!response.ok) {
      const error = toApiError(response.status, payload);
      emitForbiddenSideEffects(error);
      throw error;
    }
    return payload as T;
  }

  async function postIdempotent<T>(
    path: string,
    body: unknown,
    options: PostIdempotentOptions = {},
  ): Promise<T> {
    if (options.auth !== false) {
      await waitForShared(dependencies.waitForCredentialReady(), options.signal);
      throwIfCancelled(options.signal);
    }
    const authSessionEpoch =
      options.auth === false ? undefined : dependencies.getAuthSessionEpoch();
    const requestId = options.requestId ?? newRequestId();
    const serializedBody =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const deadlineMs = options.deadlineMs ?? 120_000;
    const deadline = clock.now() + deadlineMs;
    let processingAttempts = 0;
    let rateLimitAttempts = 0;
    let networkAttempts = 0;
    let lastError: unknown;

    while (true) {
      throwIfCancelled(options.signal);
      if (authSessionEpoch !== undefined) assertSameAuthSession(authSessionEpoch);
      const remainingMs = deadline - clock.now();
      if (remainingMs <= 0) {
        if (lastError !== undefined) throw lastError;
        throw new RequestAbortError('timeout');
      }
      try {
        return await request<T>(
          path,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Request-Id': requestId,
            },
            body: serializedBody,
          },
          {
            auth: options.auth,
            signal: options.signal,
            timeoutMs: Math.min(options.timeoutMs ?? 60_000, remainingMs),
            retryOn401: options.retryOn401,
          },
          false,
          authSessionEpoch,
        );
      } catch (error) {
        lastError = error;
        let reason: RetryWaitReason;
        let attempt: number;
        let delayMs: number;

        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === 'request is still processing'
        ) {
          reason = 'processing';
          attempt = ++processingAttempts;
          delayMs = Math.min(10_000, 2_000 * 1.5 ** (attempt - 1));
        } else if (
          error instanceof ApiError &&
          error.status === 429 &&
          !isQuotaLimit(error) &&
          rateLimitAttempts < 4
        ) {
          reason = 'rate_limited';
          attempt = ++rateLimitAttempts;
          delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1)) + random() * 500;
        } else if (error instanceof NetworkError && networkAttempts < 3) {
          reason = 'network';
          attempt = ++networkAttempts;
          delayMs = 1_000 * 2 ** (attempt - 1);
        } else {
          throw error;
        }

        const waitRemainingMs = deadline - clock.now();
        if (waitRemainingMs <= 0) throw error;
        const boundedDelayMs = Math.min(delayMs, waitRemainingMs);
        options.onWait?.({ reason, attempt, delayMs: boundedDelayMs });
        await wait(boundedDelayMs, options.signal, clock);
        if (authSessionEpoch !== undefined) assertSameAuthSession(authSessionEpoch);
      }
    }
  }

  type StreamAttempt<T> = Awaited<ReturnType<typeof consumeCoachStream<T>>>;

  /** 스트림 한 번. HTTP 오류는 일반 호출과 똑같이 던지고, 200 이면 done/error/dropped 로 돌려준다. */
  async function streamAttempt<T>(
    path: string,
    serializedBody: string | undefined,
    requestId: string,
    options: PostIdempotentStreamOptions,
    deadline: number,
    authSessionEpoch: number | undefined,
    retried = false,
  ): Promise<StreamAttempt<T>> {
    throwIfCancelled(options.signal);
    if (authSessionEpoch !== undefined) assertSameAuthSession(authSessionEpoch);
    const remainingMs = deadline - clock.now();
    if (remainingMs <= 0) throw new RequestAbortError('timeout');
    const failedAccess = options.auth === false ? null : dependencies.getAccessToken();
    const composed = attemptSignal(
      options.signal,
      Math.min(options.timeoutMs ?? 60_000, remainingMs),
      clock,
    );
    try {
      const headers = buildHeaders(
        { 'Content-Type': 'application/json', 'X-Request-Id': requestId, Accept: 'text/event-stream' },
        options,
      );
      let response: Response;
      try {
        response = await dependencies.streamFetchImpl!(`${dependencies.baseUrl}${path}`, {
          method: 'POST',
          headers,
          body: serializedBody,
          signal: composed.signal,
        });
      } catch (error) {
        if (composed.signal.aborted) {
          const reason = composed.signal.reason;
          throw reason instanceof RequestAbortError
            ? reason
            : new RequestAbortError(options.signal?.aborted ? 'cancelled' : 'timeout');
        }
        throw new NetworkError(undefined, error);
      }
      if (response.status === 426) dependencies.emitUpdateRequired();
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
        if (response.ok) {
          // 200 인데 스트림이 아니다(프록시·구버전). 일반 호출로 되돌린다.
          throw new ApiError(501, 'stream_unsupported', 'stream_unsupported');
        }
        const payload = await readPayload(response);
        if (
          response.status === 401 &&
          options.auth !== false &&
          options.retryOn401 !== false &&
          !retried
        ) {
          // 아래에서 토큰을 갱신하고 한 번 더 시도한다.
        } else {
          const error = toApiError(response.status, payload);
          emitForbiddenSideEffects(error);
          throw error;
        }
      } else {
        const reader = (response.body as unknown as { getReader: () => ByteReader }).getReader();
        const outcome = await consumeCoachStream<T>(reader, (text) => options.onDelta?.(text));
        throwIfCancelled(options.signal);
        if (composed.signal.aborted && outcome.kind === 'dropped') {
          const reason = composed.signal.reason;
          throw reason instanceof RequestAbortError ? reason : new RequestAbortError('timeout');
        }
        return outcome;
      }
    } finally {
      composed.cleanup();
    }
    // 여기는 401 → 토큰을 갱신하고 한 번 더.
    assertSameAuthSession(authSessionEpoch!);
    const refresh = await waitForShared(ensureRefreshed(failedAccess ?? undefined), options.signal);
    throwIfCancelled(options.signal);
    if (refresh.kind === 'invalid') {
      throw new ApiError(401, translate('errors.sessionExpired'), 'unauthorized');
    }
    if (refresh.kind === 'session_changed') throw sessionChangedError();
    assertSameAuthSession(authSessionEpoch!);
    return streamAttempt<T>(path, serializedBody, requestId, options, deadline, authSessionEpoch, true);
  }

  /**
   * postIdempotent 의 스트리밍판. 스트림 경로(streamPath)로 시도하고, 서버가 모르거나(404·405)
   * 스트림이 안 되거나 도중에 끊기면 같은 request_id·본문으로 일반 경로(path)를 한 번 부른다.
   * 서버는 끊겨도 끝까지 만들어 저장하므로 일반 호출이 저장된 결과를 돌려준다(처리 중이면 409 대기 재시도는
   * postIdempotent 가 한다). 전체 제한 시간(deadlineMs, 기본 120초)은 두 시도가 함께 쓴다.
   */
  async function postIdempotentStream<T>(
    streamPath: string,
    path: string,
    body: unknown,
    options: PostIdempotentStreamOptions = {},
  ): Promise<T> {
    const requestId = options.requestId ?? newRequestId();
    const deadline = clock.now() + (options.deadlineMs ?? 120_000);
    const fallback = () => {
      const remainingMs = deadline - clock.now();
      if (remainingMs <= 0) throw new RequestAbortError('timeout');
      return postIdempotent<T>(path, body, { ...options, requestId, deadlineMs: remainingMs });
    };
    if (!dependencies.streamFetchImpl) return fallback();

    if (options.auth !== false) {
      await waitForShared(dependencies.waitForCredentialReady(), options.signal);
      throwIfCancelled(options.signal);
    }
    const authSessionEpoch =
      options.auth === false ? undefined : dependencies.getAuthSessionEpoch();
    const serializedBody =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

    let outcome: StreamAttempt<T>;
    try {
      outcome = await streamAttempt<T>(
        streamPath,
        serializedBody,
        requestId,
        options,
        deadline,
        authSessionEpoch,
      );
    } catch (error) {
      const info =
        error instanceof ApiError
          ? { status: error.status, code: error.code, name: error.name }
          : null;
      if (!info || streamFailureAction(info) === 'throw') throw error;
      options.onReset?.();
      return fallback();
    }
    if (outcome.kind === 'done') return outcome.value;
    options.onReset?.();
    if (outcome.kind === 'dropped') return fallback();
    const error = toApiError(
      outcome.status,
      outcome.detail === undefined ? undefined : { detail: outcome.detail },
    );
    emitForbiddenSideEffects(error);
    if (streamFailureAction({ status: error.status, code: error.code }) === 'fallback') {
      return fallback();
    }
    throw error;
  }

  return {
    request,
    postIdempotent,
    postIdempotentStream,
  };
}
