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
  countdown,
  groupByUniversity,
  isOpen,
  localDate,
  matchesQuery,
  periodText,
  SOURCE_LABEL,
  type AdmissionNotice,
  type AdmissionsResponse,
  type UniversityGroup,
} from '@/lib/admissions';

/** 연기 입시 정보 — 홈 카드에서 들어온다. 로그인 없이 열린다. */
export default function AdmissionsScreen() {
  const router = useRouter();
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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
  const visible = groups.filter((group) => matchesQuery(group, query));

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
              value={query}
              onChangeText={setQuery}
              placeholder="대학·학과·지역 검색"
              placeholderTextColor={palette.textFaint}
            />
          </View>

          <Text style={styles.count}>대학 {visible.length}곳</Text>

          {visible.map((group) => (
            <UniversityCard key={group.university.id} group={group} today={today} />
          ))}

          <Text style={styles.foot}>
            {payload.updated_at} 기준 · 확인한 곳부터 차례로 채우고 있어요{'\n'}
            입시결과에 적힌 학생부 숫자는 최종등록자의 교과 성적이에요.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function UniversityCard({ group, today }: { group: UniversityGroup; today: string | null }) {
  const [open, setOpen] = useState(false);
  const { university, notices } = group;
  const soonest = notices
    .map((notice) => (today ? countdown(notice, today) : null))
    .filter(Boolean)
    .sort((a, b) => (a?.days ?? 0) - (b?.days ?? 0))[0];

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHead} onPress={() => setOpen((was) => !was)}>
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text style={styles.uniName}>{university.name}</Text>
            {university.region && <Text style={styles.region}>{university.region}</Text>}
          </View>
          <Text style={styles.deptLine} numberOfLines={1}>
            {notices.length > 0
              ? notices.map((n) => n.department ?? '학과 미확인').join(' · ')
              : '전형 정보 확인 중'}
          </Text>
        </View>
        {soonest && (
          <View style={styles.dday}>
            <Text style={styles.ddayText}>
              D-{soonest.days === 0 ? 'DAY' : soonest.days}
            </Text>
          </View>
        )}
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={palette.checkOff} />
      </Pressable>

      {open && (
        <View style={styles.cardBody}>
          <Pressable onPress={() => void Linking.openURL(university.admission_url)}>
            <Text style={styles.link}>입학처 원문 ↗</Text>
          </Pressable>

          {notices.length === 0 ? (
            <Text style={styles.dim}>
              {university.note ?? '아직 전형 정보를 확인하지 못했어요.'}
            </Text>
          ) : (
            notices.map((notice) => <NoticeRow key={notice.id} notice={notice} today={today} />)
          )}

          {university.resources.length > 0 && (
            <View style={styles.resourceBox}>
              <Text style={styles.sectionTitle}>참고 영상</Text>
              <Text style={styles.dimSmall}>
                합격했다고 밝힌 영상이 섞여 있어요. 본인 주장이라 저희가 확인한 건 아니고,
                입시학원 홍보 영상도 따로 표시해 뒀어요.
              </Text>
              {university.resources.map((resource) => (
                <Pressable
                  key={resource.url}
                  style={styles.resource}
                  onPress={() => void Linking.openURL(resource.url)}>
                  <View style={styles.row}>
                    <View
                      style={[
                        styles.badge,
                        resource.source_type === 'official' && styles.badgeOfficial,
                        resource.source_type === 'academy' && styles.badgeAcademy,
                      ]}>
                      <Text
                        style={[
                          styles.badgeText,
                          resource.source_type === 'official' && styles.badgeTextOfficial,
                          resource.source_type === 'academy' && styles.badgeTextAcademy,
                        ]}>
                        {SOURCE_LABEL[resource.source_type] ?? resource.source_type}
                      </Text>
                    </View>
                    <Text style={styles.publisher} numberOfLines={1}>
                      {resource.publisher}
                    </Text>
                  </View>
                  <Text style={styles.resourceTitle}>{resource.title}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function NoticeRow({ notice, today }: { notice: AdmissionNotice; today: string | null }) {
  const [open, setOpen] = useState(false);
  const remaining = today ? countdown(notice, today) : null;
  const closed = Boolean(today) && !isOpen(notice, today as string);
  const results = notice.results.filter((r) => r.competition_rate);

  return (
    <View style={styles.notice2}>
      <View style={styles.row}>
        {notice.track && (
          <View style={styles.track}>
            <Text style={styles.trackText}>{notice.track}</Text>
          </View>
        )}
        <Text style={styles.dept}>{notice.department ?? '학과 미확인'}</Text>
        {notice.quota && <Text style={styles.quota}>{notice.quota}</Text>}
      </View>
      {remaining ? (
        <Text style={styles.remain}>
          {remaining.label} D-{remaining.days === 0 ? 'DAY' : remaining.days}
        </Text>
      ) : (
        closed && <Text style={styles.closed}>접수 마감</Text>
      )}

      <Field label="원서접수" value={periodText(notice.apply_start, notice.apply_end)} />
      <Field label="실기고사" value={notice.practical_date} />
      <Field label="전형료" value={notice.fee} />
      <Field label="수능 최저" value={notice.csat_minimum} />

      {results.length > 0 && (
        <View style={styles.resultBox}>
          <Text style={styles.sectionTitle}>전년도 입시결과</Text>
          {results.map((result) => (
            <Text key={`${result.year}-${result.note ?? ''}`} style={styles.resultLine}>
              {result.year}학년도 · {result.competition_rate}
              {result.transcript_avg ? ` · 학생부 평균 ${result.transcript_avg}` : ''}
              {result.practical_avg ? ` · 실기 평균 ${result.practical_avg}` : ''}
            </Text>
          ))}
        </View>
      )}

      <Pressable onPress={() => setOpen((was) => !was)}>
        <Text style={styles.more}>{open ? '접기' : '실기 내용·준비물 자세히 보기'}</Text>
      </Pressable>

      {open && (
        <View style={styles.detail}>
          <Block label="실기 과제" value={notice.practical_task} />
          <Block label="복장·준비물" value={notice.dress_code} />
          <Block label="제출서류" value={notice.documents} />
          {notice.designated_works.length > 0 && (
            <View>
              <Text style={styles.blockLabel}>지정 작품</Text>
              {notice.designated_works.map((work) => (
                <Text key={work} style={styles.blockValue}>
                  · {work}
                </Text>
              ))}
            </View>
          )}
          {notice.essay_questions.length > 0 && (
            <View>
              <Text style={styles.blockLabel}>제출 문항</Text>
              {notice.essay_questions.map((question, index) => (
                <Text key={question} style={styles.blockValue}>
                  {index + 1}. {question}
                </Text>
              ))}
            </View>
          )}
          {notice.note && <Text style={styles.dimSmall}>{notice.note}</Text>}
        </View>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Block({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View>
      <Text style={styles.blockLabel}>{label}</Text>
      <Text style={styles.blockValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
