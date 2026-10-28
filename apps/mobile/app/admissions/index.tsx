import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sanitizeInput } from '@/lib/practice/readable-text';
import { AdSlot } from '@/components/ad-slot';
import { Chip } from '@/components/ds/ui/chip';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavHeader, NavIconButton } from '@/components/ds/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import {
  activeFilterCount,
  availableFacets,
  cardBadge,
  filterGroups,
  groupByUniversity,
  localDate,
  DISCIPLINE_LABEL,
  EMPTY_FILTERS,
  PRACTICAL_LABEL,
  TYPE_LABEL,
  type AdmissionFilters,
  type AdmissionsResponse,
  type UniversityGroup,
} from '@/lib/admissions';

type FilterAxis = 'regions' | 'tracks' | 'disciplines' | 'practicals' | 'types';

/** 연기 입시 정보 — 홈 카드에서 들어온다. 로그인 없이 열린다. */
export default function AdmissionsScreen() {
  const router = useRouter();
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdmissionFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = () => {
    setError(null);
    api
      .admissions()
      .then(setPayload)
      .catch(() => setError('입시 정보를 불러오지 못했어요'));
  };
  useEffect(load, []);

  const today = localDate();
  const groups = useMemo(
    () => (payload ? groupByUniversity(payload, today) : []),
    [payload, today],
  );
  const facets = useMemo(() => (payload ? availableFacets(payload) : null), [payload]);
  const visible = useMemo(() => filterGroups(groups, filters, today), [groups, filters, today]);
  const activeCount = activeFilterCount(filters);

  /** 같은 축 안에서는 여러 개를 고를 수 있다(OR). 웹과 같은 규칙이다. */
  const toggle = (axis: FilterAxis, value: string) =>
    setFilters((was) => ({
      ...was,
      [axis]: was[axis].includes(value)
        ? was[axis].filter((v) => v !== value)
        : [...was[axis], value],
    }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <NavHeader
        title={'연기 입시 정보'}
        left={<NavIconButton icon="chevron-left" label={'뒤로'} phLabel="admissions_back" onPress={() => router.back()} />}
      />

      {!payload && !error && (
        <SkeletonRows count={6} />
      )}
      {error && (
        <View style={styles.errorBox}>
          <InlineError message={error} onRetry={load} />
        </View>
      )}

      {payload && (
        <ScrollView contentContainerStyle={styles.list}>
          <AdSlot slot="admissions_top" />
          <View style={styles.notice}>
            {/* Pretendard 서브셋에 원문자(U+2460~24FF)가 없어 'ⓘ'는 두부로 나온다.
                아이콘 폰트는 서브셋 대상이 아니라서 Feather 로 그린다. */}
            <Feather name="info" size={14} color={palette.amber} />
            <Text style={styles.noticeText}>{payload.disclaimer}</Text>
          </View>

          <View style={styles.searchBox}>
            <Feather name="search" size={15} color={palette.iconFaint} />
            <TextInput
              style={styles.search}
              value={filters.query}
              onChangeText={(query) => setFilters((was) => ({ ...was, query: sanitizeInput(query) }))}
              placeholder="대학·학과·지역 검색"
              placeholderTextColor={palette.textMeta}
            />
          </View>

          <View style={styles.filterBar}>
            <Chip
              label="접수 가능만"
              role="checkbox"
              size="sm"
              selected={filters.openOnly}
              onPress={() => setFilters((was) => ({ ...was, openOnly: !was.openOnly }))}
            />
            <Chip
              label={activeCount > 0 ? `필터 ${activeCount}` : '필터'}
              size="sm"
              selected={activeCount > 0}
              onPress={() => setFilterOpen((was) => !was)}
            />
          </View>

          {filterOpen && facets && (
            <View style={styles.filterPanel}>
              <FilterRow label="지역" values={facets.regions}>
                {facets.regions.map((region) => (
                  <Chip
                    key={region}
                    label={region}
                    role="checkbox"
                    size="sm"
                    selected={filters.regions.includes(region)}
                    onPress={() => toggle('regions', region)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="전형" values={facets.tracks}>
                {facets.tracks.map((track) => (
                  <Chip
                    key={track}
                    label={track}
                    role="checkbox"
                    size="sm"
                    selected={filters.tracks.includes(track)}
                    onPress={() => toggle('tracks', track)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="계열" values={facets.disciplines}>
                {facets.disciplines.map((discipline) => (
                  <Chip
                    key={discipline}
                    label={DISCIPLINE_LABEL[discipline] ?? discipline}
                    role="checkbox"
                    size="sm"
                    selected={filters.disciplines.includes(discipline)}
                    onPress={() => toggle('disciplines', discipline)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="실기 종목" values={facets.practicals}>
                {facets.practicals.map((category) => (
                  <Chip
                    key={category}
                    label={PRACTICAL_LABEL[category] ?? category}
                    role="checkbox"
                    size="sm"
                    selected={filters.practicals.includes(category)}
                    onPress={() => toggle('practicals', category)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="학교" values={["always"]}>
                {facets.types.map((type) => (
                  <Chip
                    key={type}
                    label={TYPE_LABEL[type] ?? type}
                    role="checkbox"
                    size="sm"
                    selected={filters.types.includes(type)}
                    onPress={() => toggle('types', type)}
                  />
                ))}
                <Chip
                  label="수능 최저 없음"
                  role="checkbox"
                  size="sm"
                  selected={filters.noCsatOnly}
                  onPress={() => setFilters((was) => ({ ...was, noCsatOnly: !was.noCsatOnly }))}
                />
              </FilterRow>
              {activeCount > 0 && (
                <Pressable
                  onPress={() => setFilters((was) => ({ ...EMPTY_FILTERS, query: was.query }))}>
                  <Text style={styles.link}>필터 초기화</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.count}>대학 {visible.length}곳</Text>

          {visible.map((group) => (
            <UniversityCard
              key={group.university.id}
              group={group}
              today={today}
              onPress={() => router.push(`/admissions/${group.university.id}`)}
            />
          ))}

          {visible.length === 0 && (
            <InlineEmpty title="조건에 맞는 대학이 없어요" />
          )}

          <Text style={styles.foot}>
            {payload.updated_at} 기준 · 확인한 곳부터 차례로 채우고 있어요{'\n'}
            입시결과에 적힌 학생부 숫자는 최종등록자의 교과 성적이에요.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * 목록 카드. 대학이 쉰 곳이라 여기서 펼치지 않고 상세 화면으로 보낸다 —
 * 아코디언 두 겹으로는 훑을 수가 없었다.
 */
function UniversityCard({
  group,
  today,
  onPress,
}: {
  group: UniversityGroup;
  today: string;
  onPress: () => void;
}) {
  const { university, notices } = group;
  const badge = cardBadge(notices, today);

  // 같은 학과가 수시·정시로 두 번 잡히면 한 줄에 같은 이름이 두 번 뜬다.
  const departments = notices
    .map((notice) => notice.department ?? '학과 미확인')
    .filter((name, index, all) => all.indexOf(name) === index);

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text style={styles.uniName}>{university.name}</Text>
            {university.campus && <Text style={styles.campus}>{university.campus}</Text>}
            {university.region && <Text style={styles.region}>{university.region}</Text>}
          </View>
          <Text style={styles.deptLine} numberOfLines={1}>
            {departments.length > 0 ? departments.join(' · ') : '전형 정보 확인 중'}
          </Text>
        </View>
        {badge && (
          // D-day 배지만 롤백 모양(검은 바탕·흰 글씨)이다(SOMA-923).
          <View style={[styles.dday, badge.tone === 'muted' && styles.ddayMuted]}>
            <Text style={[styles.ddayText, badge.tone === 'muted' && styles.ddayTextMuted]}>
              {badge.label}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={18} color={palette.iconFaint} />
      </View>
    </Pressable>
  );
}

/**
 * 필터 한 줄. values가 비면 통째로 감춘다 — 아직 공고를 확인하지 못한 대학이
 * 대부분이라 실기 종목 facet이 빌 수 있는데, 라벨만 남은 빈 줄은 고장으로 읽힌다.
 */
function FilterRow({
  label,
  values,
  children,
}: {
  label: string;
  values: unknown[];
  children: React.ReactNode;
}) {
  if (values.length === 0) return null;
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  campus: {
    paddingHorizontal: space[1.5],
    ...type.micro,
    height: 20,
    lineHeight: 20,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
    color: palette.textSub,
  },
  filterBar: { flexDirection: 'row', gap: space[1.5], flexWrap: 'wrap' },
  filterPanel: {
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    gap: space[3],
  },
  filterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  filterLabel: { width: 56, paddingTop: space[1.5], ...type.captionBold, color: palette.textSub },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], flexWrap: 'wrap' },
  errorBox: { paddingHorizontal: space.gutter, paddingTop: space[2] },
  list: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10], gap: space[3] },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: palette.amberSoft,
  },
  noticeText: { flex: 1, ...type.captionBold, color: palette.amber },
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
  count: { ...type.body2Bold, color: palette.textSub },
  card: { backgroundColor: palette.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  uniName: { ...type.body1Bold, color: palette.text },
  region: { ...type.caption, color: palette.textMeta },
  deptLine: { marginTop: space[1], ...type.caption, color: palette.textMeta },
  dday: { paddingHorizontal: 11, height: 28, borderRadius: 14, backgroundColor: palette.navy, justifyContent: 'center' },
  ddayText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  ddayMuted: { backgroundColor: palette.bgSoft },
  ddayTextMuted: { color: palette.textFaint },
  link: { ...type.body2Bold, color: palette.blueDeep },
  foot: { marginTop: space[4], ...type.caption, color: palette.textMeta },
});

/** 배지 tone → 색. 오늘 마감은 danger-soft, 다가오는 일정은 blue-soft, 그 밖은 bg-soft. */
