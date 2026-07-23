// "" = same-origin. next dev는 next.config rewrites가 /v2/*를 8000으로 프록시하고,
// prod는 FastAPI가 정적 파일과 API를 같은 오리진에서 서빙하므로 기본값을 바꿀 일이 없다.
// EC2 등 별도 오리진에 API를 둘 때만 NEXT_PUBLIC_API_BASE_URL을 설정한다.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

// NEXT_PUBLIC_SITE_URL은 정식 사이트 URL이며 기본값은 https://acttub.com이다.
// 값의 검증과 정규화는 src/lib/seo/site-metadata.ts에서 담당한다.

// OAuth client ID는 공개 값이므로 클라이언트 번들에 포함해도 무방하다.
export const GOOGLE_CLIENT_ID =
  "462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com";

// 웹 Apple 로그인은 번들 ID가 아니라 Services ID를 client ID로 쓴다.
// 빈 문자열이면 로그인 화면에서 Apple 버튼을 숨긴다 — 미설정 상태에서는 눌러도 실패만 하기 때문.
// 채우기 전에 Apple Developer에서 (1) Services ID 생성, (2) Return URL에 아래
// APPLE_REDIRECT_PATH를 붙인 절대 URL 등록, (3) 도메인 소유 검증까지 마쳐야 한다.
// 같은 값을 백엔드 APPLE_OAUTH_CLIENT_ID에 콤마로 덧붙여야 앱·웹 두 audience가 모두 통과한다.
export const APPLE_CLIENT_ID: string = "com.acttub.web";

// Apple Developer에 등록하는 Return URL의 경로. 팝업 모드라 실제로 이 경로가 열리지는 않지만
// init에 넘기는 값과 등록값이 정확히 일치해야 invalid_client가 나지 않는다.
export const APPLE_REDIRECT_PATH = "/login";

// S3 버킷 CORS가 설정되기 전에는 브라우저 직접 PUT이 막히므로 목킹 모드로 우회한다.
export const MOCK_S3_UPLOAD = process.env.NEXT_PUBLIC_MOCK_S3_UPLOAD === "1";

export const LOGIN_PATH = "/login";

// 연습을 마친 배우가 넘어가는 후기 페이지. 연습 노트를 띄우는 화면이 둘(practice-flow·
// practice-single)이라 한쪽만 고치면 다른 쪽이 조용히 옛 주소로 남는다.
export const REVIEW_FORM_URL = "https://acttub.github.io/review-form/";

// 백엔드 uploads.py의 MAX_UPLOAD_BYTES(100MB)와 동일해야 한다.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_DURATION_MS = 300_000;
