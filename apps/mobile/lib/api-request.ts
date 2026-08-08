export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;

  constructor(
    status: number,
    message: string,
    code?: string,
    detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class NetworkError extends ApiError {
  constructor(message = '네트워크 연결을 확인하고 다시 시도해주세요.', cause?: unknown) {
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
        ? '요청 시간이 초과됐어요. 네트워크를 확인하고 다시 시도해주세요.'
        : '요청이 취소됐어요.',
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
  fetchImpl: typeof fetch;
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
  emitConsentRequired: () => void;
  emitAccountDeactivated: () => void;
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

export function friendlyError(status: number, body: unknown): string {
  switch (status) {
    case 401:
      return '로그인이 만료됐어요. 다시 로그인해주세요.';
    case 403:
      // 탈퇴한 계정은 "권한이 없다" 가 아니라 계정이 사라진 것이다. 그대로 두면
      // 왜 아무것도 안 되는지 알 수 없다.
      return errorDetail(body) === 'account_deactivated'
        ? '탈퇴한 계정이에요. 다시 시작하려면 새로 로그인해주세요.'
        : '이 작업을 할 권한이 없어요.';
    case 413:
      return '영상이 너무 커서 서버가 받지 못했어요. 구간을 잘라 더 작게 올려주세요.';
    case 422:
      return '입력값을 확인해주세요. 문제가 계속되면 영상을 다시 선택해주세요.';
    case 429:
      return '요청이 잠시 몰렸어요. 1분 뒤에 다시 시도해주세요.';
    case 500:
      return '서버 오류가 발생했어요. 잠시 후 다시 시도해주세요.';
    case 502:
    case 503:
    case 504:
      return '서버가 잠시 불안정해요. 잠시 후 다시 시도해주세요.';
    default: {
      const detail = errorDetail(body);
      if (typeof detail === 'string') return detail;
      return `요청을 처리하지 못했어요. (오류 ${status})`;
    }
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const detail = errorDetail(body);
  const code =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? 'validation_error'
        : 'unknown_error';
  return new ApiError(status, friendlyError(status, body), code, detail);
}

function randomId(random: () => number): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const part = () =>
    Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${part()}${part()}-${part()}-${part()}-${part()}-${part()}${part()}${part()}`;
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
      throw new NetworkError('응답을 읽는 중 연결이 끊어졌어요. 다시 시도해주세요.', error);
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
      '로그인 계정이 변경되어 요청을 중단했어요. 다시 시도해주세요.',
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

  async function fetchParsed(
    path: string,
    init: RequestInit,
    options: ApiRequestOptions,
  ): Promise<ParsedResponse> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const composed = attemptSignal(options.signal, timeoutMs, clock);
    try {
      const headers = new Headers(init.headers);
      if (options.auth !== false) {
        const token = dependencies.getAccessToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      }
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
      return { response, payload: await readPayload(response) };
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
    if (!response.ok) throw toApiError(response.status, payload);
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

  async function request<T>(
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
        throw new ApiError(401, '로그인이 만료됐어요. 다시 로그인해주세요.', 'unauthorized');
      }
      if (refresh.kind === 'session_changed') throw sessionChangedError();
      assertSameAuthSession(authSessionEpoch!);
      return request<T>(path, init, options, true, authSessionEpoch!);
    }

    if (!response.ok) {
      const error = toApiError(response.status, payload);
      // 403 은 코드로 갈린다 — 동의는 받으면 풀리고, 탈퇴는 풀 수 없어 내보내야 한다.
      if (error.status === 403) {
        if (error.code === 'consent_required') dependencies.emitConsentRequired();
        else if (error.code === 'account_deactivated') dependencies.emitAccountDeactivated();
      }
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
    const requestId = options.requestId ?? randomId(random);
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

  return {
    request,
    postIdempotent,
  };
}
