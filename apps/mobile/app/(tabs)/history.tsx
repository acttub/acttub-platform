import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { RecordCard, type RecordMeta } from '@/components/record-card';
import { api, type PracticeSessionListItem, type ReportRecord } from '@/lib/api';
import { deletePracticeSessionIdempotently } from '@/lib/delete-practice';
import { formatKoreanMonth } from '@/lib/format';
import { mergeHistory, sessionCardTitle } from '@/lib/history-merge';
import { setPrefill } from '@/lib/practice';
import { loadRecordMeta } from '@/lib/record-meta';
import { sortReportsNewestFirst } from '@/lib/report-order';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 연습 기록 — 서버 정본(GET /v2/reports)의 지난 피드백 목록.
 * 월별 섹션 + 공용 RecordCard(제목·태그칩·메뉴). 카드를 누르면 상세로 이동한다.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [sessions, setSessions] = useState<PracticeSessionListItem[]>([]);
  const [meta, setMeta] = useState<Record<string, RecordMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, alert, sheet, dialog } = useAppDialog();

  const load = useCallback(async () => {
    setError(null);
    try {
      // 정리가 아직 없는 연습도 보여준다(SOMA-444) — 웹과 같은 그림.
      // 세션 목록이 실패해도 리포트만으로는 화면이 서야 하므로 따로 삼킨다.
      const [history, sessionList] = await Promise.all([
        api.reportHistory(),
        api.listPracticeSessions().catch(() => ({ sessions: [] as PracticeSessionListItem[] })),
      ]);
      setSessions(sessionList.sessions);
      const sorted = sortReportsNewestFirst(history.reports);
      setReports(sorted);
      // 목록엔 진단 축·구간이 없어서 카드별 상세를 따로 불러 칩을 채운다.
      setMeta(
        await loadRecordMeta(
          sorted.map((r) => r.practice_session_id),
          (id) => api.getReport(id),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('history.loadFail'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // 리포트 + 정리 없는 세션을 시간순으로 섞고, 월별 섹션으로 그룹핑한다.
  const sections = useMemo(() => {
    const merged = mergeHistory(sessions, reports);
    type Entry = (typeof merged)[number];
    const out: { month: string; items: Entry[] }[] = [];
    let cur: { month: string; items: Entry[] } | null = null;
    for (const entry of merged) {
      const m = formatKoreanMonth(entry.createdAt);
      if (!cur || cur.month !== m) {
        cur = { month: m, items: [] };
        out.push(cur);
      }
      cur.items.push(entry);
    }
    return out;
  }, [reports, sessions]);

  const openDetail = (item: ReportRecord) => {
    router.push({
      pathname: '/report-detail',
      params: { practiceSessionId: item.practice_session_id },
    });
  };

  const confirmDelete = async (item: ReportRecord) => {
    const ok = await confirm({
      title: t('history.deleteTitle'),
      message: t('history.deleteReportMsg'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePracticeSessionIdempotently(item.practice_session_id, api.deletePracticeSession);
      load();
    } catch (e) {
      await alert({
        title: t('history.deleteFailTitle'),
        message: e instanceof Error ? e.message : t('history.deleteFail'),
      });
    }
  };

  const onMenu = (item: ReportRecord) => {
    void sheet({
      title: t('history.itemMenuTitle'),
      actions: [
        { label: t('history.fullView'), onPress: () => openDetail(item) },
        { label: t('common.delete'), destructive: true, onPress: () => void confirmDelete(item) },
      ],
    });
  };

  // ---- 정리가 아직 없는 세션 카드 (SOMA-444) ----

  const retakeSession = (s: PracticeSessionListItem) => {
    setPrefill({
      scene: { situation: s.situation, character: s.character_context, goal: s.goal },
      continuedFrom: null,
    });
    router.push('/upload');
  };

  const confirmDeleteSession = async (s: PracticeSessionListItem) => {
    const ok = await confirm({
      title: t('history.deleteTitle'),
      message: t('history.deleteSessionMsg'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePracticeSessionIdempotently(s.session_id, api.deletePracticeSession);
      load();
    } catch (e) {
      await alert({
        title: t('history.deleteFailTitle'),
        message: e instanceof Error ? e.message : t('history.deleteFail'),
      });
    }
  };

  const onSessionMenu = (s: PracticeSessionListItem) => {
    void sheet({
      title: t('history.sessionMenuTitle'),
      actions: [
        { label: t('history.retakeSame'), onPress: () => retakeSession(s) },
        { label: t('common.delete'), destructive: true, onPress: () => void confirmDeleteSession(s) },
      ],
    });
  };

  /** RecordCard 를 그대로 쓰기 위한 겉모습 — 제목·시각만 쓴다. */
  const sessionAsRecord = (s: PracticeSessionListItem): ReportRecord => ({
    practice_session_id: s.session_id,
    report_type: 'analysis',
    title: sessionCardTitle(s.situation),
    created_at: s.created_at,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>{t('history.title')}</Text>
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
            {section.items.map((entry) =>
              entry.kind === 'report' ? (
                <RecordCard
                  key={entry.report.practice_session_id + entry.report.created_at}
                  item={entry.report}
                  meta={meta[entry.report.practice_session_id]}
                  onPress={() => openDetail(entry.report)}
                  onMenu={() => onMenu(entry.report)}
                />
              ) : (
                <RecordCard
                  key={entry.session.session_id + entry.session.created_at}
                  item={sessionAsRecord(entry.session)}
                  meta={{ kind: t('history.noSummaryKind'), start: '', end: '' }}
                  onPress={() => onSessionMenu(entry.session)}
                  onMenu={() => onSessionMenu(entry.session)}
                />
              ),
            )}
          </View>
        ))}

        {!loading && !error && reports.length === 0 && sessions.length === 0 && (
          <Text style={styles.empty}>
            {t('history.empty')}
          </Text>
        )}
      </ScrollView>
      {dialog}
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
