// "" = same-origin. next dev는 next.config rewrites가 /v2/*를 8000으로 프록시하고,
// prod는 FastAPI가 정적 파일과 API를 같은 오리진에서 서빙하므로 기본값을 바꿀 일이 없다.
// EC2 등 별도 오리진에 API를 둘 때만 NEXT_PUBLIC_API_BASE_URL을 설정한다.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

// NEXT_PUBLIC_SITE_URL은 정식 사이트 URL이며 기본값은 https://acttub.com이다.
// 값의 검증과 정규화는 src/lib/seo/site-metadata.ts에서 담당한다.

// OAuth client ID는 공개 값이므로 클라이언트 번들에 포함해도 무방하다.
export const GOOGLE_CLIENT_ID =
  "462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com";

// S3 버킷 CORS가 설정되기 전에는 브라우저 직접 PUT이 막히므로 목킹 모드로 우회한다.
export const MOCK_S3_UPLOAD = process.env.NEXT_PUBLIC_MOCK_S3_UPLOAD === "1";

export const LOGIN_PATH = "/login";

// 백엔드 uploads.py의 MAX_UPLOAD_BYTES(100MB)와 동일해야 한다.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_DURATION_MS = 300_000;
