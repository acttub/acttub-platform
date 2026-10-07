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
export const STORE_LINK_SURFACES = [
  "landing_header",
  "landing_hero",
  "landing_app_section",
  "landing_sticky",
  "landing_cta",
  "app_page",
  "keyword_page",
  /** 참여작 공유 페이지(/e/<id>)의 "앱에서 보기". */
  "entry_share",
] as const;
export type StoreLinkSurface = (typeof STORE_LINK_SURFACES)[number];

/**
 * 다운로드 경로에서 전달하는 캠페인 값.
 *
 * GA4의 수동 태깅 허용목록과 같은 UTM 6종만 다룬다. 클릭 하나를 식별하는 fbclid, gclid
 * 같은 값과 새로 생긴 임의 쿼리는 스토어로 보내지 않는다. 값은 캠페인 토큰으로 쓸 수 있는
 * ASCII 문자만, 64자까지만 허용한다. 이 제한이면 여섯 값을 모두 담아도 Google Play의
 * install referrer 512자 한도 안에 남는다.
 */
export const STORE_CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
] as const;

export const STORE_CAMPAIGN_VALUE_MAX_LENGTH = 64;
const STORE_CAMPAIGN_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeCampaignValue(value: string): boolean {
  return (
    value.length <= STORE_CAMPAIGN_VALUE_MAX_LENGTH &&
    STORE_CAMPAIGN_VALUE_PATTERN.test(value)
  );
}

/** 현재 주소에서 스토어 전달이 허용된 UTM만 고정된 순서로 남긴다. */
export function storeCampaignParams(search: string): URLSearchParams {
  const incoming = new URLSearchParams(search);
  const kept = new URLSearchParams();

  for (const key of STORE_CAMPAIGN_PARAMS) {
    const value = incoming.getAll(key).find(isSafeCampaignValue);
    if (value !== undefined) kept.set(key, value);
  }
  return kept;
}

/** `/app`과 `/go`를 지날 때 붙이는 안전한 UTM 쿼리. */
export function storeCampaignQuery(search: string): string {
  const query = storeCampaignParams(search).toString();
  return query ? `?${query}` : "";
}

/** Google Play Install Referrer에 넣을 캠페인. 유입 UTM이 비면 기존 웹 표면 귀속을 쓴다. */
export function playInstallReferrer(
  surface: StoreLinkSurface,
  search = "",
): string {
  const params = storeCampaignParams(search);
  if (!params.has("utm_source")) params.set("utm_source", "acttub_web");
  if (!params.has("utm_medium")) params.set("utm_medium", surface);
  return params.toString();
}

/**
 * App Store Connect가 이 개발자 계정에 발급한 제공자 토큰(`pt`). 공개 캠페인 링크에 그대로
 * 들어가는 값이라 비밀이 아니다. App Store 캠페인 이름(`ct`)은 이 값과 짝일 때만 앱 분석의
 * 캠페인 보고서에 잡힌다.
 */
export const APP_STORE_PROVIDER_TOKEN = "127135371";

/** App Store 캠페인 링크의 바탕 주소. App Store Connect의 "캠페인 링크 생성"이 주는 형식이다. */
export const APP_STORE_CAMPAIGN_BASE_URL =
  "https://apps.apple.com/app/apple-store/id6793056855";

/** App Store Connect 캠페인 이름(`ct`)의 최대 길이. */
export const APP_STORE_CAMPAIGN_TOKEN_MAX_LENGTH = 30;

/**
 * App Store 캠페인 이름(`ct`).
 *
 * 유입 UTM에 utm_campaign이 있으면 그 값을 쓴다. Meta 광고 관리자와 같은 이름으로 다운로드를
 * 나눠 보기 위해서다. 없으면 Google Play와 같은 기본 귀속을
 * `<utm_source 또는 acttub_web>_<utm_medium 또는 surface>` 한 줄로 쓴다. 30자를 넘으면 자른다.
 * 값은 이미 `isSafeCampaignValue`를 통과한 문자만 쓰므로 따로 인코딩할 문자가 없다.
 */
