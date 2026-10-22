import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

/**
 * 토스 카드 등록 창이 앱 스킴(actingapp://billing-result)으로 돌아올 때 Android 가 이 경로를 열 수 있다(SOMA-818). 결과는
 * 결제 창을 연 화면이 서버에서 다시 읽으므로 여기서는 바로 닫는다.
 */
export default function BillingResultScreen() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);
  return <View />;
}
