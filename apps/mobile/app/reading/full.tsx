import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { palette } from '@/constants/palette';
import { getCurrent, isMyRole } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/** 대본 전체(R3.4). 목소리 정하기의 [전체 보기]와 대본 상세의 「대본 보기」가 같이 연다. 보기만 한다. */
export default function ReadingFull() {
  const router = useRouter();
  const script = getCurrent();

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{script.title}</Text>
      {script.lines.map((l, i) =>
        l.type === 'scene' ? (
          <Text key={i} style={styles.scene}>{l.text}</Text>
        ) : l.type === 'direction' ? (
          <Text key={i} style={styles.direction}>{l.text}</Text>
        ) : (
          <View key={i} style={styles.line}>
            <Text style={[styles.role, isMyRole(l.role) && styles.roleMine]}>{l.role}</Text>
            <Text style={styles.text}>{l.text}</Text>
          </View>
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 12, paddingBottom: 60 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 20, marginBottom: 4 },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, fontStyle: 'italic', lineHeight: 21, marginVertical: 4 },
  scene: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 10, marginBottom: 2 },
  line: { gap: 2 },
  role: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  roleMine: { color: palette.blueDeep },
  text: { color: palette.text, fontFamily: 'Pretendard', fontSize: 16, lineHeight: 24 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
