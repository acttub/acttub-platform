import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「Checkbox/On·Off·Danger」 — 원 22. 켜짐은 blue 로 채운 원 안에 흰 체크, 꺼짐은 1.5px text-disabled 빈 원.
 * 체크는 Feather check 16(그림 약 11×8, pen 체크 크기). 선 굵기는 글꼴 아이콘이라 pen(2.2)보다 가늘다.
 * 되돌릴 수 없는 일에 동의하는 체크만 `danger`로 켜짐을 빨갛게 한다.
 * 누르는 자리·접근성 역할은 줄(Pressable)이 갖는다. 이것은 그림만 그린다.
 */
export function Checkbox({ checked, danger }: { checked: boolean; danger?: boolean }) {
  if (!checked) return <View style={styles.off} />;
  return (
    <View style={[styles.on, { backgroundColor: danger ? palette.danger : palette.blue }]}>
      <Feather name="check" size={16} color={palette.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  off: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, borderColor: palette.textDisabled },
  on: { width: 22, height: 22, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
