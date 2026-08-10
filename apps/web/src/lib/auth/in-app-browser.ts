// 인앱 브라우저 감지·탈출.
// 2026-08-10 실측에서 GIS 스크립트는 Android WebView("; wv)")에서만 403이었고,
// iPhone Instagram 인앱 브라우저에서는 정상 로드됐다.
// 인앱 브라우저에는 어떤 안내도 띄우지 않고, 가능한 경우 자동으로만 탈출한다
// (2026-08-10 최우영 결정). 자동 이동이 실패하면 사용자는 설명 없이 인앱에 남는다.
//
// 브라우저 감지와 탈출 가능 여부는 다른 축이다. generic 이어도 안드로이드면
// intent 스킴으로 기본 브라우저를 부를 수 있어서 그냥 나간다 — 403으로 빈 버튼
// 자리를 보기 전에. iOS는 WKWebView가 커스텀 스킴을 호스트 앱에 넘기지 않아
// 방법이 없다.
// 모듈 최상위에서 window에 접근하지 않는다 (정적 프리렌더 제약).

export type InAppBrowser = "kakaotalk" | "line" | "generic";

const LINE_ESCAPE_PARAM = "openExternalBrowser";

export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (/KAKAOTALK/i.test(userAgent)) return "kakaotalk";
  if (/\bLine\//i.test(userAgent)) return "line";
  // 전용 탈출 수단이 없는 인앱 브라우저들 + Android WebView 공통 마커("; wv)").
  if (
    /Instagram|FBAN|FBAV|FB_IAB|NAVER\(inapp|DaumApps|; wv\)/i.test(userAgent)
  ) {
    return "generic";
  }
  return null;
}

// 기본 브라우저로 탈출시키는 이동 URL. 탈출 수단이 없는 브라우저면 null.
export function externalBrowserUrl(
  browser: InAppBrowser,
  currentUrl: string,
  userAgent: string,
): string | null {
  if (browser === "kakaotalk") {
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
  }
  if (browser === "line") {
    const url = new URL(currentUrl);
    // 파라미터가 이미 붙어 있다면 탈출이 동작하지 않은 상태 — 재이동 루프를 막는다.
    if (url.searchParams.get(LINE_ESCAPE_PARAM) === "1") return null;
    url.searchParams.set(LINE_ESCAPE_PARAM, "1");
    return url.toString();
  }

  // Android는 intent 스킴으로 기본 브라우저를 부를 수 있다.
  // package를 못박지 않는다 — 크롬이 없는 기기(삼성 인터넷만 쓰는 갤럭시)에서 실패하고,
  // 그때 쓰는 S.browser_fallback_url은 intent를 해석한 쪽이 처리하는 관례라
  // 인스타 웹뷰가 구현하지 않았으면 에러 화면으로 끝난다.
  if (/Android/i.test(userAgent)) {
    return (
      "intent://" +
      currentUrl.split("#")[0].replace(/^https?:\/\//, "") +
      "#Intent;scheme=https;end"
    );
  }

  // iOS: WKWebView가 커스텀 스킴을 호스트 앱에 넘기지 않는다. 안내 문구가 최선이다.
  return null;
}

const GOOGLE_LOAD_ERROR_NOTICE =
  "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요";

export function googleLoginNotices(
  browser: InAppBrowser | null,
  hasLoadFailed: boolean,
): { loadError: string | null } {
  // generic 인앱 브라우저는 로드 실패 문구도 받지 않는다. Android WebView 에서는
  // Google 이 gsi/client 를 403 으로 거절해 버튼이 안 그려지는데, 그 자리를
  // 설명 없이 비워 두기로 했다.
  if (browser === "generic") return { loadError: null };

  return {
    loadError: hasLoadFailed ? GOOGLE_LOAD_ERROR_NOTICE : null,
  };
}
