import { Redirect, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { logEvent } from '@/lib/analytics';

/** 계측에 남길 주소 길이. */
const PATH_MAX = 100;

/**
 * 앱에 없는 주소로 들어왔을 때(SOMA-1091).
 *
 * expo-router 기본 화면(영어 「Unmatched Route」)은 우리 레이아웃 밖에서 떠 크래시 수집·로그인 확인이 돌지 않았고,
 * 그 화면의 「Sitemap」은 운영 빌드에서 앱을 껐다(window.location 없음). 이 파일이 있으면 없는 주소도 우리 레이아웃
 * 안에서 받는다. 보여 줄 것이 없으니 어떤 주소였는지만 남기고 홈으로 보낸다.
 */
export default function NotFound() {
  const pathname = usePathname();
  useEffect(() => {
    logEvent('route_not_found', { path: pathname.slice(0, PATH_MAX) });
  }, [pathname]);
  return <Redirect href="/" />;
}
