import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { recordChips, type RecordMeta } from '@/components/record-card';
import { palette } from '@/constants/palette';
import { api, type PracticeSessionListItem, type ReportRecord } from '@/lib/api';
import { deletePracticeSessionIdempotently } from '@/lib/delete-practice';
import { formatKoreanDate } from '@/lib/format';
import { mergeHistory, sessionCardTitle } from '@/lib/history-merge';
import { translate as t } from '@/lib/i18n';
import { setPrefill } from '@/lib/practice';
import { buildWeekActivity } from '@/lib/practice-activity';
import { listScripts, loadIntoCurrent, type SavedScript } from '@/lib/reading/store';
import { loadRecordMeta } from '@/lib/record-meta';
import { sortReportsNewestFirst } from '@/lib/report-order';
import { sceneValueForDisplay } from '@/lib/upload-input';

type Filter = 'all' | 'fav' | 'recent';

/** 화면 한 줄 — 리포트·정리 없는 세션·대본 리딩을 한 모양으로 편다. */
type Row = {
  id: string;
  createdAt: string;
  icon: 'video' | 'mic';
  title: string;
  meta: string;
  chips: string[];
  onPress: () => void;
  onLongPress?: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A1.1 연습 기록 · 전체 보기 — 홈의 "최근 연습 → 전체 보기"가 온다.
 *
 * 위: 요약 카드(총 연습 / 남긴 문장 / 이번 주) + 필터 칩(전체·즐겨찾기·최근 30일).
 * 아래: 월별 그룹 → 한 줄씩(아이콘 · 제목 · 날짜 메타 · 주제 칩 · 화살표).
 * 리포트(GET /v2/reports)·정리 없는 세션(SOMA-444)·기기 저장 대본 리딩(녹음 있는 것만)을
 * 함께 시간순으로 보여준다. 즐겨찾기는 아직 저장 필드가 없어 빈 상태만 그린다.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [sessions, setSessions] = useState<PracticeSessionListItem[]>([]);
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [meta, setMeta] = useState<Record<string, RecordMeta>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, alert, sheet, dialog } = useAppDialog();

  const load = useCallback(async () => {
    setError(null);
    try {
      // 세션 목록·대본은 실패해도 리포트만으로 화면이 서야 하므로 따로 삼킨다.
      const [history, sessionList, savedScripts] = await Promise.all([
        api.reportHistory(),
        api.listPracticeSessions().catch(() => ({ sessions: [] as PracticeSessionListItem[] })),
        listScripts().catch(() => [] as SavedScript[]),
      ]);
      setSessions(sessionList.sessions);
      setScripts(savedScripts.filter((s) => s.recordings.length > 0));
      const sorted = sortReportsNewestFirst(history.reports);
      setReports(sorted);
      // 목록엔 진단 축이 없어서 카드별 상세를 따로 불러 칩을 채운다.
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

  const openDetail = (item: ReportRecord) => {
    router.push({ pathname: '/report-detail', params: { practiceSessionId: item.practice_session_id } });
  };

  const confirmDelete = async (sessionId: string, message: string) => {
    const ok = await confirm({
      title: t('history.deleteTitle'),
      message,
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePracticeSessionIdempotently(sessionId, api.deletePracticeSession);
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
        {
          label: t('common.delete'),
          destructive: true,
          onPress: () => void confirmDelete(item.practice_session_id, t('history.deleteReportMsg')),
        },
      ],
    });
  };

  // 정리가 아직 없는 세션(SOMA-444) — 같은 장면 다시 찍기 / 삭제.
  const retakeSession = (s: PracticeSessionListItem) => {
    setPrefill({
      scene: {
        situation: sceneValueForDisplay(s.situation),
        character: sceneValueForDisplay(s.character_context),
        goal: sceneValueForDisplay(s.goal),
      },
      continuedFrom: null,
    });
    router.push('/upload');
  };

  const onSessionMenu = (s: PracticeSessionListItem) => {
    void sheet({
      title: t('history.sessionMenuTitle'),
      actions: [
        { label: t('history.retakeSame'), onPress: () => retakeSession(s) },
        {
          label: t('common.delete'),
          destructive: true,
          onPress: () => void confirmDelete(s.session_id, t('history.deleteSessionMsg')),
        },
      ],
    });
  };

  const openScript = async (s: SavedScript) => {
    await loadIntoCurrent(s.id);
    router.push('/reading/detail');
  };

  const dayLabel = (iso: string) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });

  // 세 종류를 한 줄 모양으로 펴고 최신순으로 섞는다.
  const rows = useMemo<Row[]>(() => {
    const merged = mergeHistory(sessions, reports).map<Row>((entry) =>
      entry.kind === 'report'
        ? {
            id: `r:${entry.report.practice_session_id}`,
            createdAt: entry.createdAt,
            icon: 'video',
            title: entry.report.title,
            meta: `${dayLabel(entry.createdAt)} · ${t('history.statusDone')}`,
            chips: recordChips(meta[entry.report.practice_session_id]),
            onPress: () => openDetail(entry.report),
            onLongPress: () => onMenu(entry.report),
          }
        : {
            id: `s:${entry.session.session_id}`,
            createdAt: entry.createdAt,
            icon: 'video',
            title: sessionCardTitle(entry.session.situation),
            meta: dayLabel(entry.createdAt),
            chips: [t('history.noSummaryKind')],
            onPress: () => onSessionMenu(entry.session),
            onLongPress: () => onSessionMenu(entry.session),
          },
    );
    const reading = scripts.map<Row>((s) => {
      const latest = Math.max(...s.recordings.map((r) => r.createdAt));
      const createdAt = new Date(latest).toISOString();
      const role = s.myRoles[0];
      return {
        id: `d:${s.id}`,
        createdAt,
        icon: 'mic',
        title: role ? `${s.title} · ${role} ${t('history.readingLabel')}` : s.title,
        meta: `${dayLabel(createdAt)} · ${t('history.recordingCount', { count: s.recordings.length })}`,
        chips: [],
        onPress: () => void openScript(s),
      };
    });
    return [...merged, ...reading].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, sessions, scripts, meta]);

  const filtered = useMemo(() => {
    if (filter === 'fav') return [];
    if (filter === 'recent') {
      const since = Date.now() - 30 * DAY_MS;
      return rows.filter((r) => Date.parse(r.createdAt) >= since);
    }
    return rows;
  }, [rows, filter]);

  // 월별 그룹 — 라벨은 "8월"처럼 짧게. 해가 바뀌면 연도를 붙인다.
  const groups = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const out: { label: string; items: Row[] }[] = [];
    let cur: { label: string; items: Row[] } | null = null;
    for (const row of filtered) {
      const d = new Date(row.createdAt);
      const label = formatKoreanDate(
        row.createdAt,
        d.getFullYear() === thisYear ? { month: 'long' } : { year: 'numeric', month: 'long' },
      );
      if (!cur || cur.label !== label) {
        cur = { label, items: [] };
        out.push(cur);
      }
      cur.items.push(row);
    }
    return out;
  }, [filtered]);

  const weekTotal = useMemo(
    () => buildWeekActivity(rows.map((r) => ({ created_at: r.createdAt }))).weekTotal,
    [rows],
  );

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="arrow-left" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('history.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.summary}>
          <Stat value={t('history.countTimes', { count: rows.length })} label={t('history.statTotal')} />
          <View style={styles.statDivider} />
          <Stat value={t('history.countItems', { count: reports.length })} label={t('history.statLines')} />
          <View style={styles.statDivider} />
          <Stat value={t('history.countTimes', { count: weekTotal })} label={t('history.statWeek')} />
        </View>

        <View style={styles.filters}>
          {(
            [
              ['all', 'history.filterAll'],
              ['fav', 'history.filterFav'],
              ['recent', 'history.filterRecent'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.filterChip, filter === key && styles.filterChipOn]}
              onPress={() => setFilter(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}>
              <Text style={[styles.filterText, filter === key && styles.filterTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={palette.blue} />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {groups.map((group) => (
          <View key={group.label}>
            <Text style={styles.monthHeader}>{group.label}</Text>
            {group.items.map((row) => (
              <Pressable
                key={row.id}
                style={styles.row}
                onPress={row.onPress}
                onLongPress={row.onLongPress}
                accessibilityRole="button">
                <View style={styles.iconCircle}>
                  <Feather name={row.icon} size={17} color={palette.blue} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {row.meta}
                  </Text>
                  {row.chips.length > 0 && (
                    <View style={styles.chips}>
                      {row.chips.map((c) => (
                        <View key={c} style={styles.chip}>
                          <Text style={styles.chipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <Feather name="chevron-right" size={18} color={palette.checkOff} />
              </Pressable>
            ))}
          </View>
        ))}

        {!loading && !error && filtered.length === 0 && (
          <Text style={styles.empty}>{filter === 'fav' ? t('history.favEmpty') : t('history.empty')}</Text>
        )}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '800', color: palette.text, letterSpacing: -0.3 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 130 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontWeight: '800', color: palette.text },
  statLabel: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  statDivider: { width: 1, height: 28, backgroundColor: palette.borderSoft },
  filters: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 6 },
  filterChip: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  filterChipOn: { backgroundColor: palette.text, borderColor: palette.text },
  filterText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  filterTextOn: { color: '#FFFFFF' },
  center: { paddingVertical: 40, alignItems: 'center' },
  error: { color: palette.danger, textAlign: 'center', paddingVertical: 10 },
  empty: { color: palette.textDim, textAlign: 'center', marginTop: 48, fontSize: 15, lineHeight: 24 },
  monthHeader: { fontSize: 14, fontWeight: '800', color: palette.textFaint, marginTop: 18, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  rowMeta: { fontSize: 12.5, color: palette.textFaint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  chip: { borderRadius: 9999, backgroundColor: palette.bgSoft, paddingVertical: 3, paddingHorizontal: 9 },
  chipText: { fontSize: 11.5, fontWeight: '700', color: palette.textMuted },
});
