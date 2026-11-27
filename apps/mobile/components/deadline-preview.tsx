import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { upcomingNotices, type AdmissionsResponse } from '@/lib/admissions';
import { api } from '@/lib/api';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { useAuth } from '@/lib/auth';
import { homeDeadlineSections } from '@/lib/home-sections';
import { isKorean, translate as t } from '@/lib/i18n';
import { afterHomeReady } from '@/lib/launch-splash';

type DeadlineBlock = {
  key: 'admissions' | 'auditions';
  title: string;
  a11y: string;
  route: '/admissions' | '/auditions';
  rows: { id: string; days: number; title: string; sub: string }[];
};

/**
 * 「오디션·입시」 입구(SOMA-1121 — 예전 홈의 마감 임박 구역, pen P1.1·P1.3). 커뮤니티 탭 맨 위에 둔다.
 * 입시생(만 19세 이하)은 입시만, 만 20세 이상 입시생은 둘 다, 나머지는 오디션만 본다(homeDeadlineSections, SOMA-654).
 * 구역마다 가까운 마감 몇 줄과 「전체 보기」 → 오디션 모아보기·입시 일정. 공고가 없거나 못 받으면 구역째 그리지 않는다.
 * 한국어를 안 쓰는 사람에겐 보여 줄 공고가 없으니 받아 오지도 않는다(SOMA-544). 처음 보일 때 살짝 떠오른다(동작 줄이기면 없이).
 */
export function DeadlinePreview() {
  const router = useRouter();
  const { profile } = useAuth();
  const reduceMotion = useReducedMotion();
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const sections = homeDeadlineSections(profile.me?.profile, kstDate());
  const korean = isKorean();
  const wantsAuditions = korean && sections.auditions;
  const wantsAdmissions = korean && sections.admissions;

  // 오디션 공고는 하루 두 번 바뀐다 — 탭을 만들 때 한 번만 읽고, 앱을 켤 때 필요한 기록을 다 받은 뒤에 부른다(lib/launch-splash).
  useEffect(() => {
    if (!wantsAuditions) return;
    let cancelled = false;
    afterHomeReady()
      .then(() => (cancelled ? null : api.auditions()))
      .then((data) => {
        if (data !== null && !cancelled) setAuditions(data);
      })
      .catch(() => {
        if (!cancelled) setAuditions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsAuditions]);

  // 연기 입시 일정 — 입시생일 때만 읽는다(SOMA-654). 실패하면 구역만 빠진다.
  useEffect(() => {
    if (!wantsAdmissions) return;
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
  }, [wantsAdmissions]);

  const today = kstDate();
  // 한 구역만 보이면 세 줄, 둘 다면 두 줄씩.
  const perBlock = wantsAuditions && wantsAdmissions ? 2 : 3;
  const blocks: DeadlineBlock[] = [];
  if (wantsAdmissions && admissions) {
    const rows = upcomingNotices(admissions, today, perBlock).map(({ university, notice, remaining }) => ({
      id: notice.id,
      days: remaining.days,
      title: university.name,
      sub: [notice.department, notice.practical_date ? t('home.admissionPractical', { date: monthDay(notice.practical_date) }) : remaining.label]
        .filter(Boolean)
        .join(' · '),
    }));
    if (rows.length > 0) blocks.push({ key: 'admissions', title: t('home.admissionsTitle'), a11y: t('home.admissionsA11y'), route: '/admissions', rows });
  }
  if (wantsAuditions && auditions) {
    const rows = urgentAuditions(auditions.items, today, perBlock).map(({ posting, days }) => ({
      id: posting.id,
      days,
      title: posting.title,
      sub: posting.source_name,
    }));
    if (rows.length > 0) blocks.push({ key: 'auditions', title: t('home.auditionsTitle'), a11y: t('home.auditionsA11y'), route: '/auditions', rows });
  }
  if (blocks.length === 0) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(motion.standard).easing(easing.enter)}
      style={styles.wrap}
      testID="deadline-preview">
      {blocks.map((block) => (
        <View key={block.key} style={styles.block}>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">{block.title}</Text>
            <Pressable onPress={() => router.push(block.route)} hitSlop={8} accessibilityRole="link" accessibilityLabel={block.a11y} ph-label={`community_${block.key}_all`}>
              <Text style={styles.all}>{t('home.seeAll')}</Text>
            </Pressable>
          </View>
          <View style={styles.list}>
            {block.rows.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => router.push(block.route)}
                accessibilityRole="button"
                ph-label={`community_${block.key}_row`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={[styles.dday, ddayTone(row.days).box]}>
                  <Text style={[styles.ddayText, ddayTone(row.days).text]}>D-{row.days === 0 ? 'DAY' : row.days}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{row.title}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>{row.sub}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={palette.iconFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** D-day 배지 — 3일 안은 danger, 그 밖은 파랑. 한 화면에 상태색은 하나만 쓴다. */
function ddayTone(days: number): { box: { backgroundColor: string }; text: { color: string } } {
  if (days <= 3) return { box: { backgroundColor: palette.dangerSoft }, text: { color: palette.danger } };
  return { box: { backgroundColor: palette.blueSoft }, text: { color: palette.blueDeep } };
}

/** 2026-10-26 → 10월 26일. */
function monthDay(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? t('home.monthDay', { m: Number(m[1]), d: Number(m[2]) }) : date;
}

const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  block: { gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.headline, color: palette.text },
  all: { ...type.body2Bold, color: palette.blueDeep },
  list: { gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  rowTitle: { ...type.body1Bold, color: palette.text },
  rowMeta: { marginTop: space[1] / 2, ...type.caption, color: palette.textMeta },
  dday: { minWidth: 52, height: 24, paddingHorizontal: space[2], borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  ddayText: type.micro,
});
