import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { heatColors, palette } from '@/constants/palette';
import { api, type ReportRecord } from '@/lib/api';
import { RecordCard, type RecordMeta } from '@/components/record-card';
import { setSelectedReport } from '@/lib/selected-report';

const WEEKS = 12;
const DAY = 24 * 60 * 60 * 1000;

/** 로컬 자정 기준 날짜 키 (YYYY-MM-DD). */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** A1. 홈 — 인사말 + AI 코치 카드 + 연습 활동(히트맵·스탯) + 최근 연습. */
export default function HomeScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [meta, setMeta] = useState<Record<string, RecordMeta>>({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .reportHistory()
        .then(async (r) => {
          if (cancelled) return;
          setRecords(r.reports);
          // '최근 연습' 카드 태그칩용으로 상위 2개만 상세를 불러온다.
          const entries = await Promise.all(
            r.reports.slice(0, 2).map(async (rec) => {
              try {
                const d = await api.reportDetail(rec.practice_session_id);
                const bp = d.report?.biggest_problem;
                return [
                  rec.practice_session_id,
                  { dimension: bp?.dimension ?? '', start: bp?.start ?? '', end: bp?.end ?? '' },
                ] as const;
              } catch {
                return [rec.practice_session_id, { dimension: '', start: '', end: '' }] as const;
              }
            }),
          );
          if (!cancelled) setMeta(Object.fromEntries(entries));
        })
        .catch(() => {
          if (!cancelled) setRecords([]);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const { grid, streak, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const key = dayKey(new Date(r.created_at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // 이번 주(월요일 시작)의 월요일을 마지막 열로 두고 12주를 거슬러 올라간다.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
    const grid: number[][] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const col: number[] = [];
      for (let d = 0; d < 7; d++) {
        const cell = new Date(monday.getTime() - w * 7 * DAY + d * DAY);
        col.push(cell > today ? -1 : (counts.get(dayKey(cell)) ?? 0));
      }
      grid.push(col);
    }

    let streak = 0;
    for (let i = 0; ; i++) {
      const day = new Date(today.getTime() - i * DAY);
      if (counts.has(dayKey(day))) streak++;
      else if (i === 0) continue; // 오늘 아직 안 했어도 어제까지의 연속은 유지
      else break;
    }

    return { grid, streak, total: records.length };
  }, [records]);

  const latest = records[0];
  const recent = records.slice(0, 2);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.helloRow}>
          <View style={styles.flex}>
            <Text style={styles.hello}>안녕하세요 👋</Text>
            <Text style={styles.helloSub}>오늘은 어떤 장면을 연습할까요?</Text>
          </View>
          <Pressable hitSlop={8} onPress={() => router.push('/settings' as Href)}>
            <Text style={styles.logout}>설정</Text>
          </Pressable>
        </View>

        {/* AI 코치 카드 */}
        <View style={styles.coachCard}>
          <Text style={styles.coachLabel}>AI 코치</Text>
          <Text style={styles.coachHeadline}>
            {latest
              ? '지난 연습, 이어서 한 걸음 더 가볼까요?'
              : '영상을 올리면 원인과 처방을 돌려드려요'}
          </Text>
          <Text style={styles.coachBody} numberOfLines={2}>
            {latest
              ? latest.headline
              : '점수 대신, 의도가 왜 안 닿았는지와 당장 해볼 처방 하나.'}
          </Text>
          <Pressable style={styles.coachCta} onPress={() => router.push('/upload')}>
            <Text style={styles.coachCtaText}>연습 시작 →</Text>
          </Pressable>
        </View>

        {/* 연습 활동 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>연습 활동</Text>
          <Text style={styles.sectionMeta}>최근 {WEEKS}주 · {total}회</Text>
        </View>
        <View style={styles.activityCard}>
          <View style={styles.heatmap}>
            {grid.map((col, i) => (
              <View key={i} style={styles.heatCol}>
                {col.map((count, j) => (
                  <View
                    key={j}
                    style={[
                      styles.heatCell,
                      {
                        backgroundColor:
                          count < 0
                            ? 'transparent'
                            : heatColors[Math.min(count, heatColors.length - 1)],
                      },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
          <View style={styles.activityFooter}>
            {streak >= 2 ? (
              <Text style={styles.streak}>🔥 {streak}일 연속</Text>
            ) : (
              <Text style={styles.streakEmpty}>
                {total ? '꾸준함이 쌓이는 중이에요' : '첫 연습이 여기에 쌓여요'}
              </Text>
            )}
            <View style={styles.legend}>
              <Text style={styles.legendText}>적음</Text>
              {heatColors.map((c) => (
                <View key={c} style={[styles.legendCell, { backgroundColor: c }]} />
              ))}
              <Text style={styles.legendText}>많음</Text>
            </View>
          </View>
        </View>

        {/* 스탯 */}
        <View style={styles.statRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{total}</Text>
            <Text style={styles.statLabel}>연습</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{streak}</Text>
            <Text style={styles.statLabel}>연속일</Text>
          </View>
        </View>

        {/* 최근 연습 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>최근 연습</Text>
          {records.length > 0 && (
            <Pressable onPress={() => router.push('/history')}>
              <Text style={styles.sectionLink}>전체보기</Text>
            </Pressable>
          )}
        </View>
        {recent.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              아직 기록이 없어요.{'\n'}가운데 파란 버튼으로 첫 영상을 올려보세요.
            </Text>
          </View>
        ) : (
          recent.map((r) => (
            <RecordCard
              key={r.practice_session_id}
              item={r}
              meta={meta[r.practice_session_id]}
              preview
              onPress={() => {
                setSelectedReport(r);
                router.push('/report-detail' as Href);
              }}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  container: { padding: 20, paddingBottom: 130 },
  helloRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
  logout: { fontSize: 13, color: palette.textFaint, marginTop: 10, fontWeight: '600' },
  hello: { fontSize: 14, color: palette.textDim, marginTop: 8 },
  helloSub: { fontSize: 22, fontWeight: '800', color: palette.text, marginTop: 2 },
  coachCard: {
    backgroundColor: palette.navy,
    borderRadius: 20,
    padding: 20,
    marginTop: 20,
  },
  coachLabel: { fontSize: 12, fontWeight: '700', color: '#8FA5FF', marginBottom: 8 },
  coachHeadline: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26 },
  coachBody: { fontSize: 13, color: '#9FB0C9', lineHeight: 19, marginTop: 8 },
  coachCta: {
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
    marginTop: 16,
  },
  coachCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  sectionMeta: { fontSize: 12, color: palette.textFaint },
  sectionLink: { fontSize: 13, fontWeight: '600', color: palette.blue },
  activityCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 14,
  },
  heatmap: { flexDirection: 'row', justifyContent: 'space-between' },
  heatCol: { gap: 4 },
  heatCell: { width: 18, height: 18, borderRadius: 4 },
  activityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  streak: { fontSize: 12, fontWeight: '700', color: palette.text },
  streakEmpty: { fontSize: 12, color: palette.textFaint },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendCell: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 10, color: palette.textFaint, marginHorizontal: 3 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 10,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: palette.border },
  statValue: { fontSize: 18, fontWeight: '800', color: palette.blue },
  statLabel: { fontSize: 11, color: palette.textDim },
  emptyCard: {
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
    padding: 20,
  },
  emptyText: { fontSize: 13, color: palette.textDim, lineHeight: 20, textAlign: 'center' },
  recentCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  recentDate: { fontSize: 12, color: palette.textFaint, marginBottom: 4 },
  recentHeadline: { fontSize: 14, fontWeight: '700', color: palette.text, lineHeight: 20 },
});
