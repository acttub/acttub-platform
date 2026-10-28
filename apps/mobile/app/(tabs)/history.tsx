import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog } from '@/components/ds/app-dialog';
import { pt } from '@/components/ds/ui/anchored-menu';
import { Chip } from '@/components/ds/ui/chip';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavIconButton } from '@/components/ds/ui/nav-header';
import { SkeletonRows } from '@/components/ds/ui/skeleton';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { filterGroups, groupPoster, groupRowTarget, groupTitle } from '@/lib/practice/groups';
import type { PracticeGroup, PracticeGroupFilter } from '@/lib/practice/types';
import type { GestureResponderEvent } from 'react-native';

type Row = {
  id: string;
  /** 월별로 묶는 기준 — 묶음의 마지막 회차 시각. */
  at: string;
  title: string;
  /** 첫 장면 사진(SOMA-671). 없으면 원래 아이콘이다. */
  poster: { uri: string; cacheKey: string } | null;
  meta: string;
  /** 썸네일 오른쪽 아래 배지 — 묶음의 회차 수. */
  count: string;
  onPress: () => void;
  onMenu: (e?: GestureResponderEvent) => void;
  chips: string[];
  /** 열린 테이크가 있는 묶음 — 「대화 중」 배지를 붙이고 누르면 그 대화로 간다(SOMA-672). */
  talking: boolean;
};

/**
 * A1.1 연습 기록 — AI 코치와 한 연습 묶음의 목록.
 *
 * 기록은 묶음 단위다(practice.library). 묶음의 제목은 마지막 회차 노트의 제목이고, 없으면 상황
 * 문장, 그것도 없으면 "제목 없는 연습"이다. 필터는 전체·즐겨찾기·최근 30일이고 월별로 묶는다.
 * 숨김은 묶음 전체이며 노트·대화·기억은 지우지 않고 영상은 보관함에 남는다. 대본 리딩은 여기
 * 섞지 않는다 — 리딩 기록은 대본 탭의 대본 상세에서 본다(SOMA-494).
 */
