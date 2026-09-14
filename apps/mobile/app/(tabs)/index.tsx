import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { weekColors, palette } from '@/constants/palette';
import { api, type ReportRecord } from '@/lib/api';
import { buildWeekActivity, weekColorStep } from '@/lib/practice-activity';
import { sortReportsNewestFirst } from '@/lib/report-order';
import {
  localDate,
  upcomingNotices,
  type AdmissionsResponse,
} from '@/lib/admissions';
import { translate as t } from '@/lib/i18n';
import { StreakCelebration } from '@/components/streak-badge';
import {
  readLastSeenStreak,
  shouldCelebrateStreak,
  writeLastSeenStreak,
} from '@/lib/streak-celebration';

const PREVIEW_COUNT = 3;
const MASCOT = require('@/assets/images/mascot-home.png');

function recentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

/** A1. 홈 — 히어로(마스코트) + 지금 바로 연습 + 연속 연습 + 최근 연습 + 입시 마감. */
export default function HomeScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .reportHistory()
        .then((r) => {
          if (cancelled) return;
          setRecords(sortReportsNewestFirst(r.reports));
        })
        .catch(() => {
          if (!cancelled) setRecords([]);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    // 입시는 로그인과 무관하고 배포 때만 바뀐다 — 포커스마다 다시 읽지 않는다.
    let cancelled = false;
    api
      .admissions()
      .then((data) => {
        if (!cancelled) setAdmissions(data);
      })
      .catch(() => {
        if (!cancelled) setAdmissions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deadlines = useMemo(
    () => (admissions ? upcomingNotices(admissions, localDate(), 2) : []),
    [admissions],
  );

  const { days, streak } = useMemo(() => buildWeekActivity(records), [records]);

  // 연속일이 오늘 늘었으면(마지막으로 본 값보다 크면) 딱 한 번 축하한다 (SOMA-479).
  useEffect(() => {
    let cancelled = false;
    void readLastSeenStreak().then((lastSeen) => {
      if (cancelled) return;
      if (shouldCelebrateStreak(lastSeen, streak)) setCelebrateStreak(streak);
      void writeLastSeenStreak(streak);
    });
    return () => {
      cancelled = true;
    };
  }, [streak]);

  const recent = records.slice(0, PREVIEW_COUNT);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {celebrateStreak !== null && (
        <StreakCelebration streak={celebrateStreak} onDone={() => setCelebrateStreak(null)} />
      )}
      <ScrollView contentContainerStyle={styles.container}>
        {/* 히어로 — 큰 격려 문구 + 마스코트 */}
        <View style={styles.hero}>
          <View style={styles.flex}>
            <Text style={styles.heroTitle}>{t('home.heroTitle')}</Text>
            <Text style={styles.heroSub}>{t('home.heroSub')}</Text>
          </View>
          <View style={styles.mascotCol}>
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{t('home.mascotBubble')}</Text>
            </View>
            <Image source={MASCOT} style={styles.mascot} resizeMode="contain" />
          </View>
        </View>

        {/* 지금 바로 연습하기 — 배너 전체가 버튼 */}
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('home.startA11y')}
          onPress={() => router.push('/upload')}>
          <View style={styles.ctaPlay}>
            <Feather name="play" size={18} color={palette.blue} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.ctaTitle}>{t('home.ctaTitle')}</Text>
            <Text style={styles.ctaSub}>{t('home.ctaSub')}</Text>
          </View>
          <Feather name="chevron-right" size={22} color="rgba(255,255,255,0.9)" />
        </Pressable>

        {/* 연속 연습 — 이번 주(월~일) */}
        <View style={styles.streakCard}>
          <View style={styles.streakTop}>
            <View style={styles.streakLeft}>
              <Text style={styles.flame}>🔥</Text>
              <Text style={styles.streakLabel}>{t('home.streakCount', { days: streak })}</Text>
            </View>
            <View style={styles.legend}>
              <Text style={styles.legendLabel}>{t('home.legendLow')}</Text>
              {weekColors.map((color) => (
                <View key={color} style={[styles.legendDot, { backgroundColor: color }]} />
              ))}
              <Text style={styles.legendLabel}>{t('home.legendHigh')}</Text>
            </View>
          </View>
          <View style={styles.week}>
            {days.map((day) => {
              const active = !day.isFuture && day.count > 0;
              return (
                <View
                  key={day.key}
                  style={[
                    styles.dayCell,
                    day.isFuture
                      ? styles.dayFuture
                      : { backgroundColor: active ? weekColors[weekColorStep(day.count)] : palette.bgSoft },
                    day.isToday && styles.dayToday,
                  ]}
                  accessibilityLabel={t('home.dayA11y', { day: day.label, count: day.count })}>
                  <Text
                    style={[
                      styles.dayLabel,
                      { color: active ? '#FFFFFF' : palette.textFaint },
                      day.isToday && !active && styles.dayLabelToday,
                    ]}>
                    {day.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 최근 연습 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.recentTitle')}</Text>
          {records.length > 0 && (
            <Pressable onPress={() => router.push('/history')}>
              <Text style={styles.sectionLink}>{t('common.viewAll')} ›</Text>
            </Pressable>
          )}
        </View>
        {recent.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t('home.empty')}</Text>
          </View>
        ) : (
          <View style={styles.recentList}>
            {recent.map((r) => (
              <Pressable
                key={r.practice_session_id + r.created_at}
                style={({ pressed }) => [styles.recentRow, pressed && styles.recentRowPressed]}
                onPress={() =>
                  router.push({
                    pathname: '/report-detail',
                    params: { practiceSessionId: r.practice_session_id },
                  })
                }>
                <View style={styles.recentIcon}>
                  <Feather name="film" size={17} color={palette.blue} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.recentTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={styles.recentMeta}>
                    <View style={styles.recentDot} />
                    <Text style={styles.recentMetaText}>{recentDate(r.created_at)}</Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={16} color={palette.checkOff} />
              </Pressable>
            ))}
          </View>
        )}

        {/* 입시 마감 — 실기 일정은 놓치면 1년을 기다린다. 임박한 둘만 띄운다. */}
        {deadlines.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('home.admissionsTitle')}</Text>
              <Pressable onPress={() => router.push('/admissions')}>
                <Text style={styles.sectionLink}>{t('common.viewAll')} ›</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.admissionCard}
              accessibilityRole="button"
              accessibilityLabel={t('home.admissionsA11y')}
              onPress={() => router.push('/admissions')}>
              {deadlines.map(({ university, notice, remaining }, index) => (
                <View
                  key={notice.id}
                  style={[styles.admissionRow, index > 0 && styles.admissionRowNext]}>
                  <View style={styles.admissionDday}>
                    <Text style={styles.admissionDdayText}>
                      D-{remaining.days === 0 ? 'DAY' : remaining.days}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.admissionUni}>{university.name}</Text>
                    <Text style={styles.admissionDept} numberOfLines={1}>
                      {notice.department ?? ''}
                    </Text>
                  </View>
                  <Text style={styles.admissionLabel}>{remaining.label}</Text>
                </View>
              ))}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  container: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 140 },
  flex: { flex: 1 },

  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 8 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: palette.text, lineHeight: 34 },
  heroSub: { fontSize: 13, fontWeight: '600', color: palette.textDim, lineHeight: 20, marginTop: 12 },
  mascotCol: { width: 118, alignItems: 'center', gap: 4 },
  bubble: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleText: { fontSize: 11.5, fontWeight: '700', color: palette.textDim, textAlign: 'center', lineHeight: 16 },
  mascot: { width: 96, height: 108 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.blue,
    borderRadius: 18,
    padding: 16,
    marginTop: 20,
  },
  ctaPressed: { opacity: 0.9 },
  ctaPlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  ctaSub: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginTop: 3 },

  streakCard: {
    backgroundColor: palette.card,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    shadowColor: '#191F28',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  streakTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flame: { fontSize: 18 },
  streakLabel: { fontSize: 14, fontWeight: '800', color: palette.text },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLabel: { fontSize: 10, color: palette.textFaint, marginHorizontal: 2 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  week: { flexDirection: 'row', gap: 6 },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayFuture: { borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed' },
  dayToday: { borderWidth: 2, borderColor: palette.blue },
  dayLabel: { fontSize: 12, fontWeight: '700' },
  dayLabelToday: { color: palette.blue },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  sectionLink: { fontSize: 13, fontWeight: '600', color: palette.blue },

  recentList: { gap: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  recentRowPressed: { opacity: 0.85 },
  recentIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  recentDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue },
  recentMetaText: { fontSize: 12, fontWeight: '500', color: palette.textFaint },

  emptyCard: { backgroundColor: palette.bgSoft, borderRadius: 16, padding: 20 },
  emptyText: { fontSize: 13, color: palette.textDim, lineHeight: 20, textAlign: 'center' },

  admissionCard: {
    backgroundColor: palette.card,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 6,
    shadowColor: '#191F28',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  admissionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  admissionRowNext: { borderTopWidth: 1, borderTopColor: palette.border },
  admissionDday: {
    minWidth: 54,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  admissionDdayText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  admissionUni: { fontSize: 15, fontWeight: '700', color: palette.text },
  admissionDept: { marginTop: 4, fontSize: 12, fontWeight: '500', color: palette.textFaint, lineHeight: 17 },
  admissionLabel: { fontSize: 11, fontWeight: '700', color: palette.textFaint },
});
