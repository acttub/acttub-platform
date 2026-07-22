import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { getSelectedReport } from '@/lib/selected-report';
import { palette } from '@/constants/palette';

/**
 * 지난 피드백 상세 — 기록 화면에서 카드를 누르면 열린다.
 * GET /v2/reports가 준 리포트 전문을 추가 호출 없이 그대로 보여준다.
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const record = getSelectedReport();
  const [deleting, setDeleting] = useState(false);

  const onDelete = () => {
    if (!record) return;
    Alert.alert('삭제할까요?', '이 연습 기록을 지우면 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deletePracticeSession(record.session_id);
            router.back();
          } catch (err) {
            setDeleting(false);
            Alert.alert('삭제 실패', err instanceof Error ? err.message : '삭제하지 못했어요.');
          }
        },
      },
    ]);
  };

  if (!record) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '피드백 카드' }} />
        <View style={styles.center}>
          <Text style={styles.empty}>기록을 불러오지 못했어요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { report } = record;
  const problemRange =
    report.biggest_problem.end && report.biggest_problem.end !== report.biggest_problem.start
      ? `${report.biggest_problem.start} ~ ${report.biggest_problem.end}`
      : report.biggest_problem.start;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '피드백 카드' }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.date}>
          {new Date(record.created_at).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        <Text style={styles.headline}>{report.headline}</Text>

        <View style={[styles.block, styles.blockGreen]}>
          <Text style={[styles.blockTag, styles.tagGreen]}>✓ 잘된 순간</Text>
          <Text style={styles.blockBody}>{report.encouragement}</Text>
        </View>

        <View style={[styles.block, styles.blockBlue]}>
          <Text style={[styles.blockTag, styles.tagBlue]}>이번엔 이거 딱 하나 · {problemRange}</Text>
          <Text style={styles.blockBody}>{report.biggest_problem.description}</Text>
          {!!report.evidence && <Text style={styles.evidence}>{report.evidence}</Text>}
        </View>

        {!!report.self_discovery && (
          <View style={styles.block}>
            <Text style={styles.blockTag}>대화에서 스스로 찾으신 것</Text>
            <Text style={styles.blockBody}>{report.self_discovery}</Text>
          </View>
        )}

        {!!report.comparison && (
          <View style={[styles.block, styles.blockPurple]}>
            <Text style={[styles.blockTag, styles.tagPurple]}>지난번과 비교하면</Text>
            <Text style={styles.blockBody}>{report.comparison}</Text>
          </View>
        )}

        <View style={[styles.block, styles.blockSoft]}>
          <Text style={[styles.blockTag, styles.tagBlue]}>다음 한 걸음</Text>
          <Text style={styles.blockBody}>→ {report.next_step}</Text>
        </View>

        <Pressable style={styles.deleteButton} onPress={onDelete} disabled={deleting}>
          {deleting ? (
            <ActivityIndicator color={palette.danger} />
          ) : (
            <Text style={styles.deleteText}>이 기록 삭제</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: palette.textDim, fontSize: 15 },
  container: { padding: 20, paddingBottom: 40 },
  date: { color: palette.textFaint, fontSize: 13, marginBottom: 8 },
  headline: { fontSize: 21, fontWeight: '800', color: palette.text, lineHeight: 30, marginBottom: 18 },
  block: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  blockGreen: { backgroundColor: palette.greenSoft, borderColor: palette.greenSoft },
  blockBlue: { borderColor: palette.blue, borderWidth: 1.5 },
  blockPurple: { backgroundColor: palette.purpleSoft, borderColor: palette.purpleSoft },
  blockSoft: { backgroundColor: palette.blueSoft, borderColor: palette.blueSoft },
  blockTag: { fontSize: 12, fontWeight: '800', color: palette.textDim, marginBottom: 6 },
  tagGreen: { color: palette.green },
  tagBlue: { color: palette.blue },
  tagPurple: { color: palette.purple },
  blockBody: { fontSize: 15, color: palette.text, lineHeight: 23 },
  evidence: { fontSize: 13, color: palette.textDim, lineHeight: 20, marginTop: 8 },
  deleteButton: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.danger,
    alignItems: 'center',
  },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
});
