import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import {
  activeFilterCount,
  availableFacets,
  cardBadge,
  countdown,
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
  const [today, setToday] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdmissionFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    api
      .admissions()
      .then((data) => {
        setToday(localDate());
        setPayload(data);
      })
      .catch(() => setError('입시 정보를 불러오지 못했어요.'));
  }, []);

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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="뒤로">
          <Feather name="chevron-left" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>연기 입시 정보</Text>
      </View>

      {!payload && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {payload && (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.notice}>
            {/* Pretendard 서브셋에 원문자(U+2460~24FF)가 없어 'ⓘ'는 두부로 나온다.
                아이콘 폰트는 서브셋 대상이 아니라서 Feather 로 그린다. */}
            <Feather name="info" size={14} color="#B45309" />
            <Text style={styles.noticeText}>{payload.disclaimer}</Text>
          </View>

          <View style={styles.searchBox}>
            <Feather name="search" size={15} color={palette.textFaint} />
            <TextInput
              style={styles.search}
              value={filters.query}
              onChangeText={(query) => setFilters((was) => ({ ...was, query }))}
              placeholder="대학·학과·지역 검색"
              placeholderTextColor={palette.textFaint}
            />
          </View>

          <View style={styles.filterBar}>
            <Chip
              label="접수 가능만"
              on={filters.openOnly}
              onPress={() => setFilters((was) => ({ ...was, openOnly: !was.openOnly }))}
            />
            <Chip
              label={activeCount > 0 ? `필터 ${activeCount}` : '필터'}
              on={activeCount > 0}
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
                    on={filters.regions.includes(region)}
                    onPress={() => toggle('regions', region)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="전형" values={facets.tracks}>
                {facets.tracks.map((track) => (
                  <Chip
                    key={track}
                    label={track}
                    on={filters.tracks.includes(track)}
                    onPress={() => toggle('tracks', track)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="계열" values={facets.disciplines}>
                {facets.disciplines.map((discipline) => (
                  <Chip
                    key={discipline}
                    label={DISCIPLINE_LABEL[discipline] ?? discipline}
                    on={filters.disciplines.includes(discipline)}
                    onPress={() => toggle('disciplines', discipline)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="실기 종목" values={facets.practicals}>
                {facets.practicals.map((category) => (
                  <Chip
                    key={category}
                    label={PRACTICAL_LABEL[category] ?? category}
                    on={filters.practicals.includes(category)}
                    onPress={() => toggle('practicals', category)}
                  />
                ))}
              </FilterRow>
              <FilterRow label="학교" values={["always"]}>
                {facets.types.map((type) => (
                  <Chip
                    key={type}
                    label={TYPE_LABEL[type] ?? type}
                    on={filters.types.includes(type)}
                    onPress={() => toggle('types', type)}
                  />
                ))}
                <Chip
                  label="수능 최저 없음"
                  on={filters.noCsatOnly}
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

          {visible.length === 0 && <Text style={styles.empty}>조건에 맞는 대학이 없어요.</Text>}

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
  today: string | null;
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
          <View style={[styles.dday, badge.tone === 'muted' && styles.ddayMuted]}>
            <Text style={[styles.ddayText, badge.tone === 'muted' && styles.ddayTextMuted]}>
              {badge.label}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={18} color={palette.checkOff} />
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

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  campus: {
    paddingHorizontal: 7,
    height: 18,
    lineHeight: 18,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
    fontSize: 10,
    fontWeight: '800',
    color: palette.textDim,
  },
  filterBar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterPanel: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 12,
  },
  filterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  filterLabel: { width: 58, paddingTop: 7, fontSize: 11.5, fontWeight: '800', color: palette.textFaint },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.bgSoft,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: palette.blue },
  chipText: { fontSize: 11.5, fontWeight: '800', color: palette.textDim },
  chipTextOn: { color: '#FFFFFF' },
  empty: { paddingVertical: 40, textAlign: 'center', fontSize: 13, fontWeight: '600', color: palette.textFaint },
  safe: { flex: 1, backgroundColor: palette.bgSoft },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 30, textAlign: 'center', color: palette.danger, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 72, gap: 16 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.amberSoft,
  },
  noticeText: {
    flex: 1,
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 19,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 16,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
  },
  search: { flex: 1, fontSize: 14, color: palette.text },
  count: { marginTop: 2, marginBottom: 2, fontSize: 12, fontWeight: '700', color: palette.textFaint },
  card: {
    backgroundColor: palette.card,
    borderRadius: 20,
    shadowColor: '#191F28',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 20 },
  uniName: { fontSize: 18, fontWeight: '800', color: palette.text },
  region: { fontSize: 11, fontWeight: '600', color: palette.textFaint },
  deptLine: { marginTop: 7, fontSize: 12.5, fontWeight: '600', color: palette.textFaint, lineHeight: 18 },
  dday: { paddingHorizontal: 11, height: 28, borderRadius: 14, backgroundColor: palette.navy, justifyContent: 'center' },
  ddayText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  ddayMuted: { backgroundColor: palette.bgSoft },
  ddayTextMuted: { color: palette.textFaint },
  cardBody: { paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
  link: { fontSize: 13, fontWeight: '800', color: palette.blue },
  dim: { fontSize: 13, fontWeight: '600', color: palette.textFaint, lineHeight: 21 },
  dimSmall: { fontSize: 11.5, fontWeight: '600', color: palette.textFaint, lineHeight: 18 },
  notice2: { padding: 18, borderRadius: 16, backgroundColor: palette.bgSoft, gap: 10 },
  track: { paddingHorizontal: 8, height: 20, borderRadius: 10, backgroundColor: palette.blueSoft, justifyContent: 'center' },
  trackText: { fontSize: 10, fontWeight: '800', color: palette.blue },
  dept: { fontSize: 14, fontWeight: '800', color: palette.text },
  quota: { fontSize: 11, fontWeight: '600', color: palette.textFaint },
  remain: { fontSize: 11, fontWeight: '800', color: palette.blue },
  closed: { fontSize: 11, fontWeight: '700', color: palette.textFaint },
  fieldRow: { flexDirection: 'row', gap: 14, paddingVertical: 1 },
  fieldLabel: { width: 62, fontSize: 12.5, fontWeight: '600', color: palette.textFaint, lineHeight: 20 },
  fieldValue: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.textDim, lineHeight: 20 },
  resultBox: { marginTop: 8, padding: 14, borderRadius: 14, backgroundColor: palette.card, gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: palette.text },
  resultLine: { fontSize: 12.5, fontWeight: '600', color: palette.textDim, lineHeight: 20 },
  more: { marginTop: 8, fontSize: 12.5, fontWeight: '800', color: palette.blue },
  detail: { marginTop: 10, gap: 18 },
  blockLabel: { fontSize: 12, fontWeight: '800', color: palette.text },
  blockValue: { marginTop: 5, fontSize: 12.5, fontWeight: '600', color: palette.textDim, lineHeight: 21 },
  resourceBox: { marginTop: 8, gap: 12 },
  resource: { padding: 16, borderRadius: 14, backgroundColor: palette.bgSoft, gap: 8 },
  badge: { paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: palette.bgSoft, justifyContent: 'center' },
  badgeOfficial: { backgroundColor: palette.blueSoft },
  badgeAcademy: { backgroundColor: '#FFF0F0' },
  badgeText: { fontSize: 10, fontWeight: '800', color: palette.textDim },
  badgeTextOfficial: { color: palette.blue },
  badgeTextAcademy: { color: palette.danger },
  publisher: { flex: 1, fontSize: 11, fontWeight: '700', color: palette.textFaint },
  resourceTitle: { fontSize: 13, fontWeight: '700', color: palette.text, lineHeight: 19 },
  foot: { marginTop: 16, fontSize: 11.5, fontWeight: '600', color: palette.textFaint, lineHeight: 19 },
});
