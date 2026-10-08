import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { readAuditionMarks, writeAuditionMarks } from '@/lib/audition-marks';
import {
  auditionSections,
  categoryKey,
  daysUntil,
  EMPTY_AUDITION_FILTERS,
  filterAuditions,
  groupCounts,
  isNewPosting,
  kstDate,
  shortDate,
  type AuditionFilters,
  type AuditionPosting,
  type AuditionPostingList,
} from '@/lib/auditions';
import { translate as t } from '@/lib/i18n';
import { postedAtLabel } from '@/lib/time-label';

type Toggle = 'week' | 'paid' | 'starred';

/** 오디션 공고 모아보기(app.audition) — 홈 카드에서 들어온다. 로그인 없이 열린다. */
export default function AuditionsScreen() {
  const router = useRouter();
  const [payload, setPayload] = useState<AuditionPostingList | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<AuditionFilters>(EMPTY_AUDITION_FILTERS);
  const [starred, setStarred] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    try {
      setPayload(await api.auditions());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void readAuditionMarks('starred').then(setStarred);
    void readAuditionMarks('seen').then(setSeen);
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const today = kstDate();
  const items = useMemo(() => payload?.items ?? [], [payload]);
  // 칩 건수는 분야만 뺀 나머지 조건(검색·토글)을 반영한다 — 누르면 그 숫자만큼 나온다.
  const chips = useMemo(
    () => groupCounts(filterAuditions(items, { ...filters, group: 'all' }, today, starred)),
    [items, filters, today, starred],
  );
  const visible = useMemo(
    () => filterAuditions(items, filters, today, starred),
    [items, filters, today, starred],
  );
  const sections = useMemo(() => auditionSections(visible, today), [visible, today]);
  const dirty =
    filters.group !== 'all' || filters.week || filters.paid || filters.starred || filters.query !== '';

  const toggle = (key: Toggle) => setFilters((was) => ({ ...was, [key]: !was[key] }));

  const toggleStar = (id: string) =>
    setStarred((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      void writeAuditionMarks('starred', next);
      return next;
    });

  const open = (posting: AuditionPosting) => {
    setSeen((was) => {
      if (was.has(posting.id)) return was;
      const next = new Set(was);
      next.add(posting.id);
      void writeAuditionMarks('seen', next);
      return next;
    });
    void Linking.openURL(posting.source_url).catch(() => undefined);
  };

  const collected = payload?.collected_at ? postedAtLabel(payload.collected_at) : '';

  const emptyText = filters.starred
    ? t('auditions.emptyStarred')
    : items.length === 0
      ? t('auditions.empty')
      : t('auditions.emptyFiltered');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('auditions.title')}</Text>
        {payload && (
          <Text style={styles.headerMeta} numberOfLines={1}>
            {collected ? `${t('auditions.collectedAt', { ago: collected })} · ` : ''}
            {t('auditions.count', { n: visible.length })}
          </Text>
        )}
      </View>

      {!payload && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      )}
      {!payload && error && (
        <View style={styles.center}>
          <Text style={styles.error}>{t('auditions.loadError')}</Text>
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.link}>{t('auditions.retry')}</Text>
          </Pressable>
        </View>
      )}

      {payload && (
        <>
          <View style={styles.controls}>
            <View style={styles.searchBox}>
              <Feather name="search" size={15} color={palette.textFaint} />
              <TextInput
                style={styles.search}
                value={filters.query}
                onChangeText={(query) => setFilters((was) => ({ ...was, query }))}
                placeholder={t('auditions.searchPh')}
                placeholderTextColor={palette.textFaint}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              keyboardShouldPersistTaps="handled">
              {chips.map(({ key, count }) => (
                <Chip
                  key={key}
                  label={t(`auditions.groups.${key}`)}
                  count={count}
                  on={filters.group === key}
                  onPress={() => setFilters((was) => ({ ...was, group: key }))}
                />
              ))}
            </ScrollView>

            <View style={styles.toggleRow}>
              <Chip label={t('auditions.filterWeek')} on={filters.week} onPress={() => toggle('week')} />
              <Chip label={t('auditions.filterPaid')} on={filters.paid} onPress={() => toggle('paid')} />
              <Chip
                label={t('auditions.filterStarred')}
                on={filters.starred}
                onPress={() => toggle('starred')}
              />
              {dirty && (
                <Pressable
                  onPress={() => setFilters(EMPTY_AUDITION_FILTERS)}
                  accessibilityRole="button"
                  style={styles.reset}>
                  <Text style={styles.link}>{t('auditions.reset')}</Text>
                </Pressable>
              )}
            </View>
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.blue} />
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionTitle}>
                {t('auditions.sectionCount', {
                  label: t(`auditions.buckets.${section.bucket}`),
                  n: section.data.length,
                })}
              </Text>
            )}
            renderItem={({ item }) => (
              <AuditionCard
                posting={item}
                today={today}
                starred={starred.has(item.id)}
                seen={seen.has(item.id)}
                onOpen={() => open(item)}
                onStar={() => toggleStar(item.id)}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
            ListFooterComponent={
              <View style={styles.footer}>
                <Feather name="info" size={13} color={palette.textFaint} />
                <Text style={styles.footerText}>{t('auditions.footer')}</Text>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

/** D-day 칸. 3일 안은 빨강, 7일 안은 주황, 그 뒤는 파랑. 마감일이 없으면 원문을 보라고 한다. */
function DdayBadge({ posting, today }: { posting: AuditionPosting; today: string }) {
  const days = daysUntil(posting.apply_end, today);
  if (days === null) {
    return (
      <View style={[styles.dday, styles.ddayNone]}>
        <Text style={[styles.ddayText, styles.ddayTextNone]}>{t('auditions.noDeadline')}</Text>
        <Text style={styles.ddaySub}>{t('auditions.checkSource')}</Text>
      </View>
    );
  }
  const tone = days <= 3 ? 'urgent' : days <= 7 ? 'soon' : 'ok';
  return (
    <View style={[styles.dday, tone === 'urgent' ? styles.ddayUrgent : tone === 'soon' ? styles.ddaySoon : styles.ddayOk]}>
      <Text
        style={[
          styles.ddayText,
          tone === 'urgent' ? styles.ddayTextUrgent : tone === 'soon' ? styles.ddayTextSoon : styles.ddayTextOk,
        ]}>
        {days === 0 ? t('auditions.ddayToday') : t('auditions.dday', { n: days })}
      </Text>
      <Text style={styles.ddaySub}>{t('auditions.deadlineOn', { date: shortDate(posting.apply_end) })}</Text>
    </View>
  );
}

function AuditionCard({
  posting,
  today,
  starred,
  seen,
  onOpen,
  onStar,
}: {
  posting: AuditionPosting;
  today: string;
  starred: boolean;
  seen: boolean;
  onOpen: () => void;
  onStar: () => void;
}) {
  const posted = shortDate(posting.posted_on);
  const meta = [
    posting.pay_text ? t('auditions.pay', { pay: posting.pay_text }) : null,
    posted ? t('auditions.postedOn', { date: posted }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={t('auditions.openA11y', { title: posting.title })}
      style={({ pressed }) => [styles.card, seen && styles.cardSeen, pressed && styles.cardPressed]}>
      <DdayBadge posting={posting} today={today} />
      <View style={styles.body}>
        <View style={styles.tags}>
          {isNewPosting(posting, today) && <Text style={[styles.tag, styles.tagNew]}>{t('auditions.isNew')}</Text>}
          <Text style={[styles.tag, styles.tagCategory]}>
            {t(`auditions.categories.${categoryKey(posting.category)}`)}
          </Text>
          <Text style={styles.source} numberOfLines={1}>
            {posting.source_name}
          </Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {posting.title}
        </Text>
        {meta !== '' && (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      <Pressable
        onPress={onStar}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ selected: starred }}
        accessibilityLabel={starred ? t('auditions.unstarA11y') : t('auditions.starA11y')}
        style={styles.star}>
        <Ionicons name={starred ? 'star' : 'star-outline'} size={20} color={starred ? palette.hintIcon : palette.checkOff} />
      </Pressable>
    </Pressable>
  );
}

function Chip({
  label,
  count,
  on,
  onPress,
}: {
  label: string;
  count?: number;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>
        {label}
        {count !== undefined && <Text style={[styles.chipCount, on && styles.chipTextOn]}> {count}</Text>}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSoft },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  headerMeta: { flex: 1, textAlign: 'right', fontSize: 11.5, fontWeight: '600', color: palette.textFaint },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { paddingHorizontal: 30, textAlign: 'center', color: palette.danger, fontWeight: '600' },
  link: { fontSize: 13, fontWeight: '800', color: palette.blue },

  controls: { paddingHorizontal: 20, gap: 10, paddingBottom: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    height: 46,
    borderRadius: 14,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
  },
  search: { flex: 1, fontSize: 14, color: palette.text },
  chipRow: { gap: 6 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  reset: { paddingHorizontal: 6, height: 30, justifyContent: 'center' },
  chip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  chipText: { fontSize: 11.5, fontWeight: '800', color: palette.textDim },
  chipCount: { fontWeight: '600', color: palette.textFaint },
  chipTextOn: { color: '#FFFFFF' },

  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 72 },
  sectionTitle: { marginTop: 14, marginBottom: 10, fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  empty: {
    paddingVertical: 48,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: palette.textFaint,
    lineHeight: 20,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22 },
  footerText: { fontSize: 11.5, fontWeight: '600', color: palette.textFaint },

  card: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 18,
    backgroundColor: palette.card,
    shadowColor: '#191F28',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  cardSeen: { opacity: 0.55 },
  cardPressed: { opacity: 0.85 },
  body: { flex: 1, gap: 5 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tag: {
    paddingHorizontal: 7,
    height: 18,
    lineHeight: 18,
    borderRadius: 9,
    overflow: 'hidden',
    fontSize: 10,
    fontWeight: '800',
  },
  tagNew: { backgroundColor: palette.blue, color: '#FFFFFF' },
  tagCategory: { backgroundColor: palette.bgSoft, color: palette.textDim },
  source: { flexShrink: 1, fontSize: 11, fontWeight: '600', color: palette.textFaint },
  title: { fontSize: 14.5, fontWeight: '700', color: palette.text, lineHeight: 20 },
  meta: { fontSize: 12, fontWeight: '500', color: palette.textFaint },
  star: { padding: 4 },

  dday: { width: 62, paddingVertical: 8, borderRadius: 12, alignItems: 'center', gap: 2 },
  ddayUrgent: { backgroundColor: palette.dangerSoft },
  ddaySoon: { backgroundColor: palette.amberSoft },
  ddayOk: { backgroundColor: palette.blueSoft },
  ddayNone: { backgroundColor: palette.bgSoft },
  ddayText: { fontSize: 14, fontWeight: '800' },
  ddayTextUrgent: { color: palette.danger },
  ddayTextSoon: { color: palette.amber },
  ddayTextOk: { color: palette.blue },
  ddayTextNone: { fontSize: 12.5, color: palette.textDim },
  ddaySub: { fontSize: 9.5, fontWeight: '600', color: palette.textFaint },
});
