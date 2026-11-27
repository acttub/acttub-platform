import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { SkeletonBlock } from '@/components/ui/skeleton';
import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import { practiceFillPercent } from '@/lib/practice-activity';

/** 날마다 차오르기 시작을 이만큼 늦춘다 — 왼쪽(옛날)부터 오늘 쪽으로 차례로 찬다. */
const DAY_STAGGER_MS = 40;

export type WeekDay = { key: string; label: string; isToday: boolean; count: number };

/**
 * 「이번 주 연습」 카드(예전 홈 히어로 아래, SOMA-1120에서 프로필로 옮김). 오늘이 맨 오른쪽인 최근 7일 원과
 * 「이번 주 N일 · 누적 M일」 알약. 연습한 날은 회색 원 안에 아래에서부터 파랑이 그날 횟수만큼 차오르고 가운데에 횟수를 보인다.
 *
 * 차오름은 카드가 보일 때 0에서 목표 높이까지 짧게(약 400ms, 날마다 조금씩 늦게) 움직인다. 「동작 줄이기」면 바로 끝 높이다.
 * `loading`이면 원 자리만 회색 뼈대로 둔다.
 */
export function WeekPracticeCard({
  days,
  practicedDays,
  totalDays,
  loading,
}: {
  days: readonly WeekDay[];
  practicedDays: number;
  totalDays: number;
  loading: boolean;
}) {
  return (
    <View style={styles.card} testID="home-week">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('home.weekTitle')}</Text>
        {/* 「이번 주 3일 · 누적 12일」 — 이번 주는 아래 7칸 중 연습한 날, 누적은 연속이 끊겨도 줄지 않는다(SOMA-1003). */}
        {!loading && totalDays > 0 && (
          <View
            style={styles.pill}
            testID="home-days-summary"
            accessible
            accessibilityLabel={t('home.weekSummaryA11y', { n: practicedDays, total: totalDays })}>
            <Text style={styles.pillText}>{t('home.weekSummary', { n: practicedDays, total: totalDays })}</Text>
          </View>
        )}
      </View>
      <View style={styles.week}>
        {days.map((d, i) => {
          const dayName = d.isToday ? t('home.today') : d.label;
          return (
            <View key={d.key} style={styles.col}>
              {loading ? (
                <SkeletonBlock width={36} height={36} radius={radius.full} />
              ) : (
                <View
                  testID={d.count > 0 ? 'home-week-done' : d.isToday ? 'home-week-today' : 'home-week-empty'}
                  accessible
                  accessibilityLabel={d.count > 0 ? t('home.weekDayA11y', { day: dayName, n: d.count }) : t('home.weekDayEmptyA11y', { day: dayName })}
                  style={[styles.dot, d.count === 0 && d.isToday && styles.dotToday]}>
                  {d.count > 0 && <DayFill count={d.count} delay={i * DAY_STAGGER_MS} />}
                </View>
              )}
              <Text style={[styles.label, d.isToday && styles.labelToday]}>{dayName}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** 원 안의 파란 차오름과 그날 횟수. */
function DayFill({ count, delay }: { count: number; delay: number }) {
  const fill = practiceFillPercent(count);
  const reduceMotion = useReducedMotion();
  const height = useSharedValue(reduceMotion ? fill : 0);
  useEffect(() => {
    height.value = reduceMotion ? fill : withDelay(delay, withTiming(fill, { duration: motion.slow, easing: easing.enter }));
  }, [fill, delay, reduceMotion, height]);
  const fillStyle = useAnimatedStyle(() => ({ height: `${height.value}%` }));
  return (
    <>
      <Animated.View testID="week-fill" style={[styles.fill, fillStyle]} />
      <Text style={[styles.count, fill >= 80 && styles.countOnFill]}>{count}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space[4],
    gap: space[3],
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.headline, color: palette.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  pillText: { ...type.captionBold, color: palette.text },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  col: { alignItems: 'center', gap: space[1.5], width: 40 },
  dot: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: palette.blue },
  count: { ...type.captionBold, color: palette.text },
  countOnFill: { color: palette.onAccent },
  dotToday: { backgroundColor: palette.bg, borderWidth: 1.5, borderColor: palette.blue },
  label: { ...type.micro, color: palette.textMeta },
  labelToday: { color: palette.text },
});
