/**
 * GA4 계측. 이 파일 밖에서 gtag 를 직접 부르지 않는다.
 *
 * 유입용 서브프로젝트 6개(voice·acti·stage·mono·pick·link)가 같은 측정 ID 를 쓴다.
 * 코어가 비어 있으면 "어느 채널이 가입을 만들었나"를 셀 수 없어서 붙였다.
 *
 * 지켜야 하는 것 셋 — 하나라도 풀면 개인정보처리방침과 어긋난다:
 *
 * 1) **동의 전에는 쿠키를 저장하지 않는다.** consent 기본값이 denied 다.
 *    방침 v2 6항이 "이 쿠키는 이용자가 본 방침에 동의한 뒤에만 저장됩니다"라고 약속한다.
 *    ⚠️ `client_storage:'none'` 으로는 안 된다 — 옛 UA 필드라 GA4 가 무시하고 쿠키를 그대로 심는다
 *    (2026-07-29 실제 크롬으로 확인). consent 로만 막힌다.
 *
 * 2) **주소의 쿼리를 떼고 보낸다.** `/home?session=<uuid>` 같은 주소가 그대로 나가면
 *    연습 세션 식별자가 구글로 넘어가고 페이지 통계 카디널리티도 터진다.
 *    그래서 자동 page_view(`send_page_view`)를 끄고 경로만 실어 직접 쏜다.
 *    referrer 도 같이 씻는다 — GA4 는 `page_referrer` 를 생략하면 `document.referrer` 를
 *    쓰는데, `/practice/history?session=<uuid>` 에서 `/login` 으로 하드 이동하면
 *    그 주소가 referrer 에 그대로 실린다.
 *
 *    ⚠️ **GA4 데이터 스트림에서 향상된 측정의 "브라우저 기록 기반 페이지 변경"을 꺼야 한다.**
 *    `send_page_view:false` 는 이 config 가 만드는 이벤트만 막을 뿐, 향상된 측정의
 *    히스토리 리스너는 그대로 살아서 전체 주소로 page_view 를 또 쏜다. 그러면 위 2)가
 *    무의미해지고 조회수도 두 배로 잡힌다. 이건 코드가 아니라 콘솔 설정이다.
 *
 * 3) **실서비스 호스트에서만 돈다.** dev 서버가 같은 정적 빌드를 서빙하므로
 *    가드가 없으면 개발 트래픽이 실서비스 통계에 섞인다.
 */

const MEASUREMENT_ID = "G-DRMEWBN9Y9";

type GtagCommand = [command: string, ...args: unknown[]];

declare global {
  interface Window {
    dataLayer?: IArguments[];
    gtag?: (...args: GtagCommand) => void;
  }
}

/** 실서비스 호스트인지. `acttub.com` 과 그 서브도메인만 참이다. */
export function isMeasuredHost(hostname: string): boolean {
  return /(^|\.)acttub\.com$/.test(hostname);
}

/** 주소에서 쿼리·해시를 떼고 경로만 남긴다. 식별자는 전부 쿼리에 실려 오므로 이걸로 걸러진다. */
export function toTrackedPath(pathname: string): string {
  const [withoutHash] = pathname.split("#");
  const [path] = withoutHash.split("?");
  return path.startsWith("/") ? path : `/${path}`;
}

let started = false;

/** 태그를 올린다. 여러 번 불러도 한 번만 올라간다. */
export function startAnalytics(): void {
  if (started) return;
  if (typeof window === "undefined") return;
  if (!isMeasuredHost(window.location.hostname)) return;
  started = true;

  window.dataLayer = window.dataLayer || [];
  // gtag 큐는 배열이 아니라 네이티브 arguments 객체를 기대한다 — 구글 스니펫 그대로다.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() { window.dataLayer?.push(arguments); };

  // consent 는 config 보다 먼저 와야 한다. 뒤에 두면 그 사이에 쿠키가 이미 심긴다.
  window.gtag("consent", "default", { analytics_storage: "denied" });
  window.gtag("js", new Date());
  // page_location·page_referrer 를 config 에도 못박는다. 이벤트에만 넣으면 부족하다 —
  // gtag 는 자기가 만드는 히트(session_start·user_engagement 등)의 `dl`·`dr` 을
  // document 에서 직접 읽어서, `?session=<uuid>` 가 그대로 새어 나간다.
  // 2026-07-29에 실제 크롬으로 두 번 확인했다: 이벤트만 씻었을 때 dr 이 샜고,
  // referrer 만 못박았을 때 dl 이 샜다.
  // 여기 값은 이후 이벤트의 기본값으로 눌러앉지만, page_view 는 trackPageView 가
  // 매번 덮어쓰므로 화면별 통계는 그대로 산다.
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    page_location: `${window.location.origin}${toTrackedPath(window.location.pathname)}`,
    page_referrer: toTrackedReferrer(document.referrer, window.location.origin),
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/**
 * 동의가 확인된 뒤에만 부른다. 이때부터 쿠키가 저장돼 재방문이 이어진다.
 * 되돌리는 함수는 두지 않는다 — 동의 철회는 회원 탈퇴 경로로 처리한다(방침 8항).
 */
export function grantAnalyticsConsent(): void {
  window.gtag?.("consent", "update", { analytics_storage: "granted" });
}

/**
 * 우리 사이트에서 온 referrer 는 쿼리를 떼고 보낸다 — 세션 식별자가 실려 올 수 있다.
 * 외부에서 온 referrer 는 그대로 둔다. 어느 채널에서 왔는지가 이 값에 있고,
 * 그건 우리가 만든 식별자가 아니다.
 */
export function toTrackedReferrer(referrer: string, origin: string): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    // http(s)가 아니면 보내지 않는다. `javascript:` 같은 것도 URL 파서는 통과시키는데,
    // 유입 경로로서 의미가 없고 무엇이 실려 있을지 알 수 없다.
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.origin !== origin) return referrer;
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/** 화면 전환마다 부른다. 경로만 실어 보낸다. */
export function trackPageView(pathname: string): void {
  if (!window.gtag) return;
  const path = toTrackedPath(pathname);
  const referrer = toTrackedReferrer(document.referrer, window.location.origin);
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
    // 빈 문자열로라도 넘긴다. 생략하면 GA4 가 document.referrer 를 직접 읽어
    // 씻지 않은 주소가 그대로 나간다.
    page_referrer: referrer,
  });
}
