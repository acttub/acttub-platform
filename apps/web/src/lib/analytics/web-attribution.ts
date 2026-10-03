import {
  STORE_CAMPAIGN_PARAMS,
  isSafeCampaignValue,
  storeCampaignParams,
} from "@/lib/app-download/store-links";
import {
  putWebAttribution,
  type WebAttributionRequest,
} from "@/lib/api/v2/web-attribution";
import { onSessionEvent } from "@/lib/auth/session-events";
import {
  REFRESH_KEY,
  getStoredUser,
  hasGuestSession,
} from "@/lib/auth/token-store";

const SESSION_KEY = "acttub.web_attribution.pending";

const REQUEST_KEYS = {
  utm_source: "channel",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_content: "content",
  utm_term: "term",
} as const;

type CapturedAttribution = {
  request: WebAttributionRequest;
  /** 내부 이동에서 보존할 안전 UTM. utm_id도 URL 안에서만 함께 보존한다. */
  query: string;
};

type StoredAttribution = {
  userId: string;
  request: WebAttributionRequest;
};

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ControllerDependencies = {
  send: (
    request: WebAttributionRequest,
    options: { signal: AbortSignal },
  ) => Promise<void>;
  currentUserId: () => string | null;
  sessionStore: () => SessionStore | null;
  stripCurrentUrl: () => void;
};

export type WebAttributionController = {
  /** 이 문서가 처음 열린 실제 URL을 딱 한 번만 읽는다. 기존 게스트의 재방문은 후보가 아니다. */
  captureInitial: (search: string, hadGuestSession: boolean) => void;
  /** privacy 동의가 서버에서 확인된 게스트에게만 귀속을 시도한다. */
  activate: (userId: string) => Promise<boolean>;
  /** 동의 재확인·오류 중에는 진행 중 전송만 멈추고 후보는 보존한다. */
  pause: () => void;
  /** 게스트가 끝났거나 다른 탭에서 경계가 생기면 후보를 폐기한다. */
  invalidate: () => void;
  /** 같은 탭에서 이번 진입 중 새로 만든 게스트 id에 현재 입장 후보를 묶는다. */
  guestStarted: (userId: string) => void;
  /** 주소를 바꾸는 앱 내부 이동에서 아직 저장하지 못한 안전 UTM을 보존한다. */
  preservePath: (path: string) => string;
};

/**
 * 실제 URL에서 기존 스토어 링크와 같은 허용목록·문자·길이 검사를 통과한 UTM만 읽는다.
 * utm_source가 없으면 유입으로 만들지 않는다. 미태깅 방문을 direct나 광고 아님으로 추정하지
 * 않고 아무것도 저장하지 않는다.
 */
export function webAttributionFromSearch(
  search: string,
): WebAttributionRequest | null {
  const params = storeCampaignParams(search);
  const channel = params.get("utm_source");
  if (!channel) return null;

  const request: WebAttributionRequest = { channel };
  for (const [utmKey, requestKey] of Object.entries(REQUEST_KEYS)) {
    if (utmKey === "utm_source") continue;
    const value = params.get(utmKey);
    if (value) request[requestKey] = value;
  }
  return request;
}

/** utm_source가 있는 실제 유입 URL에서만 안전 UTM 6종을 고정 순서로 남긴다. */
export function webAttributionQuery(search: string): string {
  const params = storeCampaignParams(search);
  if (!params.has("utm_source")) return "";
  const query = params.toString();
  return query ? `?${query}` : "";
}

function mergeQuery(path: string, query: string): string {
  if (!query) return path;
  const url = new URL(path, "https://acttub.invalid");
  const incoming = new URLSearchParams(query);
  for (const [key, value] of incoming) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 현재 실제 URL의 안전 UTM을 한 번의 내부 이동에 그대로 싣는다. */
export function preserveWebAttributionFromSearch(
  path: string,
  search: string,
): string {
  return mergeQuery(path, webAttributionQuery(search));
}

function capturedFromSearch(search: string): CapturedAttribution | null {
  const request = webAttributionFromSearch(search);
  const query = webAttributionQuery(search);
  return request && query ? { request, query } : null;
}

function requestQuery(request: WebAttributionRequest): string {
  const params = new URLSearchParams();
  params.set("utm_source", request.channel);
  if (request.medium) params.set("utm_medium", request.medium);
  if (request.campaign) params.set("utm_campaign", request.campaign);
  if (request.term) params.set("utm_term", request.term);
  if (request.content) params.set("utm_content", request.content);
  return `?${params.toString()}`;
}

function validRequest(value: unknown): WebAttributionRequest | null {
  if (value === null || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.channel !== "string" || !isSafeCampaignValue(source.channel)) {
    return null;
  }

  const request: WebAttributionRequest = { channel: source.channel };
  for (const key of ["medium", "campaign", "content", "term"] as const) {
    const item = source[key];
    if (item === undefined) continue;
    if (typeof item !== "string" || !isSafeCampaignValue(item)) return null;
    request[key] = item;
  }
  return request;
}

function readStored(
  store: SessionStore | null,
): StoredAttribution | null | "invalid" {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { userId?: unknown; request?: unknown };
    const request = validRequest(value.request);
    if (typeof value.userId !== "string" || !request) return "invalid";
    return { userId: value.userId, request };
  } catch {
    return "invalid";
  }
}

function writeStored(store: SessionStore | null, value: StoredAttribution): void {
  if (!store) return;
  try {
    store.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    // 저장소가 막혀도 현재 문서의 메모리 후보로 한 번 시도할 수 있다.
  }
}

function removeStored(store: SessionStore | null): void {
  if (!store) return;
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // 지울 수 없는 저장소는 이후 userId 일치 검사를 통과하지 못하면 쓰지 않는다.
  }
}

