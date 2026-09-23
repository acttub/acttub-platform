import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api, type ReportRecord } from '@/lib/api';
import { buildWeekActivity } from '@/lib/practice-activity';
import { rememberPracticeDays } from '@/lib/practice-days';
import { dismissFeedbackNudge, feedbackNudgeVisible, maybeRequestStoreReview } from '@/lib/feedback-prompts';
import { useFeedbackSheet } from '@/hooks/use-feedback-sheet';
import { hasSeenSpotlight, markSpotlightSeen } from '@/lib/guide-state';
import { sortReportsNewestFirst } from '@/lib/report-order';
import {
  localDate,
  upcomingNotices,
  type AdmissionsResponse,
} from '@/lib/admissions';
import { useRequireLogin } from '@/hooks/use-require-login';
import { dateLocale, isKorean, translate as t } from '@/lib/i18n';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { StreakCelebration } from '@/components/streak-badge';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { TARGET } from '@/lib/spotlight-targets';
import {
  readLastSeenStreak,
  shouldCelebrateStreak,
  writeLastSeenStreak,
} from '@/lib/streak-celebration';

const PREVIEW_COUNT = 3;
const MASCOT = require('@/assets/images/mascot-home.png');
/** 연속 연습 스트립의 주황(pen). 팔레트의 amber는 글자용이라 따로 둔다. */
const STREAK_ORANGE = '#E9A23B';

/** 홈에서 처음 한 번 비추는 자리 — 연습을 시작하는 배너, 그리고 바로 찍는 버튼 (SOMA-550). */
const HOME_STEPS: SpotlightStep[] = [
  { target: TARGET.homeStart, text: 'guide.spotHomeStart' },
  { target: TARGET.shoot, text: 'guide.spotShoot', round: true },
];

function recentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/** A1. 홈 — 히어로(마스코트) + 지금 바로 연습 + 연속 연습 + 최근 연습 + 입시 마감. */
export default function HomeScreen() {
  const router = useRouter();
  const { isGuest, requireLogin, element: loginGuard } = useRequireLogin();
  const [records, setRecords] = useState<ReportRecord[]>([]);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다).
  const [activityDays, setActivityDays] = useState<{ created_at: string }[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
  // 연습 3회 뒤 한 번 뜨는 의견 넛지 / 5회 뒤 한 번 스토어 평점(feedback-prompts).
  const [nudge, setNudge] = useState(false);
  const feedback = useFeedbackSheet('home');
  // 처음 한 번만 가이드 — 누를 자리를 비춰 준다. 설정의 "가이드 다시 보기"로 되살릴 수 있다.
  const [guideOpen, setGuideOpen] = useState(false);
  const startTarget = useSpotlightTarget(TARGET.homeStart);

  useFocusEffect(
    useCallback(() => {
      // 올 때마다 본 적 있는지 묻는다(기기에서 읽는 값이라 싸다). 한 번만 묻고 말면,
      // 설정에서 되살린 뒤 앱을 껐다 켜야 보인다 — 실기기에서 그렇게 걸렸다.
      void hasSeenSpotlight('home').then((seen) => {
        if (!seen) setGuideOpen(true);
      });
      let cancelled = false;
      // 둘러보는 중엔 계정이 없다 — 보호된 요청은 401 이라 부르지 않는다 (SOMA-544).
      if (isGuest) return;
      api
        .reportHistory()
        .then((r) => {
          if (cancelled) return;
          setRecords(sortReportsNewestFirst(r.reports));
          void rememberPracticeDays(r.reports).then((days) => !cancelled && setActivityDays(days));
          void feedbackNudgeVisible(r.reports.length).then((v) => !cancelled && setNudge(v));
          void maybeRequestStoreReview(r.reports.length);
        })
        .catch(() => {
          if (!cancelled) {
            setRecords([]);
            void rememberPracticeDays([]).then((days) => !cancelled && setActivityDays(days));
          }
        });
      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  useEffect(() => {
    // 입시는 로그인과 무관하고 배포 때만 바뀐다 — 포커스마다 다시 읽지 않는다.
    // 한국어를 안 쓰는 사람에겐 보여줄 자리가 없으니 받아오지도 않는다 (SOMA-544).
    if (!isKorean()) return;
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

  // 연기 입시는 한국 대학 일정이라 한국어로 쓰는 사람에게만 쓸모가 있다 (SOMA-544).
  const deadlines = useMemo(
    () => (admissions && isKorean() ? upcomingNotices(admissions, localDate(), 2) : []),
    [admissions],
  );

  const { days, streak } = useMemo(() => buildWeekActivity(activityDays), [activityDays]);

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
          ref={startTarget.ref}
          onLayout={startTarget.onLayout}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('home.startA11y')}
          onPress={() => requireLogin(() => router.push('/upload'))}>
          <View style={styles.ctaPlay}>
            <Feather name="play" size={18} color={palette.blue} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.ctaTitle}>{t('home.ctaTitle')}</Text>
            <Text style={styles.ctaSub}>{t('home.ctaSub')}</Text>
          </View>
          <Feather name="chevron-right" size={22} color="rgba(255,255,255,0.9)" />
        </Pressable>

        {/* 연속 연습 — 이번 주(월~일). pen: 불꽃 + 라벨, 연습한 날은 주황 원, 나머지는 테두리 원. */}
        <View style={styles.streakCard}>
          <View style={styles.streakTop}>
            <Ionicons name="flame-outline" size={22} color={STREAK_ORANGE} />
            <Text style={styles.streakLabel}>{t('home.streakCount', { days: streak })}</Text>
          </View>
          <View style={styles.week}>
            {days.map((day) => {
              const active = !day.isFuture && day.count > 0;
              return (
                <View
                  key={day.key}
                  style={[styles.dayCell, active ? styles.dayOn : styles.dayOff]}
                  accessibilityLabel={t('home.dayA11y', { day: day.label, count: day.count })}>
                  <Text style={[styles.dayLabel, active ? styles.dayLabelOn : styles.dayLabelOff]}>
                    {day.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 의견 넛지 — 연습 3회 뒤 한 번. 닫든 남기든 다시 안 뜬다. */}
        {nudge && (
          <View style={styles.nudge}>
            <View style={styles.flex}>
              <Text style={styles.nudgeTitle}>{t('home.feedbackNudgeTitle')}</Text>
              <Text style={styles.nudgeBody}>{t('home.feedbackNudgeBody')}</Text>
            </View>
            <Pressable
              style={styles.nudgeCta}
              onPress={() => {
                setNudge(false);
                void dismissFeedbackNudge();
                feedback.open();
              }}
              accessibilityRole="button">
              <Text style={styles.nudgeCtaText}>{t('home.feedbackNudgeCta')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setNudge(false);
                void dismissFeedbackNudge();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}>
              <Feather name="x" size={18} color={palette.textFaint} />
            </Pressable>
          </View>
        )}

        {/* 최근 연습 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.recentTitle')}</Text>
          {/* 기록이 없어도 늘 보인다 — 전체 보기(A1.1)엔 대본 리딩 녹음도 함께 쌓인다. */}
          <Pressable onPress={() => router.push('/history')}>
            <Text style={styles.sectionLink}>{t('common.viewAll')} ›</Text>
          </Pressable>
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
      {feedback.element}
      {loginGuard}
      <SpotlightGuide
        visible={guideOpen}
        topic="home"
        steps={HOME_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('home');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  container: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 140 },
  flex: { flex: 1 },

  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 12 },
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
  streakTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  streakLabel: { fontSize: 16, fontWeight: '800', color: palette.text },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: STREAK_ORANGE },
  dayOff: { borderWidth: 1.5, borderColor: palette.border },
  dayLabel: { fontSize: 13, fontWeight: '700' },
  dayLabelOn: { color: '#FFFFFF' },
  dayLabelOff: { color: palette.textFaint },

  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.blueSoft,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  nudgeTitle: { fontSize: 14, fontWeight: '800', color: palette.blueDeep },
  nudgeBody: { fontSize: 12, color: palette.textDim, marginTop: 2 },
  nudgeCta: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  nudgeCtaText: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },
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
