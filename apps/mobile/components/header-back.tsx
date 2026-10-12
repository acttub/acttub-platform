import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Platform, Pressable } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 스택 화면 헤더의 뒤로 버튼 — 설정 화면의 꺾쇠와 같은 모양(SOMA-638). 네이티브 뒤로 버튼은 iOS 에서 앞 화면 이름이
 * 붙고 눌리지 않는 경우가 있어 쓰지 않는다.
 *
 * <p>돌아갈 화면이 없으면(딥링크로 바로 연 화면) 안 보이게 한다. 안드로이드에서는 그래도 늘 그려 두고 숨기기만 한다 —
 * 뒤로 가기를 붙잡았다 다시 보내는 화면(예시 코치)이 닫히는 사이에 이 버튼이 사라졌다 생기면 네이티브 헤더가 같은
 * 조각을 두 번 붙이려다 앱이 꺼졌다(SOMA-665). iOS 는 헤더를 앱이 그려서(AppHeader) 빼도 되고, 빼야 제목이 붙는다.
 */
export function HeaderBack() {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  if (!canGoBack && Platform.OS === 'ios') return null;
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
      }}
      disabled={!canGoBack}
      style={{ opacity: canGoBack ? 1 : 0 }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      accessibilityElementsHidden={!canGoBack}
      importantForAccessibility={canGoBack ? 'auto' : 'no-hide-descendants'}>
      <Feather name="chevron-left" size={26} color={palette.text} />
    </Pressable>
  );
}
