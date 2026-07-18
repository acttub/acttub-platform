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