export default function HistoryScreen() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  const [filter, setFilter] = useState<PracticeGroupFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, alert, sheet, dialog } = useAppDialog();

  const load = useCallback(async () => {
    setError(null);
    try {
      const groupList = await api.listPracticeGroups('all');
      setGroups(groupList.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('history.loadFail'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openGroup = (rootId: string) => router.push({ pathname: '/practice-group', params: { rootId } });

  /** 숨김은 묶음 전체이고 되돌릴 수 있다 — 노트·대화·기억은 그대로고 영상은 보관함에 남는다. */
  const hideGroup = async (group: PracticeGroup) => {
    const ok = await confirm({
      title: t('history.hideTitle'),
      message: t('history.hideNotice'),
      confirmLabel: t('history.hideConfirm'),
    });
    if (!ok) return;
    try {
      await api.patchPracticeGroup(group.root_id, { hidden: true });
      void load();
    } catch (e) {
      await alert({
        title: t('history.deleteFailTitle'),
        message: e instanceof Error ? e.message : t('history.deleteFail'),
      });
    }
  };

  const toggleFavorite = async (group: PracticeGroup) => {
    try {
      await api.patchPracticeGroup(group.root_id, { favorite: !group.favorite });
      void load();
    } catch {
      void load();
    }
  };

  const onGroupMenu = (group: PracticeGroup, e?: GestureResponderEvent) => {
    void sheet({
      anchor: pt(e),
      title: groupTitle(group),
      actions: [
        { label: t('history.fullView'), onPress: () => openGroup(group.root_id) },
        {
          label: group.favorite ? t('history.favOff') : t('history.favOn'),
          onPress: () => void toggleFavorite(group),
        },
        { label: t('history.menuHide'), onPress: () => void hideGroup(group) },
      ],
    });
  };

  const dayLabel = (iso: string) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });

  const rows = useMemo<Row[]>(() => {
    return filterGroups(groups, filter)
      .map<Row>((group) => ({
        id: `g:${group.root_id}`,
        at: group.last_practiced_at ?? '',
        title: groupTitle(group),
        poster: groupPoster(group),
        meta: dayLabel(group.last_practiced_at ?? ''),
        count: t('history.countTimes', { count: group.ordinal_count }),
        chips: group.tags ?? [],
        talking: Boolean(group.in_progress_practice_id),
        onPress: () => router.push(groupRowTarget(group)),
        onMenu: (e?: GestureResponderEvent) => onGroupMenu(group, e),
      }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filter]);

  // 월별 그룹 — 라벨은 "8월"처럼 짧게. 해가 바뀌면 연도를 붙인다.
  const monthGroups = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const out: { label: string; items: Row[] }[] = [];
    let cur: { label: string; items: Row[] } | null = null;
    for (const row of rows) {
      const d = new Date(row.at);
      const label = formatKoreanDate(
        row.at,
        d.getFullYear() === thisYear ? { month: 'long' } : { year: 'numeric', month: 'long' },
      );
      if (!cur || cur.label !== label) {
        cur = { label, items: [] };
        out.push(cur);
      }
      cur.items.push(row);
    }
    return out;
  }, [rows]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const roundTotal = groups.reduce((sum, g) => sum + g.ordinal_count, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 위쪽(제목·총 연습 요약)은 개편전, 아래 영상 목록은 개편후 모양(SOMA-923). */}
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')} ph-label="history_back">
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('history.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: tabBarSpace + space[5] }]}>
        <View style={styles.summary}>
          <Stat value={t('history.countTimes', { count: roundTotal })} label={t('history.statTotal')} />
          <View style={styles.statDivider} />
          <Stat value={t('history.countItems', { count: groups.length })} label={t('history.statLines')} />
        </View>

        <View style={styles.filters}>
          {(
            [
              ['all', 'history.filterAll'],
              ['favorite', 'history.filterFav'],
              ['recent30', 'history.filterRecent'],
            ] as const
          ).map(([key, label]) => (
            <Chip key={key} label={t(label)} selected={filter === key} role="radio" onPress={() => setFilter(key)} />
          ))}
        </View>

        <AdSlot slot="archive_top" />

        {loading && <SkeletonRows count={5} avatar card={false} />}
        {error && <InlineError message={error} onRetry={() => void load()} />}

        {monthGroups.map((group) => (
          <View key={group.label} style={styles.month}>
            <Text style={styles.monthHeader}>{group.label}</Text>
            {group.items.map((row) => (
              <Pressable
                key={row.id}
                style={styles.row}
                onPress={row.onPress}
                onLongPress={row.onMenu}
                accessibilityRole="button"
                accessibilityLabel={row.title}>
                {/* 영상 목록처럼 왼쪽에 큰 첫 장면 사진, 오른쪽 아래에 회차 수(SOMA-671). 사진이 없으면 아이콘. */}
                <View style={styles.thumb}>
                  {row.poster ? (
                    <Image source={{ uri: row.poster.uri, cacheKey: row.poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                  ) : (
                    <Feather name="video" size={22} color={palette.blue} />
                  )}
                  <View style={styles.thumbBadge}>
                    <Text style={styles.thumbBadgeText}>{row.count}</Text>
                  </View>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {row.meta}
                  </Text>
                  {row.talking && (
                    <View style={[styles.chip, styles.talkingChip]}>
                      <Text style={[styles.chipText, styles.talkingChipText]}>{t('history.inConversation')}</Text>
                    </View>
                  )}
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
                <View style={styles.more}>
                  <NavIconButton icon="more-horizontal" size={20} color={palette.iconFaint} label={t('history.groupMenu')} phLabel="history_group_menu" onPress={row.onMenu} />
                </View>
              </Pressable>
            ))}
          </View>
        ))}

        {!loading && !error && rows.length === 0 && (
          <InlineEmpty
            title={filter === 'favorite' ? t('history.favEmpty') : t('history.empty')}
            description={filter === 'favorite' ? t('history.favEmptyBody') : t('history.emptyBody')}
          />
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
  list: { paddingHorizontal: space.gutter, paddingTop: space[2], gap: space[4] },
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
  filters: { flexDirection: 'row', gap: space[2] },
  month: { gap: space[2] },
  monthHeader: { ...type.body2Bold, color: palette.textSub },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[2] },
  thumb: {
    width: '40%',
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbBadge: {
    position: 'absolute',
    right: space[1.5],
    bottom: space[1.5],
    borderRadius: radius.full,
    backgroundColor: palette.toast,
    paddingVertical: space[1] / 2,
    paddingHorizontal: space[2],
  },
  thumbBadgeText: { ...type.micro, color: palette.onAccent },
  rowBody: { flex: 1, gap: space[1] },
  rowTitle: { ...type.body1Bold, color: palette.text },
  rowMeta: { ...type.caption, color: palette.textMeta },
  more: { marginTop: -space[3], marginRight: -space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5], marginTop: space[1] },
  chip: { borderRadius: radius.full, backgroundColor: palette.bgSoft, paddingVertical: space[1] / 2, paddingHorizontal: space[2] },
  chipText: { ...type.micro, color: palette.textSub },
  talkingChip: { alignSelf: 'flex-start', backgroundColor: palette.blueSoft },
  talkingChipText: { color: palette.blueDeep },
});