export function appStoreCampaignToken(
  surface: StoreLinkSurface,
  search = "",
): string {
  const params = storeCampaignParams(search);
  const token =
    params.get("utm_campaign") ??
    `${params.get("utm_source") ?? "acttub_web"}_${params.get("utm_medium") ?? surface}`;
  return token.slice(0, APP_STORE_CAMPAIGN_TOKEN_MAX_LENGTH);
}

/** App Store 캠페인 링크. App Store Connect의 "캠페인 링크 생성" 결과와 같은 순서(pt, ct, mt)다. */
export function appStoreCampaignHref(
  surface: StoreLinkSurface,
  search = "",
): string {
  return `${APP_STORE_CAMPAIGN_BASE_URL}?pt=${APP_STORE_PROVIDER_TOKEN}&ct=${appStoreCampaignToken(surface, search)}&mt=8`;
}

/**
 * 스토어로 나가는 주소.
 *
 * 배지 클릭은 `/go/<os>/<surface>` 페이지로드로 Cloudflare에서 센 뒤 이 주소로 이동한다.
 * Google Play에는 현재 주소의 안전한 UTM을 Install Referrer로 넘긴다. 명시적인 UTM이 없으면
 * 기존처럼 `utm_source=acttub_web`, `utm_medium=<surface>`를 쓴다. App Store에는 제공자
 * 토큰(`pt`)과 캠페인 이름(`ct`)을 붙인 캠페인 링크를 쓴다. 웹을 거친 iOS 다운로드를 App Store
 * Connect의 캠페인 보고서에서 광고별로 나눠 보기 위해서다.
 */
export function storeHref(
  store: AppStore,
  surface: StoreLinkSurface,
  search = "",
): string {
  if (store === "app_store") return appStoreCampaignHref(surface, search);

  const referrer = playInstallReferrer(surface, search);
  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}

/** Cloudflare가 배지 클릭을 셀 수 있도록 먼저 거치는 내부 페이지 주소. */
export function goHref(
  store: AppStore,
  surface: StoreLinkSurface,
  search = "",
): string {
  const os = store === "app_store" ? "ios" : "android";
  return `/go/${os}/${surface}${storeCampaignQuery(search)}`;
}

/**
 * 배지를 그리는 순서. 방문 기기를 보고 바꾸지 않는다. 정적 프리렌더라 기기 판별은
 * 하이드레이션 뒤에야 가능하고, 그때 순서가 뒤집히면 손가락이 이미 가 있던 배지가
 * 옮겨간다. 두 배지를 나란히 보여주면 한 번에 고를 수 있으므로 순서를 고정한다.
 */
export const STORE_ORDER: readonly AppStore[] = ["app_store", "google_play"];

export type MobileOs = "ios" | "android";

/**
 * 방문한 기기가 어느 스토어로 가야 하는지. 못 가리면 null 이고, 그때는 두 스토어를
 * 다 보여주는 `/app` 으로 보낸다.
 *
 * 안드로이드를 먼저 본다. 안드로이드 크롬의 UA 에도 "Safari" 와 "Mobile" 이 들어 있어
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

/** 기기에 맞는 스토어 주소. 못 가리면 UTM을 보존해 두 스토어를 보여주는 페이지로 간다. */
export function downloadHrefFor(
  os: MobileOs | null,
  surface: StoreLinkSurface,
  search = "",
): string {
  if (os === "ios") return storeHref("app_store", surface, search);
  if (os === "android") return storeHref("google_play", surface, search);
  return `/app${storeCampaignQuery(search)}`;
}

/** 다운로드 링크임을 알리는 표식. 값은 어느 화면인지(surface). */
export const APP_DOWNLOAD_ATTR = "data-app-download";
/** 특정 스토어의 `/go` 링크임을 알리는 표식. */
export const APP_DOWNLOAD_STORE_ATTR = "data-app-download-store";
/** `/go`에서 최종 스토어 주소를 만드는 링크임을 알리는 표식. */
export const APP_DOWNLOAD_FINAL_STORE_ATTR = "data-app-download-final-store";

/**
 * 하이드레이션을 기다리지 않고 앱 다운로드 링크를 올바른 경로로 보내는 인라인 스크립트.
 *
 * 자동 다운로드 버튼, 스토어 배지, `/go`의 최종 링크를 같은 규칙으로 처리한다. 현재 URL의
 * UTM은 메모리에서 읽어 링크에만 싣고 localStorage, sessionStorage, cookie에는 저장하지
 * 않는다. React가 붙은 뒤에도 같은 순수 함수 규칙을 쓰며 테스트가 두 결과를 묶어 둔다.
 */
