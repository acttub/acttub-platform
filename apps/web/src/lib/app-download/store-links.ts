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
