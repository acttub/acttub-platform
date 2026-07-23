import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type ReportRecord } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { palette } from '@/constants/palette';

/**
 * 연습 기록 — 서버 정본(GET /v2/reports)의 지난 피드백 목록.
 * 카드를 누르면 상세(전체 보기)로 이동한다. 삭제는 상세 화면 맨 아래에서 한다.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const history = await api.reportHistory();
      setReports(history.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : '기록을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>연습 기록</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={palette.blue} />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {reports.map((item) => (
          <Pressable
            key={item.practice_session_id + item.created_at}
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: '/report-detail',
                params: { practiceSessionId: item.practice_session_id },
              })
            }>
            <Text style={styles.date}>{formatKoreanDate(item.created_at)}</Text>
            <Text style={styles.headline}>{item.headline}</Text>
            <Text style={styles.viewMore}>전체 보기 ›</Text>
          </Pressable>
        ))}

        {!loading && !error && reports.length === 0 && (
          <Text style={styles.empty}>
            아직 기록이 없어요.{'\n'}첫 영상을 올리면 여기에 카드가 쌓여요.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: palette.text,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  list: { padding: 20, paddingBottom: 130 },
  center: { paddingVertical: 40, alignItems: 'center' },
  error: { color: palette.danger, textAlign: 'center', paddingVertical: 10 },
  empty: {
    color: palette.textDim,
    textAlign: 'center',
    marginTop: 60,
    fontSize: 15,
    lineHeight: 24,
  },
  card: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  date: { color: palette.textFaint, fontSize: 12, marginBottom: 6 },
  headline: { color: palette.text, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  viewMore: { color: palette.textFaint, fontSize: 12, fontWeight: '700', marginTop: 10, alignSelf: 'flex-end' },
});
