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
 * 2) **주소에서 캠페인 파라미터만 남기고 나머지 쿼리를 뗀다.** `/home?session=<uuid>`
 *    같은 주소가 그대로 나가면 연습 세션 식별자가 구글로 넘어가고 페이지 통계
 *    카디널리티도 터진다. 그래서 자동 page_view(`send_page_view`)를 끄고 직접 쏜다.
 *    `utm_*` 만 남기는 이유는 toTrackedQuery 주석에 있다 — 방침 v2 6항이 수집 항목으로
 *    적어 둔 "유입 경로(캠페인 정보)"가 이 값이라, 통째로 버리면 방침보다 덜 걷는다.
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

/**
 * 유입 경로를 셀 수 있는 파라미터만 남긴다. 허용 목록이므로 여기 없는 이름은 전부 버린다 —
 * `session`·`next` 는 물론, 나중에 새 쿼리가 생겨도 자동으로 걸러진다.
 *
 * 두 갈래만 넣는다: GA4 가 캠페인으로 읽는 수동 태깅(`utm_*`)과, GA4 가 귀속에 실제로
 * 쓰는 구글 자동 태깅 값이다.
 *
 * ⚠️ `fbclid`·`msclkid`·`ttclid` 는 일부러 뺐다. 캠페인 이름이 아니라 **클릭 하나를
 * 가리키는 식별자**이고 GA4 는 이 값을 읽지도 않는다. 넣으면 얻는 것 없이 남의 클릭
 * 식별자를 구글로 넘기게 된다 — 인스타에서 들어오면 `fbclid` 가 자동으로 붙으므로
 * 실제로 흔하다. 채널은 우리가 붙인 `utm_source` 로 센다.
 */
const CAMPAIGN_PARAMS = new Set([
  // GA4 수동 태깅
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
  // 구글 자동 태깅 — GA4 가 귀속에 직접 쓴다
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "gad_source",
  "gad_campaignid",
]);

/**
 * 캠페인 파라미터만 남긴 쿼리를 돌려준다. 남는 게 없으면 빈 문자열이다.
 *
 * 쿼리를 통째로 버리면 `?utm_source=instagram` 도 같이 사라진다. GA4 는 캠페인을
 * `page_location` 의 쿼리에서만 읽으므로, 그러면 유입용 서브프로젝트 6개가 UTM 을
 * 달아 보내도 전부 direct 로 잡혀 "어느 채널이 가입을 만들었나"를 못 센다.
 *
 * 방침 v2 6항은 수집 항목으로 "유입 경로(직전 사이트·**캠페인 정보**)"를 적어 두었고,
 * 같은 항이 막는 것은 "연습 세션 식별자 등"이다. 그래서 통째로 버리는 대신 아는
 * 캠페인 파라미터만 통과시킨다.
 */
