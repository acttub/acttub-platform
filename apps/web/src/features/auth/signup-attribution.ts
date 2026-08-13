import { isMeasuredHost, SIGNUP_UTM_PARAMS } from "../../lib/analytics/ga";

const SIGNUP_ATTRIBUTION_KEY = "acttub.acquisition";
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignupAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_id?: string;
  utm_content?: string;
  utm_term?: string;
  referrer_host?: string;
  landing_path: string;
  first_seen_at: string;
}

function localStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseStoredAttribution(
  value: string | null,
  nowMs: number,
): SignupAttribution | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.landing_path !== "string" ||
      typeof record.first_seen_at !== "string"
    ) {
      return null;
    }
    const firstSeenMs = Date.parse(record.first_seen_at);
    if (
      !Number.isFinite(firstSeenMs) ||
      firstSeenMs > nowMs ||
      nowMs - firstSeenMs > ATTRIBUTION_TTL_MS
    ) {
      return null;
    }

    const attribution: SignupAttribution = {
      landing_path: record.landing_path,
      first_seen_at: record.first_seen_at,
    };
    for (const key of SIGNUP_UTM_PARAMS) {
      if (typeof record[key] === "string") attribution[key] = record[key];
    }
    if (typeof record.referrer_host === "string") {
      attribution.referrer_host = record.referrer_host;
    }
    return attribution;
  } catch {
    return null;
  }
}

function externalReferrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isMeasuredHost(url.hostname)) return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}

/** 루트 진입의 first-touch 유입 정보를 최대 30일 동안 보관한다. */
export function captureSignupAttribution(now = new Date()): void {
  try {
    const store = localStorage();
    if (!store || typeof window === "undefined") return;
    if (parseStoredAttribution(store.getItem(SIGNUP_ATTRIBUTION_KEY), now.getTime())) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const attribution: SignupAttribution = {
      landing_path: window.location.pathname,
      first_seen_at: now.toISOString(),
    };
    for (const key of SIGNUP_UTM_PARAMS) {
      const value = query.get(key);
      if (value !== null) attribution[key] = value;
    }
    const referrerHost = externalReferrerHost(
      typeof document === "undefined" ? "" : document.referrer,
    );
    if (referrerHost) attribution.referrer_host = referrerHost;

    store.setItem(SIGNUP_ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    // 저장소를 막는 인앱 브라우저에서는 유입 정보 없이 로그인한다.
  }
}

export function getSignupAttribution(now = new Date()): SignupAttribution | null {
  try {
    const store = localStorage();
    const attribution = parseStoredAttribution(
      store?.getItem(SIGNUP_ATTRIBUTION_KEY) ?? null,
      now.getTime(),
    );
    if (!attribution) store?.removeItem(SIGNUP_ATTRIBUTION_KEY);
    return attribution;
  } catch {
    return null;
  }
}

export function clearSignupAttribution(): void {
  try {
    localStorage()?.removeItem(SIGNUP_ATTRIBUTION_KEY);
  } catch {
    // 이미 비어 있는 것과 동일하게 취급한다.
  }
}
