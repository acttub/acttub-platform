import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import {
  filterGroups,
  groupTitle,
  hideNotice,
  mergeHistoryRows,
  type HistoryRow,
} from '@/lib/practice/groups';
import type { PracticeGroup, PracticeGroupFilter } from '@/lib/practice/types';
import { useRequireLogin } from '@/hooks/use-require-login';

type Row = HistoryRow & {
  icon: 'video' | 'mic';
  onPress: () => void;
  onLongPress?: () => void;
  chips: string[];
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
  const router = useRouter();
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  const [filter, setFilter] = useState<PracticeGroupFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const { isGuest } = useRequireLogin();

  const load = useCallback(async () => {
    setError(null);
    // 둘러보는 중에는 서버 계정이 없어 보호된 목록을 요청하지 않는다.
    if (isGuest) {
      setGroups([]);
      setLoading(false);
      return;
    }
    try {
      const groupList = await api.listPracticeGroups('all');
      setGroups(groupList.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('history.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [isGuest]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openGroup = (rootId: string) => router.push({ pathname: '/practice-group', params: { rootId } });

  /** 숨김은 묶음 전체다 — 노트·대화·기억은 그대로고 영상은 보관함에 남는다. */
  const hideGroup = async (group: PracticeGroup) => {
    const ok = await confirm({
      title: t('history.hideTitle'),
      message: hideNotice(),
      confirmLabel: t('history.hideConfirm'),
      destructive: true,
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

  const onGroupMenu = (group: PracticeGroup) => {
    void sheet({
      title: groupTitle(group),
      actions: [
        { label: t('history.fullView'), onPress: () => openGroup(group.root_id) },
        {
          label: group.favorite ? t('history.favOff') : t('history.favOn'),
          onPress: () => void toggleFavorite(group),
        },
        { label: t('history.hideConfirm'), destructive: true, onPress: () => void hideGroup(group) },
      ],
    });
  };

  const dayLabel = (iso: string) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });

  const rows = useMemo<Row[]>(() => {
    const practices = filterGroups(groups, filter).map<Row>((group) => ({
      id: `g:${group.root_id}`,
      at: group.last_practiced_at ?? '',
      kind: 'practice',
      title: groupTitle(group),
      meta: `${dayLabel(group.last_practiced_at ?? '')} · ${t('history.countTimes', { count: group.ordinal_count })}`,
      icon: 'video',
      chips: group.tags ?? [],
      onPress: () => openGroup(group.root_id),
      onLongPress: () => onGroupMenu(group),
    }));
    return mergeHistoryRows(practices, []) as Row[];
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
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="arrow-left" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('history.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
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

        {monthGroups.map((group) => (
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

        {!loading && !error && rows.length === 0 && (
          <Text style={styles.empty}>{filter === 'favorite' ? t('history.favEmpty') : t('history.empty')}</Text>
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
