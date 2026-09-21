// "" = same-origin. dev·운영 모두 이 Next 서버의 rewrites가 /v2/*를 백엔드로 넘기므로
// 브라우저에는 오리진이 하나로 보이고, 기본값을 바꿀 일이 없다.
// 별도 오리진에 API를 둘 때만 NEXT_PUBLIC_API_BASE_URL을 설정한다.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

// NEXT_PUBLIC_SITE_URL은 정식 사이트 URL이며 기본값은 https://acttub.com이다.
// 값의 검증과 정규화는 src/lib/seo/site-metadata.ts에서 담당한다.

// 요청마다 보내는 클라이언트 종류와 판(X-Acttub-Client). 서버는 이 헤더가 없는 요청을
// 1.0.0 이전 빌드로 보고 426으로 답한다(docs/requirements/00-common.md 공통 규칙).
export const ACTTUB_CLIENT = "web/1.0.0";

// S3 버킷 CORS가 설정되기 전에는 브라우저 직접 PUT이 막히므로 목킹 모드로 우회한다.
export const MOCK_S3_UPLOAD = process.env.NEXT_PUBLIC_MOCK_S3_UPLOAD === "1";

// Sentry는 세 변수를 빌드 시점에 읽는다(src/lib/observability/sentry-shared.ts).
// 여기서 값을 내보내지 않고 위치만 적어 둔다 — 계측 코드 밖에서 참조할 일이 없다.
//   NEXT_PUBLIC_SENTRY_DSN   비어 있으면 Sentry를 켜지 않는다. 로컬 개발의 기본값이다.
//   NEXT_PUBLIC_SENTRY_ENV   dev · prod. 없으면 local로 잡힌다.
//   NEXT_PUBLIC_APP_COMMIT   릴리스 이름. deploy.yml이 github.sha를 넣는다.
// 소스맵 업로드용 SENTRY_ORG·SENTRY_PROJECT·SENTRY_AUTH_TOKEN은 빌드 전용이라
// 브라우저로 나가지 않는다(next.config.ts).
//
// Amplitude도 같은 방식이다(src/lib/analytics/amplitude.ts).
//   NEXT_PUBLIC_AMPLITUDE_API_KEY  비어 있으면 계측을 켜지 않고 콘솔에 경고를 남긴다.
//                                  환경별로 다른 프로젝트 키를 넣어 통계를 나눈다.
// 로컬에서 확인하려면 apps/web/.env.local 에 넣는다(.env* 는 커밋되지 않는다).

// 후기는 1.0.0 부터 서버에 직접 접수한다(practice.feedback). 외부 폼 주소는 더 쓰지 않는다.

// 백엔드 uploads.py의 MAX_UPLOAD_BYTES(100MB)와 동일해야 한다.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_DURATION_MS = 300_000;