export function toTrackedQuery(search: string): string {
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (CAMPAIGN_PARAMS.has(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}

/**
 * GA4 로 보낼 주소. 경로는 씻고 캠페인 파라미터만 남긴다.
 * config 와 page_view 두 곳이 같은 값을 만들어야 해서 함수로 묶어 둔다 — 한쪽만
 * 고치면 gtag 가 만드는 히트와 우리가 쏘는 히트의 `dl` 이 갈라진다.
 */
export function toTrackedLocation(origin: string, pathname: string, search: string): string {
  return `${origin}${toTrackedPath(pathname)}${toTrackedQuery(search)}`;
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
    page_location: toTrackedLocation(
      window.location.origin,
      window.location.pathname,
      window.location.search,
    ),
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

let sentUserId: string | null = null;

/**
 * 로그인한 사람을 기기 너머로 잇는다. 폰에서 시작하고 노트북에서 이어 하면
 * 같은 사람이 둘로 세어져 "가입한 사람 중 몇 명이 연습까지 갔나"가 실제보다 낮게 나온다.
 *
 * ⚠️ 값은 백엔드 내부 식별자(`AuthUser.id`)만 쓴다. 이메일·표시 이름·구글 sub 를 넣으면
 * GA4 약관 위반이고, 이 파일이 주소에서 식별자를 씻어내는 이유와도 정면으로 어긋난다.
 */
export function setAnalyticsUser(userId: string): void {
  if (!window.gtag) return;
  // 화면이 바뀔 때마다 같은 값을 다시 보내지 않는다.
  if (sentUserId === userId) return;
  // `config` 재호출이 아니라 `set` 이다. config 로 하면 startAnalytics 가 못박아 둔
  // page_location·page_referrer 기본값을 매번 덮어써서 주소 세척이 풀린다.
  window.gtag("set", { user_id: userId });
  sentUserId = userId;
}

export function clearAnalyticsUser(): void {
  if (!window.gtag) return;
  if (sentUserId === null) return;
  window.gtag("set", { user_id: null });
  sentUserId = null;
}

/**
 * 영상 길이는 구간으로 뭉개서 보낸다. 원본 밀리초를 그대로 실으면 특정 연습을
 * 짚어낼 수 있는 값이 되고, 보고서 항목만 의미 없이 늘어난다.
 */
export function toDurationBucket(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  if (durationMs < 30_000) return "<30s";
  if (durationMs < 60_000) return "30-60s";
  if (durationMs < 180_000) return "60-180s";
  return "180s+";
}

/**
 * 영상이 올라가고 연습 세션까지 만들어진 시점에 부른다.
 * 업로드만 끝난 시점이 아니다 — 세션 생성이 실패하면 연습이 시작된 게 아니다.
 *
 * ⚠️ 아래 세 함수 모두 연습 세션 id·업로드 intent id·파일명을 파라미터로 싣지 않는다.
 * 한 번 실어 보내면 되돌릴 수 없고, 방침 v2 6항이 막기로 한 바로 그 값이다.
 */
export function trackVideoUploaded(durationMs: number): void {
  if (!window.gtag) return;
  window.gtag("event", "practice_video_uploaded", {
    duration_bucket: toDurationBucket(durationMs),
  });
}

/** 첫 질문이 화면에 올라온 시점. 노트를 못 만들어 대화로 되돌아온 경우는 해당하지 않는다. */
export function trackDialogueStarted(): void {
  if (!window.gtag) return;
  window.gtag("event", "practice_dialogue_started");
}

/** 연습 노트 본문이 실제로 화면에 올라온 시점. 만들기 시작한 시점이 아니다. */
export function trackResultViewed(): void {
  if (!window.gtag) return;
  window.gtag("event", "practice_result_viewed");
}

/**
 * 화면 전환마다 부른다. 경로와 캠페인 파라미터만 실어 보낸다.
 *
 * `page_path` 에는 캠페인을 넣지 않는다 — 화면별 통계는 경로로 세야 같은 화면이
 * 캠페인 수만큼 쪼개지지 않는다. 캠페인은 `page_location` 에서 GA4 가 읽어 간다.
 *
 * 캠페인은 호출 시점의 `window.location.search` 에서 읽는다. 인자 `pathname` 은 렌더
 * 스냅샷이라, 아주 빠른 연속 이동에서는 서로 다른 이동에서 온 조합이 될 수 있다.
 * 금지 키는 어차피 다시 걸러지므로 유출이 아니라 귀속이 흔들리는 문제이고, 유입을
 * 정하는 것은 세션 첫 히트라 실제 영향은 없다. `useSearchParams` 로 맞추려면 이
 * 컴포넌트를 Suspense 로 감싸야 해서(정적 export 제약) 그대로 둔다.
 */
export function trackPageView(pathname: string): void {
  if (!window.gtag) return;
  const path = toTrackedPath(pathname);
  const referrer = toTrackedReferrer(document.referrer, window.location.origin);
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: toTrackedLocation(window.location.origin, pathname, window.location.search),
    page_title: document.title,
    // 빈 문자열로라도 넘긴다. 생략하면 GA4 가 document.referrer 를 직접 읽어
    // 씻지 않은 주소가 그대로 나간다.
    page_referrer: referrer,
  });
}
