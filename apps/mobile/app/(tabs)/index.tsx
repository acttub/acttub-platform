import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { weekColors, palette } from '@/constants/palette';
import { api, type ReportRecord } from '@/lib/api';
import { RecordCard, type RecordMeta } from '@/components/record-card';
import { buildWeekActivity, weekColorStep } from '@/lib/practice-activity';
import { loadRecordMeta } from '@/lib/record-meta';
import { displayNameFor } from '@/lib/display-name';
import { useAuth } from '@/lib/auth';
import { getUserName } from '@/lib/profile';
import { sortReportsNewestFirst } from '@/lib/report-order';

const PREVIEW_COUNT = 2;

/** A1. 홈 — 인사말 + AI 코치 카드(=연습 시작) + 이번 주 연습 활동 + 최근 연습. */
export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [meta, setMeta] = useState<Record<string, RecordMeta>>({});
  const [savedName, setSavedName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .reportHistory()
        .then(async (r) => {
          const sorted = sortReportsNewestFirst(r.reports);
          if (cancelled) return;
          setRecords(sorted);
          // 미리보기로 보여줄 카드만 상세를 불러 칩(진단 축·구간)을 채운다.
          const loaded = await loadRecordMeta(
            sorted.slice(0, PREVIEW_COUNT).map((item) => item.practice_session_id),
            (id) => api.getReport(id),
          );
          if (!cancelled) setMeta(loaded);
        })
        .catch(() => {
          if (!cancelled) setRecords([]);
        });
      // 설정에서 이름을 바꿀 수 있으니 화면에 돌아올 때마다 다시 읽는다.
      void getUserName().then((stored) => {
        if (!cancelled) setSavedName(stored?.trim() || null);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const { days, weekTotal, streak } = useMemo(() => buildWeekActivity(records), [records]);
  const total = records.length;

  const latest = records[0];
  const recent = records.slice(0, PREVIEW_COUNT);
  const name = displayNameFor(savedName, user?.email ?? null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.helloRow}>
          <View style={styles.flex}>
            <Text style={styles.hello}>{name ? `${name}님, 안녕하세요 👋` : '안녕하세요 👋'}</Text>
            <Text style={styles.helloSub}>오늘은 어떤 장면을 연습할까요?</Text>
          </View>
        </View>

        {/* AI 코치 카드 — 카드 전체가 '연습 시작' 버튼이다(안에 버튼을 또 두지 않는다). */}
        <Pressable
          style={({ pressed }) => [styles.coachCard, pressed && styles.coachCardPressed]}
          accessibilityRole="button"
          accessibilityLabel="연습 시작"
          onPress={() => router.push('/upload')}>
          <Text style={styles.coachLabel}>AI 코치</Text>
          <Text style={styles.coachHeadline}>
            {latest
              ? '지난 피드백을 이어 연습해 볼까요?'
              : '영상을 올리면 원인과 처방을 돌려드려요'}
          </Text>
          <Text style={styles.coachBody} numberOfLines={2}>
            {latest
              ? latest.headline
              : '점수 대신, 의도가 왜 안 닿았는지와 당장 해볼 처방 하나.'}
          </Text>
          <Text style={styles.coachCtaText}>연습 시작 →</Text>
        </Pressable>

        {/* 연습 활동 — 이번 주(월~일) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>연습 활동</Text>
          <Text style={styles.sectionMeta}>이번 주 · {weekTotal}회</Text>
        </View>
        <View style={styles.activityCard}>
          <View style={styles.week}>
            {days.map((day) => (
              <View key={day.key} style={styles.weekDay}>
                <View
                  style={[
                    styles.weekCell,
                    {
                      backgroundColor: day.isFuture
                        ? 'transparent'
                        : weekColors[weekColorStep(day.count)],
                    },
                    day.isFuture && styles.weekCellFuture,
                    day.isToday && styles.weekCellToday,
                  ]}
                  accessibilityLabel={`${day.label}요일 ${day.count}회`}
                />
                <Text style={[styles.weekLabel, day.isToday && styles.weekLabelToday]}>
                  {day.label}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.activityFooter}>
            {streak >= 1 ? (
              <View style={styles.streakChip}>
                <Text style={styles.streak}>🔥 {streak}일 연속</Text>
              </View>
            ) : (
              <Text style={styles.streakEmpty}>
                {total ? '꾸준함이 쌓이는 중이에요' : '첫 연습이 여기에 쌓여요'}
              </Text>
            )}
            <View style={styles.legend}>
              <Text style={styles.legendLabel}>적음</Text>
              {weekColors.slice(1).map((color) => (
                <View key={color} style={[styles.legendSwatch, { backgroundColor: color }]} />
              ))}
              <Text style={styles.legendLabel}>많음</Text>
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
              key={r.practice_session_id + r.created_at}
              item={r}
              meta={meta[r.practice_session_id]}
              preview
              onPress={() =>
                router.push({
                  pathname: '/report-detail',
                  params: { practiceSessionId: r.practice_session_id },
                })
              }
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
  hello: { fontSize: 14, color: palette.textDim, marginTop: 8 },
  helloSub: { fontSize: 22, fontWeight: '800', color: palette.text, marginTop: 2 },
  coachCard: {
    backgroundColor: palette.navy,
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
  },
  coachCardPressed: { opacity: 0.85 },
  coachLabel: { fontSize: 12, fontWeight: '700', color: '#8FA5FF', marginBottom: 8 },
  coachHeadline: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26 },
  coachBody: { fontSize: 13, color: '#9FB0C9', lineHeight: 19, marginTop: 8 },
  coachCtaText: { color: '#8FA5FF', fontSize: 14, fontWeight: '800', marginTop: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  sectionMeta: { fontSize: 12, color: palette.textFaint },
  sectionLink: { fontSize: 13, fontWeight: '600', color: palette.blue },
  activityCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 12,
  },
  week: { flexDirection: 'row', gap: 5 },
  weekDay: { flex: 1, alignItems: 'center', gap: 4 },
  weekCell: {
    width: '100%',
    aspectRatio: 1, // 요일 칸은 정사각형
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekCellFuture: { borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed' },
  weekCellToday: { borderWidth: 2, borderColor: palette.blue },
  weekLabel: { fontSize: 11, color: palette.textFaint },
  weekLabelToday: { color: palette.blue, fontWeight: '800' },
  activityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLabel: { fontSize: 10, color: palette.textFaint, marginHorizontal: 2 },
  legendSwatch: { width: 12, height: 12, borderRadius: 4 },
  streakChip: {
    backgroundColor: palette.amberSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  streak: { fontSize: 12, fontWeight: '800', color: '#B45309' },
  streakEmpty: { fontSize: 12, color: palette.textFaint },
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
});