export function createWebAttributionController(
  dependencies: ControllerDependencies,
): WebAttributionController {
  let captured = false;
  let candidate: CapturedAttribution | null = null;
  let createdUserId: string | null = null;
  let boundUserId: string | null = null;
  let completedUserId: string | null = null;
  let invalidated = false;
  let generation = 0;
  let activeRequest: AbortController | null = null;

  const pause = () => {
    generation += 1;
    activeRequest?.abort();
    activeRequest = null;
  };

  const invalidate = () => {
    pause();
    invalidated = true;
    captured = true;
    candidate = null;
    createdUserId = null;
    boundUserId = null;
    completedUserId = null;
    removeStored(dependencies.sessionStore());
    dependencies.stripCurrentUrl();
  };

  return {
    captureInitial(search, hadGuestSession) {
      if (captured) return;
      captured = true;
      // 이미 있던 게스트의 광고 재방문을 과거 가입 출처로 소급하지 않는다. 이 문서에서
      // 새 게스트가 만들어질 수 있는 입장만 후보로 잡는다.
      candidate = hadGuestSession ? null : capturedFromSearch(search);
    },

    async activate(userId) {
      pause();
      if (invalidated) return false;
      if (!hasGuestSession() || dependencies.currentUserId() !== userId) {
        invalidate();
        return false;
      }
      if (completedUserId !== null) {
        if (completedUserId !== userId) invalidate();
        return false;
      }

      const store = dependencies.sessionStore();
      const stored = readStored(store);
      if (stored === "invalid" || (stored && stored.userId !== userId)) {
        invalidate();
        return false;
      }
      if (!candidate && stored) {
        // reload 재시도는 privacy 동의 뒤 같은 userId로 바인딩해 둔 최소 상태만 복원한다.
        candidate = {
          request: stored.request,
          query: requestQuery(stored.request),
        };
        boundUserId = userId;
      }
      if (!candidate) return false;
      // 현재 URL에서 막 잡은 후보는 이번 문서에서 POST /v2/auth/guest로 만들어졌다는
      // guest-started 증거와 id가 같아야 한다. 기존 게스트 재방문에는 절대 소급하지 않는다.
      if (!stored && createdUserId !== userId) {
        invalidate();
        return false;
      }
      if (boundUserId !== null && boundUserId !== userId) {
        invalidate();
        return false;
      }

      boundUserId = userId;
      // sessionStorage는 서버가 현재 privacy 동의를 확인한 이 지점 이후에만 쓴다.
      writeStored(store, { userId, request: candidate.request });

      const requestGeneration = generation + 1;
      generation = requestGeneration;
      const controller = new AbortController();
      activeRequest = controller;
      try {
        await dependencies.send(candidate.request, { signal: controller.signal });
      } catch {
        if (activeRequest === controller) activeRequest = null;
        return false;
      }
      if (
        requestGeneration !== generation ||
        controller.signal.aborted ||
        !hasGuestSession() ||
        dependencies.currentUserId() !== userId ||
        boundUserId !== userId
      ) {
        return false;
      }

      activeRequest = null;
      completedUserId = userId;
      candidate = null;
      boundUserId = null;
      removeStored(store);
      dependencies.stripCurrentUrl();
      return true;
    },

    pause,
    invalidate,

    guestStarted(userId) {
      if (invalidated) return;
      // 이 페이지에서 아직 어떤 게스트에도 묶지 않은 후보만 이번 신규 게스트 id에 묶는다.
      // 이미 시작 id가 있거나 저장을 묶었거나 끝낸 뒤의 새 시작은 계정 경계다.
      if (
        createdUserId !== null ||
        boundUserId !== null ||
        completedUserId !== null
      ) {
        invalidate();
        return;
      }
      createdUserId = userId;
    },

    preservePath(path) {
      if (invalidated || completedUserId !== null || !candidate) return path;
      return mergeQuery(path, candidate.query);
    },
  };
}

function browserSessionStore(): SessionStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function stripCurrentAttributionUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of STORE_CAMPAIGN_PARAMS) {
    if (!url.searchParams.has(key)) continue;
    url.searchParams.delete(key);
    changed = true;
  }
  if (!changed) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

const controller = createWebAttributionController({
  send: (request, options) => putWebAttribution(request, options),
  currentUserId: () => getStoredUser()?.id ?? null,
  sessionStore: browserSessionStore,
  stripCurrentUrl: stripCurrentAttributionUrl,
});

export function captureInitialWebAttribution(search: string): void {
  controller.captureInitial(search, hasGuestSession());
}

export function activateWebAttribution(userId: string): Promise<boolean> {
  return controller.activate(userId);
}

export function pauseWebAttribution(): void {
  controller.pause();
}

export function preservePendingWebAttribution(path: string): string {
  return controller.preservePath(path);
}

/**
 * 토큰 회전(값→값)은 같은 게스트라 유지한다. 같은 탭의 첫 guest-started는 현재 입장 후보를
 * 이어 가지만, 게스트 종료와 다른 탭의 시작·종료는 계정 경계라 후보와 URL을 즉시 폐기한다.
 */
export function watchWebAttributionSession(): () => void {
  const unsubscribe = onSessionEvent((event) => {
    if (event === "guest-started") {
      const userId = getStoredUser()?.id;
      if (userId) controller.guestStarted(userId);
      else controller.invalidate();
    }
    if (event === "guest-ended") controller.invalidate();
  });
  const onStorage = (event: StorageEvent) => {
    const boundary =
      event.key === null ||
      (event.key === REFRESH_KEY &&
        (event.oldValue === null || event.newValue === null));
    if (boundary) controller.invalidate();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}
