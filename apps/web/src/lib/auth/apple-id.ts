// Sign in with Apple JS 스크립트 로더·래퍼.
// 모듈 최상위에서 window에 접근하지 않는다 (정적 프리렌더 제약).
//
// 웹은 네이티브 앱과 달리 번들 ID가 아니라 Services ID를 clientId로 쓴다.
// 백엔드(config.py의 APPLE_OAUTH_CLIENT_ID)에 이 Services ID를 콤마로 덧붙여야
// 두 audience가 모두 통과한다 — 없으면 401 invalid_provider_token이 난다.

interface AppleIdAuthorization {
  id_token: string;
  code: string;
  state?: string;
}

interface AppleIdSignInResponse {
  authorization: AppleIdAuthorization;
  // 이름은 최초 1회 동의 때만 내려오며, 서버는 id_token만 쓰므로 저장하지 않는다.
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
}

interface AppleIdAuthApi {
  init(config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state?: string;
    usePopup: boolean;
  }): void;
  signIn(): Promise<AppleIdSignInResponse>;
}

declare global {
  interface Window {
    AppleID?: {
      auth?: AppleIdAuthApi;
    };
  }
}

const APPLE_SCRIPT_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ko_KR/appleid.auth.js";

// 사용자가 팝업을 그냥 닫은 경우 Apple이 주는 코드. 오류로 안내하지 않는다.
const POPUP_CLOSED_ERROR = "popup_closed_by_user";

// 단일 promise 캐시로 중복 로드를 막는다. 실패 시 캐시를 비워 새로고침 없이도 재시도 가능하게 한다.
let appleLoadPromise: Promise<AppleIdAuthApi> | null = null;

function loadAppleIdApi(): Promise<AppleIdAuthApi> {
  if (appleLoadPromise) return appleLoadPromise;

  appleLoadPromise = new Promise<AppleIdAuthApi>((resolve, reject) => {
    const existing = window.AppleID?.auth;
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement("script");
    script.src = APPLE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const api = window.AppleID?.auth;
      if (api) {
        resolve(api);
      } else {
        appleLoadPromise = null;
        reject(new Error("Apple 스크립트는 로드됐지만 API를 찾을 수 없습니다."));
      }
    };
    script.onerror = () => {
      appleLoadPromise = null;
      script.remove();
      reject(new Error("Apple 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });

  return appleLoadPromise;
}

export class AppleSignInCancelled extends Error {
  constructor() {
    super("Apple 로그인이 취소되었습니다.");
    this.name = "AppleSignInCancelled";
  }
}

export function isAppleSignInCancelled(error: unknown): boolean {
  return error instanceof AppleSignInCancelled;
}

// Apple이 reject하는 값은 Error가 아니라 { error: "..." } 평범한 객체다.
function appleErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

/**
 * Apple 팝업 로그인을 띄우고 identityToken(JWT)을 돌려준다.
 * 사용자가 팝업을 닫으면 {@link AppleSignInCancelled}를 던진다.
 */
export async function requestAppleIdToken(options: {
  clientId: string;
  redirectUri: string;
}): Promise<string> {
  const api = await loadAppleIdApi();
  api.init({
    clientId: options.clientId,
    // 서버는 id_token의 sub/email만 쓰므로 name은 요청하지 않는다.
    scope: "email",
    // usePopup이어도 Apple Developer에 등록된 Return URL과 정확히 같아야 한다.
    redirectURI: options.redirectUri,
    usePopup: true,
  });

  let response: AppleIdSignInResponse;
  try {
    response = await api.signIn();
  } catch (error) {
    if (appleErrorCode(error) === POPUP_CLOSED_ERROR) {
      throw new AppleSignInCancelled();
    }
    throw error instanceof Error
      ? error
      : new Error("Apple 로그인에 실패했습니다.");
  }

  const idToken = response.authorization?.id_token;
  if (!idToken) {
    throw new Error("Apple 응답에 id_token이 없습니다.");
  }
  return idToken;
}
