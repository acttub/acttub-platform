import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

import { sanitizeInput } from '@/lib/practice/readable-text';
import { AdSlot } from '@/components/ad-slot';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Chip } from '@/components/ui/chip';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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

  const filtered = !filters.starred && items.length > 0;
  const emptyText = filters.starred ? t('auditions.emptyStarred') : t('auditions.empty');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <NavHeader
        title={t('auditions.title')}
        left={<NavIconButton icon="chevron-left" label={t('common.back')} phLabel="auditions_back" onPress={() => router.back()} />}
      />
      {payload && (
        <Text style={styles.headerMeta} numberOfLines={1}>
          {collected ? `${t('auditions.collectedAt', { ago: collected })} · ` : ''}
          {t('auditions.count', { n: visible.length })}
        </Text>
      )}

      {!payload && !error && (
        <SkeletonRows count={5} />
      )}
      {!payload && error && (
        <StatusScreen
          title={t('auditions.loadError')}
          body={t('auditions.loadErrorBody')}
          primary={{ label: t('auditions.retry'), onPress: () => void load() }}
        />
      )}

      {payload && (
        <>
          <View style={styles.controls}>
            <View style={styles.searchBox}>
              <Feather name="search" size={15} color={palette.iconFaint} />
              <TextInput
                style={styles.search}
                value={filters.query}
                onChangeText={(query) => setFilters((was) => ({ ...was, query: sanitizeInput(query) }))}
                placeholder={t('auditions.searchPh')}
                placeholderTextColor={palette.textMeta}
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
                  label={`${t(`auditions.groups.${key}`)} ${count}`}
                  role="radio"
                  selected={filters.group === key}
                  size="sm"
                  onPress={() => setFilters((was) => ({ ...was, group: key }))}
                />
              ))}
            </ScrollView>

            <View style={styles.toggleRow}>
              <Chip label={t('auditions.filterWeek')} role="checkbox" selected={filters.week} size="sm" onPress={() => toggle('week')} />
              <Chip label={t('auditions.filterPaid')} role="checkbox" selected={filters.paid} size="sm" onPress={() => toggle('paid')} />
              <Chip
                label={t('auditions.filterStarred')}
                role="checkbox"
                selected={filters.starred}
                size="sm"
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
            ListHeaderComponent={<AdSlot slot="auditions_top" style={styles.ad} />}
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
            ListEmptyComponent={
              // 조건으로 걸러 비었으면 마스코트와 함께 「초기화」를 알린다(pen NQ33xk). 그 밖의 빈 목록은 한 줄 안내다.
              filtered ? (
                <StatusScreen kind="empty" title={t('auditions.emptyFiltered')} body={t('auditions.emptyFilteredHint')} />
              ) : (
                <InlineEmpty title={emptyText} />
              )
            }
            ListFooterComponent={
              <View style={styles.footer}>
                <Feather name="info" size={13} color={palette.iconFaint} />
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
        ph-label="auditions_star"
        style={styles.star}>
        <Ionicons name={starred ? 'star' : 'star-outline'} size={20} color={starred ? palette.blue : palette.iconFaint} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  headerMeta: { paddingHorizontal: space.gutter, paddingBottom: space[1.5], ...type.caption, color: palette.textMeta },
  link: { ...type.body2Bold, color: palette.blueDeep },
  ad: { marginVertical: space[2] },

  controls: { paddingHorizontal: space.gutter, gap: space[3], paddingBottom: space[1.5] },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    height: 48,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  search: { flex: 1, ...type.body1, lineHeight: undefined, color: palette.text },
  chipRow: { gap: space[1.5] },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1.5] },
  reset: { paddingHorizontal: space[1.5], height: 32, justifyContent: 'center' },

  list: { paddingHorizontal: space.gutter, paddingTop: space[1], paddingBottom: space[10] },
  sectionTitle: { marginTop: space[3], marginBottom: space[3], ...type.body2Bold, color: palette.textSub },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1.5], marginTop: space[6] },
  footerText: { ...type.caption, color: palette.textMeta },

  card: {
    marginBottom: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[4],
    paddingLeft: space[4],
    paddingRight: space[3],
    borderRadius: radius.lg,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardSeen: { opacity: 0.5 },
  cardPressed: { opacity: 0.7 },
  body: { flex: 1, gap: space[1] },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  tag: {
    paddingHorizontal: space[1.5],
    ...type.micro,
    height: 20,
    lineHeight: 20,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  tagNew: { backgroundColor: palette.blue, color: palette.onAccent },
  tagCategory: { backgroundColor: palette.bgSoft, color: palette.textSub },
  source: { flexShrink: 1, ...type.micro, color: palette.textMeta },
  title: { ...type.body2Bold, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  star: { padding: space[1] },

  dday: { width: 60, paddingVertical: space[2], borderRadius: radius.md, alignItems: 'center', gap: 2 },
  ddayUrgent: { backgroundColor: palette.dangerSoft },
  ddaySoon: { backgroundColor: palette.amberSoft },
  ddayOk: { backgroundColor: palette.blueSoft },
  ddayNone: { backgroundColor: palette.bgSoft },
  ddayText: { ...type.body2Bold },
  ddayTextUrgent: { color: palette.danger },
  ddayTextSoon: { color: palette.amber },
  ddayTextOk: { color: palette.blueDeep },
  ddayTextNone: { ...type.captionBold, color: palette.textSub },
  ddaySub: { ...type.micro, fontWeight: '400', color: palette.textMeta },
});
