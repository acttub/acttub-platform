/**
 * 팀 브라우저의 Cloudflare Web Analytics 비컨을 막는다.
 *
 * Cloudflare 비컨은 프록시가 HTML에 자동으로 넣어서 사람별로 끌 수 없다. 팀이 랜딩을 열 때마다
 * 방문·기기 수에 섞여(2026-10-09 출처 미상 방문의 약 10%가 맥 크롬) 유입을 흐린다.
 *
 * 팀 브라우저는 `?acttub_team=1`로 한 번 열면 이 브라우저에 표시가 남고, 그 뒤로는 비컨 전송
 * (`/cdn-cgi/rum`)만 조용히 버린다. `?acttub_team=0`이면 표시를 지운다. 표시는 이 기기의
 * localStorage 한 칸뿐이며 서버나 다른 계측으로 보내지 않는다. 다른 요청은 그대로 지나간다.
 */
export const TEAM_BEACON_PARAM = "acttub_team";
export const TEAM_BEACON_STORAGE_KEY = "acttub_team";
export const CLOUDFLARE_BEACON_PATH = "/cdn-cgi/rum";

export function buildTeamBeaconGuardScript(): string {
  return [
    "(function(){try{",
    `var P=${JSON.stringify(TEAM_BEACON_PARAM)},K=${JSON.stringify(TEAM_BEACON_STORAGE_KEY)},R=${JSON.stringify(CLOUDFLARE_BEACON_PATH)};`,
    "var v=new URLSearchParams(location.search).get(P);",
    'if(v==="1")localStorage.setItem(K,"1");',
    'if(v==="0")localStorage.removeItem(K);',
    'if(localStorage.getItem(K)!=="1")return;',
    "function rum(u){try{return String(u&&u.url?u.url:u).indexOf(R)>=0}catch(e){return false}}",
    "var n=navigator;if(n&&typeof n.sendBeacon===\"function\"){var sb=n.sendBeacon.bind(n);",
    "n.sendBeacon=function(u,d){return rum(u)?true:sb(u,d)}}",
    "if(typeof window.fetch===\"function\"){var f=window.fetch;",
    "window.fetch=function(i,o){return rum(i)?Promise.resolve(new Response(null,{status:204})):f.apply(this,arguments)}}",
    "if(window.XMLHttpRequest){var X=XMLHttpRequest.prototype,xo=X.open,xs=X.send;",
    "X.open=function(m,u){this.__acttubRum=rum(u);return xo.apply(this,arguments)};",
    "X.send=function(){if(this.__acttubRum)return;return xs.apply(this,arguments)}}",
    "}catch(e){}})()",
  ].join("");
}
