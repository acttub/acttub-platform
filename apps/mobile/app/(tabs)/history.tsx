import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type ReportRecord } from '@/lib/api';
import { RecordCard, type RecordMeta } from '@/components/record-card';
import { setSelectedReport } from '@/lib/selected-report';
import { formatKoreanMonth } from '@/lib/format';
import { palette } from '@/constants/palette';

/**
 * 연습 기록 — 서버 정본(GET /v2/reports)의 지난 피드백 목록.
 * 월별 섹션 + 공용 RecordCard(제목·태그칩·메뉴). 카드를 누르면 상세로 이동한다.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [meta, setMeta] = useState<Record<string, RecordMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const history = await api.reportHistory();
      setReports(history.reports);
      // 목록엔 태그 정보가 없으므로 카드별 상세를 불러와 칩(진단 축·구간)을 채운다.
      const entries = await Promise.all(
        history.reports.map(async (r) => {
          try {
            const d = await api.reportDetail(r.practice_session_id);
            const bp = d.report?.biggest_problem;
            return [
              r.practice_session_id,
              { dimension: bp?.dimension ?? '', start: bp?.start ?? '', end: bp?.end ?? '' },
            ] as const;
          } catch {
            return [r.practice_session_id, { dimension: '', start: '', end: '' }] as const;
          }
        }),
      );
      setMeta(Object.fromEntries(entries));
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

  // 월별 섹션으로 그룹핑 (서버가 최신순으로 준다).
  const sections = useMemo(() => {
    const out: { month: string; items: ReportRecord[] }[] = [];
    let cur: { month: string; items: ReportRecord[] } | null = null;
    for (const r of reports) {
      const m = formatKoreanMonth(r.created_at);
      if (!cur || cur.month !== m) {
        cur = { month: m, items: [] };
        out.push(cur);
      }
      cur.items.push(r);
    }
    return out;
  }, [reports]);

  const openDetail = (item: ReportRecord) => {
    setSelectedReport(item);
    router.push('/report-detail' as Href);
  };

  const confirmDelete = (item: ReportRecord) => {
    Alert.alert('삭제할까요?', '이 연습 기록을 지우면 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePracticeSession(item.practice_session_id);
            load();
          } catch (e) {
            Alert.alert('삭제 실패', e instanceof Error ? e.message : '삭제하지 못했어요.');
          }
        },
      },
    ]);
  };

  const onMenu = (item: ReportRecord) => {
    Alert.alert('이 기록', undefined, [
      { text: '전체 보기', onPress: () => openDetail(item) },
      { text: '삭제', style: 'destructive', onPress: () => confirmDelete(item) },
      { text: '취소', style: 'cancel' },
    ]);
  };

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

        {sections.map((section) => (
          <View key={section.month}>
            <Text style={styles.monthHeader}>{section.month}</Text>
            {section.items.map((item) => (
              <RecordCard
                key={item.practice_session_id}
                item={item}
                meta={meta[item.practice_session_id]}
                onPress={() => openDetail(item)}
                onMenu={() => onMenu(item)}
              />
            ))}
          </View>
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
  safe: { flex: 1, backgroundColor: palette.bgSoft },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
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
  monthHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textDim,
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
});
