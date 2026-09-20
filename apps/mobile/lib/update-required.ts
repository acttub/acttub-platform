/**
 * 업데이트 안내(426) 화면이 열 스토어 주소.
 *
 * 안드로이드는 패키지 이름으로 만든다. iOS는 App Store의 숫자 id가 있어야 해서 공개
 * 설정값(EXPO_PUBLIC_IOS_APP_STORE_URL)으로 받는다. 주소를 모르면 null — 화면은 버튼 없이
 * 안내 문장만 보여 준다.
 */
export function storeUrlFor(input: {
  platform: string;
  androidPackage: string | undefined;
  iosAppStoreUrl: string;
}): string | null {
  if (input.platform === 'android') {
    return input.androidPackage
      ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(input.androidPackage)}`
      : null;
  }
  if (input.platform === 'ios') return input.iosAppStoreUrl || null;
  return null;
}
