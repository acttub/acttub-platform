import { isNaverReturnUrl } from '@/lib/naver-login';

/**
 * 앱으로 들어온 주소를 라우터가 열기 전에 거른다(expo-router).
 *
 * 네이버 로그인 결과(`actingapp://auth/naver?...`)는 화면이 아니라 열려 있는 브라우저 인증 세션의
 * 답이다. 안드로이드에서는 이 주소가 앱 링크로도 들어오므로 라우터가 없는 화면으로 가지 않게 버린다
 * (인증 세션은 같은 주소를 따로 받는다). 앱이 꺼져 있다가 이 주소로 켜졌으면 첫 화면으로 보낸다.
 * 나머지 주소는 그대로 둔다.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (isNaverReturnUrl(path)) return initial ? '/' : null;
  return path;
}
