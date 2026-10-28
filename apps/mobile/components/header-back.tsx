import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 스택 화면 헤더의 뒤로 버튼 — 설정 화면의 꺾쇠와 같은 모양(SOMA-638). 네이티브 뒤로 버튼은 iOS 에서 앞 화면 이름이
 * 붙고 눌리지 않는 경우가 있어 쓰지 않는다. 돌아갈 화면이 없으면(딥링크로 바로 연 화면) 그리지 않는다.
 * iOS 헤더(AppHeader)에서만 쓴다 — 안드로이드는 네이티브 뒤로 버튼에 꺾쇠 그림을 씌운다(SOMA-665, app/_layout).
 */
export function HeaderBack() {
  const router = useRouter();
  if (!router.canGoBack()) return null;
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')} ph-label="nav_back">
      <Feather name="chevron-left" size={24} color={palette.text} />
    </Pressable>
  );
}
