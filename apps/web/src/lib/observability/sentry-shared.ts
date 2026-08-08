/**
 * Sentry 공통 설정. 브라우저(instrumentation-client)와 Next 서버(instrumentation)가
 * 같은 값을 쓰도록 한 곳에서 만든다.
 *
 * `lib/analytics/ga.ts`가 세운 원칙을 잇되, 세 가지가 다르다.
 *
 * 1) **DSN이 없으면 아예 켜지 않는다.** 로컬 개발과 테스트가 조용해야 하고, 되돌릴 때
 *    코드를 건드리지 않고 환경변수만 빼면 된다.
 *
 * 2) **주소에서 쿼리를 통째로 버리고 UUID를 가린다.** `?session=<uuid>`처럼 식별자가
 *    쿼리로 다니고, API 경로에는 `/v2/practice-sessions/<uuid>`처럼 박혀서 온다.
 *    GA는 유입 경로를 세야 해서 `utm_*`만 남겼지만(`toTrackedQuery`), 에러를 고치는 데는
 *    캠페인 정보가 필요 없으므로 여기서는 더 좁게 잡는다. UUID를 가리면 같은 화면에서
 *    난 에러가 주소마다 다른 이슈로 쪼개지지 않는 이득도 따라온다.
 *
 * 3) **호스트를 가리지 않는다.** GA는 실서비스 통계가 섞이지 않게 `acttub.com`에서만
 *    돌지만(`isMeasuredHost`), 에러는 dev에서 난 것도 봐야 고칠 수 있다. 두 환경은
 *    `environment` 태그로 나눈다.
 *
 * 세션 리플레이와 트레이싱은 켜지 않는다 — 연습 영상과 대사가 그대로 담기고, 지금
 * 필요한 것은 "무엇이 터졌나" 하나뿐이다. 나중에 켠다면 리플레이의 마스킹 설정을
 * 먼저 확인해야 한다.
 */

/**
 * 셋 다 `NEXT_PUBLIC_` 접두사라 **빌드 시점에 번들로 새겨진다**. 런타임 환경변수로는
 * 바뀌지 않으므로 `deploy.yml`의 빌드 스텝에서 주어야 한다 — `API_ORIGIN`이 rewrites에
 * 굳는 것과 같은 제약이다(next.config.ts 주석 참고).
 *
 * DSN은 브라우저 번들에 그대로 노출되지만 비밀이 아니다. 이 값으로 할 수 있는 일은
 * 이벤트를 보내는 것뿐이고, 읽기에는 별도의 인증이 필요하다.
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
const ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENV ?? "local";
const RELEASE = process.env.NEXT_PUBLIC_APP_COMMIT ?? "unknown";

/** 소문자·대문자 UUID 모두 잡는다. 세션·사용자·업로드 식별자가 전부 이 꼴이다. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * 주소에서 쿼리·해시를 떼고 경로의 UUID를 가린다. 절대 주소와 상대 경로 모두 받는다.
 *
 * 쿼리를 남기지 않으므로 `toTrackedQuery`처럼 허용 목록을 둘 필요가 없다 — 새 쿼리가
 * 생겨도 자동으로 걸러진다.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;
  const [beforeHash] = url.split("#");
  const [path] = beforeHash.split("?");
  return path.replace(UUID_PATTERN, "<id>");
}

/**
 * 이벤트에서 주소를 씻는다. `sendDefaultPii:false`가 쿠키·헤더·IP를 이미 막지만,
 * 주소는 그 대상이 아니라서 직접 지워야 한다.
 */
function scrubRequest(request: { url?: string; query_string?: unknown } | undefined): void {
  if (!request) return;
  if (typeof request.url === "string") request.url = scrubUrl(request.url);
  // 쿼리는 통째로 버린다. 남겨서 얻을 것이 없다.
  delete request.query_string;
}

/**
 * 빵부스러기(breadcrumb)에도 주소가 실린다. fetch·xhr·navigation 세 종류가 그렇고,
 * 이 앱은 화면 전환마다 `/v2/*`를 부르므로 실제로 대부분의 부스러기에 주소가 있다.
 */
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(
  breadcrumb: T,
): T {
  const url = breadcrumb.data?.url;
  if (typeof url === "string" && breadcrumb.data) {
    breadcrumb.data.url = scrubUrl(url);
  }
  return breadcrumb;
}

/**
 * 보내기 직전에 이벤트를 씻는다. 주소가 실릴 수 있는 자리를 전부 훑는다.
 */
export function scrubEvent<
  T extends {
    request?: { url?: string; query_string?: unknown };
    breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  },
>(event: T): T {
  scrubRequest(event.request);
  event.breadcrumbs?.forEach(scrubBreadcrumb);
  return event;
}

/** Sentry를 켤지. DSN이 비어 있으면 로컬·테스트로 보고 조용히 넘어간다. */
export function isSentryEnabled(): boolean {
  return DSN.length > 0;
}

/**
 * 브라우저·서버가 함께 쓰는 옵션. 각 진입점에서 그대로 `Sentry.init`에 넘긴다.
 *
 * `tracesSampleRate`를 0으로 둔다 — 1단계는 에러만 본다. 성능 추적을 켜려면 이 값만
 * 올리면 되지만, 그 전에 무료 한도를 먼저 확인해야 한다.
 */
export const sentryBaseOptions = {
  dsn: DSN,
  environment: ENVIRONMENT,
  release: RELEASE,
  // 쿠키·헤더·IP·사용자 식별자를 SDK가 알아서 붙이지 않게 한다.
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} as const;
