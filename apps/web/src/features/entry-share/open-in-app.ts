import { goHref, type MobileOs } from "@/lib/app-download/store-links";

// 참여작 공유 페이지의 "앱에서 보기"(challenge.share). 클라이언트 번들에 들어간다.
// 앱은 참여작을 actingapp://entry/<id> 로 연다(apps/mobile/lib/challenge/deeplink.ts).

const APP_SCHEME = "actingapp";
/** apps/mobile/app.json 의 android.package 와 같아야 한다. */
const ANDROID_PACKAGE = "com.acttub.app";

export function appEntryUrl(id: string): string {
  return `${APP_SCHEME}://entry/${encodeURIComponent(id)}`;
}

/**
 * "앱에서 보기"가 갈 곳. 스토어로 가는 길은 배지와 같은 `/go/<os>/<surface>` 를 거친다(스토어 주소의 정본과
 * Cloudflare 집계를 같이 쓴다).
 *
 * - iOS: 앱 주소를 열고, 앱이 없어 페이지가 그대로 보이면 `fallback` 으로 간다(호출하는 쪽이 시간을 잰다).
 * - 안드로이드: intent 주소 하나로 끝난다. 앱이 없으면 크롬이 `browser_fallback_url` 로 보낸다.
 * - 못 가리면(데스크톱): 두 스토어를 다 보여 주는 `/app`.
 */
export function openInAppTarget(
  os: MobileOs | null,
  id: string,
  origin: string,
): { href: string; fallback: string | null } {
  if (os === "ios") {
    return { href: appEntryUrl(id), fallback: goHref("app_store", "entry_share") };
  }
  if (os === "android") {
    const fallback = `${origin}${goHref("google_play", "entry_share")}`;
    return {
      href:
        `intent://entry/${encodeURIComponent(id)}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};` +
        `S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
      fallback: null,
    };
  }
  return { href: "/app", fallback: null };
}
