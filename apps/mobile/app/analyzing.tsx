import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 옛 A10 분석 화면 주소(practice.analyze). 분석 대기는 이제 코치 화면 안의 「영상 보는 중」이다(SOMA-778,
 * components/coach-waiting). 남아 있는 딥링크(`actingapp://analyzing?…`)·옛 복구 경로를 위해 받은 인자를 그대로 들고
 * 코치 화면으로 넘기기만 한다.
 */
export default function AnalyzingRedirect() {
  const params = useLocalSearchParams<{ practiceId?: string; recoveryKey?: string; preview?: string }>();
  return <Redirect href={{ pathname: '/coach', params }} />;
}