export function buildAppDownloadBootstrapScript(): string {
  return [
    "(function(){",
    'if(window.__acttubAppDownloadBootstrap)return;window.__acttubAppDownloadBootstrap=true;',
    `var IOSC=${JSON.stringify(APP_STORE_CAMPAIGN_BASE_URL)},PT=${JSON.stringify(APP_STORE_PROVIDER_TOKEN)},CTMAX=${APP_STORE_CAMPAIGN_TOKEN_MAX_LENGTH},AND=${JSON.stringify(GOOGLE_PLAY_URL)};`,
    `var ATTR=${JSON.stringify(APP_DOWNLOAD_ATTR)},STORE=${JSON.stringify(APP_DOWNLOAD_STORE_ATTR)},FINAL=${JSON.stringify(APP_DOWNLOAD_FINAL_STORE_ATTR)};`,
    `var KEYS=${JSON.stringify(STORE_CAMPAIGN_PARAMS)},MAX=${STORE_CAMPAIGN_VALUE_MAX_LENGTH};`,
    "function os(u,t){",
    'if(/Android/i.test(u))return"android";',
    'if(/iPhone|iPad|iPod/i.test(u))return"ios";',
    'if(/Macintosh/i.test(u)&&t>1)return"ios";',
    "return null}",
    "function safe(v){return v.length>0&&v.length<=MAX&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)}",
    "function campaign(search){",
    'var input=new URLSearchParams(search||""),out=new URLSearchParams();',
    "for(var i=0;i<KEYS.length;i++){var values=input.getAll(KEYS[i]);",
    "for(var j=0;j<values.length;j++){if(safe(values[j])){out.set(KEYS[i],values[j]);break}}}",
    "return out}",
    'function query(search){var q=campaign(search).toString();return q?"?"+q:""}',
    "function referrer(s,search){var p=campaign(search);",
    'if(!p.has("utm_source"))p.set("utm_source","acttub_web");',
    'if(!p.has("utm_medium"))p.set("utm_medium",s);return p.toString()}',
    "function ct(s,search){var p=campaign(search);",
    'var t=p.has("utm_campaign")?p.get("utm_campaign"):(p.has("utm_source")?p.get("utm_source"):"acttub_web")+"_"+(p.has("utm_medium")?p.get("utm_medium"):s);',
    "return t.slice(0,CTMAX)}",
    'function store(k,s,search){return k==="app_store"?IOSC+"?pt="+PT+"&ct="+ct(s,search)+"&mt=8":AND+"&referrer="+encodeURIComponent(referrer(s,search))}',
    'function go(k,s,search){return "/go/"+(k==="app_store"?"ios":"android")+"/"+s+query(search)}',
    'function href(a){var s=a.getAttribute(ATTR)||"",search=location.search||"";',
    "var finalStore=a.getAttribute(FINAL);if(finalStore)return store(finalStore,s,search);",
    "var fixedStore=a.getAttribute(STORE);if(fixedStore)return go(fixedStore,s,search);",
    "var k=os(navigator.userAgent,navigator.maxTouchPoints||0);",
    'if(!k)return "/app"+query(search);return store(k==="android"?"google_play":"app_store",s,search)}',
    "function apply(){",
    'var a=document.querySelectorAll("a["+ATTR+"]");',
    "for(var i=0;i<a.length;i++)a[i].setAttribute(\"href\",href(a[i]))}",
    'document.addEventListener("click",function(e){',
    "var n=e.target,a=null;",
    "while(n&&n.nodeType===1){if(n.hasAttribute&&n.hasAttribute(ATTR)){a=n;break}n=n.parentNode}",
    "if(!a)return;var h=href(a);if(!h)return;a.setAttribute(\"href\",h);",
    "if(e.defaultPrevented)return;",
    "if(e.button!==undefined&&e.button!==0)return;",
    "if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;",
    'if(a.getAttribute("target")==="_blank"||a.hasAttribute("download"))return;',
    "e.preventDefault();location.href=h",
    "},true);",
    "apply();",
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",apply)',
    "})()",
  ].join("");
}
