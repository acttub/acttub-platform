// 앱 스토어 주소 정본. 웹의 어떤 화면도 이 주소를 직접 적지 않고 여기서 가져온다.
//
// 두 주소는 스토어가 발급한 영구 주소다.
// - App Store: 앱 id(6793056855)가 열쇠이고 `/kr/` 지역과 슬러그는 스토어가 방문자에
//   맞춰 다시 넘긴다.
// - Google Play: 패키지명(com.acttub.app)이 열쇠이고 `apps/mobile/app.json`의 값과 같아야
//   한다. 패키지명을 바꾸면 이 주소도 같이 바꾼다.

export const APP_STORE_URL =
  "https://apps.apple.com/kr/app/acttub/id6793056855";

export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.acttub.app";

export type AppStore = "app_store" | "google_play";

/** 배지를 어느 화면에서 눌렀는지. */
export type StoreLinkSurface =
  | "landing_hero"
  | "landing_app_section"
  | "landing_footer"
  | "app_page";

/**
 * 스토어로 나가는 주소.
 *
 * ⚠️ **웹에서 배지를 몇 번 눌렀는지는 우리 계측으로 못 본다.** GA4도 Amplitude도 로그인과
 * 방침 동의 뒤에만 켜지는데, 배지를 누르는 사람은 대부분 로그아웃 상태다. 그래서 이동
 * 흔적을 스토어 쪽에 남긴다 — Google Play는 `referrer`에 실은 utm을 Play Console 획득
 * 보고서에 그대로 보여준다. App Store는 캠페인 토큰(`ct`)이 제공자 토큰(`pt`)과 짝일 때만
 * 기록되는데 우리에겐 그 토큰이 없어서 맨 주소로 둔다. 웹 쪽 숫자는 `/app` 방문수를
 * Cloudflare에서 본다.
 */
export function storeHref(store: AppStore, surface: StoreLinkSurface): string {
  if (store === "app_store") return APP_STORE_URL;

  const referrer = `utm_source=acttub_web&utm_medium=${surface}`;
  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}

/**
 * 배지를 그리는 순서. 방문 기기를 보고 바꾸지 않는다 — 정적 프리렌더라 기기 판별은
 * 하이드레이션 뒤에야 가능하고, 그때 순서가 뒤집히면 손가락이 이미 가 있던 배지가
 * 옮겨간다. 두 배지를 나란히 보여주면 한 번에 고를 수 있으므로 순서를 고정한다.
 */
export const STORE_ORDER: readonly AppStore[] = ["app_store", "google_play"];

export type MobileOs = "ios" | "android";

/**
 * 방문한 기기가 어느 스토어로 가야 하는지. 못 가리면 null 이고, 그때는 두 스토어를
 * 다 보여주는 `/app` 으로 보낸다.
 *
 * 안드로이드를 먼저 본다 — 안드로이드 크롬의 UA 에도 "Safari" 와 "Mobile" 이 들어 있어
 * 순서를 뒤집으면 서로 잡아먹는다. iPadOS 13+ 는 자기를 Macintosh 라고 말하므로
 * 터치 포인트 수로만 갈린다(데스크톱 맥은 0).
 */
export function detectMobileOs(
  userAgent: string,
  maxTouchPoints = 0,
): MobileOs | null {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return null;
}

/** 기기에 맞는 스토어 주소. 못 가리면 두 스토어를 다 보여주는 페이지. */
export function downloadHrefFor(
  os: MobileOs | null,
  surface: StoreLinkSurface,
): string {
  if (os === "ios") return storeHref("app_store", surface);
  if (os === "android") return storeHref("google_play", surface);
  return "/app";
}

/** 다운로드 버튼임을 알리는 표식. 값은 어느 화면인지(surface). */
export const APP_DOWNLOAD_ATTR = "data-app-download";

/**
 * 하이드레이션을 기다리지 않고 버튼 주소를 먼저 고쳐 주는 인라인 스크립트.
 *
 * ⚠️ **이게 없으면 버튼이 보이는데도 한동안 `/app` 으로 간다.** 페이지는 정적
 * 프리렌더라 서버가 그려 둔 주소가 `/app` 이고, React 가 붙어야 스토어 주소로 바뀐다.
 * 2026-08-14 실측(Pixel 8 에뮬레이터, 느린 4G·캐시 없음): 버튼은 1.2초에 보이는데
 * 주소는 3.2초에야 바뀌어 **2초 동안 눌러도 `/app` 으로 갔다**. 최우영이 실제로 이걸
 * 밟았다. 이 스크립트는 HTML 을 읽는 즉시 돌아 그 틈을 없앤다.
 *
 * 문서 순서상 버튼보다 뒤에 놓아야 하고(그래야 즉시 잡힌다), 혹시 앞서더라도
 * DOMContentLoaded 에서 한 번 더 훑는다. React 가 붙은 뒤에는
 * `AppDownloadButton` 이 같은 값을 다시 넣으므로 화면이 흔들리지 않는다.
 *
 * 주소는 이 파일 상수에서 찍어 내 정본이 하나로 유지되고, 판별 규칙이
 * `detectMobileOs` 와 어긋나지 않는지는 `tests/app-store-links.test.mjs` 가 지킨다.
 */
export function buildAppDownloadBootstrapScript(): string {
  return [
    "(function(){",
    `var IOS=${JSON.stringify(APP_STORE_URL)},AND=${JSON.stringify(GOOGLE_PLAY_URL)};`,
    "function os(u,t){",
    'if(/Android/i.test(u))return"android";',
    'if(/iPhone|iPad|iPod/i.test(u))return"ios";',
    'if(/Macintosh/i.test(u)&&t>1)return"ios";',
    "return null}",
    "function apply(){",
    "var k=os(navigator.userAgent,navigator.maxTouchPoints||0);if(!k)return;",
    `var a=document.querySelectorAll("a[${APP_DOWNLOAD_ATTR}]");`,
    "for(var i=0;i<a.length;i++){",
    `var s=a[i].getAttribute("${APP_DOWNLOAD_ATTR}")||"";`,
    'a[i].setAttribute("href",k==="android"?AND+"&referrer="+encodeURIComponent("utm_source=acttub_web&utm_medium="+s):IOS)}}',
    "apply();",
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",apply)',
    "})()",
  ].join("");
}
