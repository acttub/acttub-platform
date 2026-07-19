// Google Identity Services(GIS) 스크립트 로더·래퍼.
// 모듈 최상위에서 window에 접근하지 않는다 (정적 프리렌더 제약).

interface GisCredentialResponse {
  credential: string;
}

interface GisButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  shape?: "rectangular" | "pill" | "circle" | "square";
  width?: number;
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  locale?: string;
}

interface GisIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GisCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: GisButtonOptions): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GisIdApi;
      };
    };
  }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// 단일 promise 캐시로 중복 로드를 막는다. 실패 시 캐시를 비워 새로고침 없이도 재시도 가능하게 한다.
let gisLoadPromise: Promise<GisIdApi> | null = null;

function loadGisIdApi(): Promise<GisIdApi> {
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<GisIdApi>((resolve, reject) => {
    const existing = window.google?.accounts?.id;
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const api = window.google?.accounts?.id;
      if (api) {
        resolve(api);
      } else {
        gisLoadPromise = null;
        reject(new Error("GIS 스크립트는 로드됐지만 API를 찾을 수 없습니다."));
      }
    };
    script.onerror = () => {
      gisLoadPromise = null;
      script.remove();
      reject(new Error("GIS 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

// GIS 버튼 렌더 폭 상한 (Google 정책상 최대 400px).
const MAX_BUTTON_WIDTH = 400;

export async function renderGoogleLoginButton(options: {
  clientId: string;
  container: HTMLElement;
  onCredential: (credential: string) => void;
}): Promise<void> {
  const api = await loadGisIdApi();
  api.initialize({
    client_id: options.clientId,
    callback: (response) => options.onCredential(response.credential),
  });
  const measured = options.container.offsetWidth;
  api.renderButton(options.container, {
    theme: "filled_blue",
    shape: "pill",
    size: "large",
    width:
      measured > 0 ? Math.min(measured, MAX_BUTTON_WIDTH) : MAX_BUTTON_WIDTH,
  });
}
