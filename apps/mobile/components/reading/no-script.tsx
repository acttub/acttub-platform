import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 리딩 하위 화면(상세·전체 대본·구간·회차)에서 고른 대본이 없을 때의 한 장. 「내 대본으로」는 대본 탭으로 간다.
 * replace 하면 탭 묶음이 하나 더 쌓여 뒤로가기가 엉뚱한 탭으로 가서, 이미 있는 탭까지 내려간다(SOMA-853).
 */
export function ReadingNoScript() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <Text style={styles.dim}>{t('reading.noScript')}</Text>
      <Pressable style={styles.pill} onPress={() => router.dismissTo('/reading')}>
        <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMeta, fontFamily: 'Pretendard', fontSize: 15 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
