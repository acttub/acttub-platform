import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 코칭 탭 입구의 「영상 없이 말로 코칭 받기」(pen 「코칭 탭 · 처음 (입구 3개)」, SOMA-745). 누르면 목적 화면(app/talk)을 연다.
 * 코칭 탭의 「찍어 둔 영상 올리기」와 같은 보조 버튼 모양이다.
 */
export function TalkEntryButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('coachingTab.talk')}
      ph-label="coaching_talk"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Feather name="message-circle" size={15} color={palette.textSub} />
      <Text style={styles.text}>{t('coachingTab.talk')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  pressed: { opacity: 0.85 },
  text: { fontSize: 15, fontWeight: '600', color: palette.textSub },
});
