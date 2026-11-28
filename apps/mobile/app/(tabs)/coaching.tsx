import { Redirect } from 'expo-router';

/**
 * 예전 코칭 탭 주소('/coaching') — 연습 탭 코칭으로 보낸다. 서버 공지 버튼·옛 딥링크가 이 주소를 쓸 수 있어 남긴다.
 * 탭 바에는 없다(app/(tabs)/_layout). 앱 안에서는 연습 탭 주소(lib/practice-mode practiceHref)를 쓴다.
 */
export default function CoachingRedirect() {
  return <Redirect href="/practice?mode=coaching" />;
}
