import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 코칭 탭의 「찍을 대사부터 같이 만들기」 줄(pen 「v4 C 코칭 입구 · 첫」의 고르기 마지막 줄, SOMA-721). 찍을 대본이 없는 배우가
 * 감정·상황으로 대본을 같이 만드는 화면(app/script-cocreate)으로 간다.
 */
export function ScriptCocreateEntry({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/script-cocreate')}
      accessibilityRole="button"
      accessibilityLabel={t('scriptCocreate.entryTitle')}
      ph-label="coaching_script_cocreate"
      style={({ pressed }) => [styles.row, style, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Feather name="edit-3" size={18} color={palette.textMuted} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('scriptCocreate.entryTitle')}</Text>
        <Text style={styles.sub}>{t('scriptCocreate.entrySub')}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.checkOff} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    // 흰 바탕에 한 단계 진한 1px 테두리(SOMA-923, 디자인 시스템 「의도된 차이」).
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.bg,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bgSoft },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '800', color: palette.text },
  sub: { fontSize: 12, fontWeight: '500', color: palette.textMuted },
});
