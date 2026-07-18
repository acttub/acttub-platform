// "" = same-origin. dev는 next.config rewrites가 /v2/*를 8000으로 프록시하고,
// prod는 FastAPI가 정적 파일과 API를 같은 오리진에서 서빙하므로 기본값을 바꿀 일이 없다.
// EC2 등 별도 오리진에 API를 둘 때만 NEXT_PUBLIC_API_BASE_URL을 설정한다.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export const AUTH_PROVIDER = (process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? "dev") as
  | "dev"
  | "google";

// S3 버킷 CORS가 설정되기 전에는 브라우저 직접 PUT이 막히므로 목킹 모드로 우회한다.
export const MOCK_S3_UPLOAD = process.env.NEXT_PUBLIC_MOCK_S3_UPLOAD === "1";

export const LOGIN_PATH = "/login";

// 백엔드 uploads.py의 MAX_UPLOAD_BYTES(550MB)와 동일해야 한다.
export const MAX_UPLOAD_BYTES = 550 * 1024 * 1024;
export const MAX_DURATION_MS = 180_000;

// 레거시 — 삭제 스윕에서 제거
const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_TERMS_VERSION = "2026-07-mvp";

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
  isConfigured: boolean;
};

export type AppConfig = {
  appUrl: string;
  termsVersion: string;
  supabase: SupabasePublicConfig;
  video: {
    bucket: string;
    maxUploadBytes: number;
    signedUrlExpiresInSeconds: number;
  };
};

function normalizeUrl(value: string | undefined): string {
  return (value ?? DEFAULT_APP_URL).replace(/\/$/, "");
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAppConfig(): AppConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  return {
    appUrl: normalizeUrl(process.env.NEXT_PUBLIC_APP_URL),
    termsVersion: process.env.NEXT_PUBLIC_ACTTUB_TERMS_VERSION ?? DEFAULT_TERMS_VERSION,
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
    },
    video: {
      bucket: process.env.NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET ?? "practice-videos",
      maxUploadBytes: MAX_UPLOAD_BYTES,
      signedUrlExpiresInSeconds: numberFromEnv(
        process.env.ACTTUB_SIGNED_URL_EXPIRES_SECONDS,
        10 * 60,
      ),
    },
  };
}
