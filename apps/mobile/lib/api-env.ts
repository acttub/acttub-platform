/**
 * 운영 API를 보는 빌드인지(SOMA-439). 계측(Firebase Analytics·Meta)은 운영 빌드에서만 보내고,
 * 크래시에는 환경 이름을 붙인다 — 개발 빌드가 같은 계정으로 보내면 운영 지표가 오염된다.
 *
 * ⚠️ eas.json 의 production/preview-prod 프로필 EXPO_PUBLIC_API_URL 과 같은 값이어야 한다 —
 * 운영 API 주소를 바꾸면 여기도 같이 바꾼다. 안 그러면 계측이 조용히 멈춘다.
 * Metro 는 `process.env.EXPO_PUBLIC_*` 리터럴만 치환하므로 값은 부르는 쪽이 리터럴로 읽어 넘긴다.
 */
export const PRODUCTION_API_URL = 'https://acttub.com';

/** 앞뒤 공백·끝 슬래시·대소문자를 무시하고 비교한다. 미설정은 lib/api.ts 와 같이 dev 로 본다. */
export function isProductionApiUrl(apiUrl: string | undefined): boolean {
  return (apiUrl ?? '').trim().replace(/\/+$/, '').toLowerCase() === PRODUCTION_API_URL;
}
