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
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

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
      maxUploadBytes: numberFromEnv(
        process.env.NEXT_PUBLIC_ACTTUB_MAX_VIDEO_BYTES,
        300 * 1024 * 1024,
      ),
      signedUrlExpiresInSeconds: numberFromEnv(
        process.env.ACTTUB_SIGNED_URL_EXPIRES_SECONDS,
        10 * 60,
      ),
    },
  };
}
