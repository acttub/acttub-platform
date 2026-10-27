import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import {
  countdown,
  formatSeconds,
  groupTips,
  isOpen,
  localDate,
  periodText,
  weightBars,
  DISCIPLINE_LABEL,
  PRACTICAL_LABEL,
  SOURCE_LABEL,
  type AdmissionNotice,
  type AdmissionResource,
  type AdmissionTip,
  type AdmissionsResponse,
  type AdmissionUniversity,
} from '@/lib/admissions';

/**
 * 대학 한 곳의 입시 정보 전부. 목록에서 카드를 눌러 들어온다.
 *
 * 목록과 달리 여기서는 아무것도 접지 않는다 — 여기까지 들어온 사람은
 * 그 대학을 파고들려는 것이지 훑으려는 게 아니다.
 */
export default function UniversityDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setError(null);
    api
      .admissionsByUniversity(id)
      .then(setPayload)
      .catch(() => setError('입시 정보를 불러오지 못했어요'));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const university = payload?.universities[0] ?? null;
  const today = localDate();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <NavHeader
        title={university?.name ?? '연기 입시 정보'}
        left={<NavIconButton icon="chevron-left" label={'뒤로'} phLabel="admissions_back" onPress={() => router.back()} />}
      />

      {!payload && !error && (
        <SkeletonDetail lines={6} />
      )}
      {error && (
        <View style={styles.errorBox}>
          <InlineError message={error} onRetry={load} />
        </View>
      )}
      {payload && !university && (
        <View style={styles.errorBox}>
          <InlineErrorLine message="해당 대학을 찾을 수 없어요." />
        </View>
      )}

      {payload && university && (
        <ScrollView contentContainerStyle={styles.list}>
          <UniversityHeader university={university} />
          <AdSlot slot="admission_detail_top" />

          <View style={styles.notice}>
            {/* Pretendard 서브셋에 원문자(U+2460~24FF)가 없어 'ⓘ'는 두부로 나온다. */}
            <Feather name="info" size={14} color={palette.amber} />
            <Text style={styles.noticeText}>{payload.disclaimer}</Text>
          </View>

          {payload.notices.length === 0 ? (
            <Text style={styles.dim}>
              {university.note ??
                '아직 전형 정보를 확인하지 못했어요. 입학처 원문에서 확인해 주세요.'}
            </Text>
          ) : (
            payload.notices.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} today={today} />
            ))
          )}

          {university.tips.length > 0 && <TipList tips={university.tips} />}

          {university.resources.length > 0 && <ResourceList resources={university.resources} />}

          <Text style={styles.foot}>
            {payload.updated_at} 기준 · 각 대학 모집요강 원문을 사람이 직접 읽고 채우고 있어요
            {'\n'}
            입시결과에 적힌 학생부 숫자는 최종등록자의 교과 성적이에요.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function UniversityHeader({ university }: { university: AdmissionUniversity }) {
  return (
    <View style={styles.uniHead}>
      <View style={styles.row}>
        <Text style={styles.uniName}>{university.name}</Text>
        {university.campus && <Text style={styles.tag}>{university.campus}</Text>}
        {university.type === 'college' && <Text style={styles.tag}>전문대</Text>}
      </View>
      <View style={styles.row}>
        {university.region && <Text style={styles.region}>{university.region}</Text>}
        <Pressable onPress={() => void Linking.openURL(university.admission_url)}>
          <Text style={styles.link}>입학처 원문 ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NoticeCard({ notice, today }: { notice: AdmissionNotice; today: string }) {
  const remaining = countdown(notice, today);
  const closed = !isOpen(notice, today);
  const bars = weightBars(notice.weights);
  const results = notice.results.filter((result) => result.competition_rate);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {notice.track && (
          <View style={styles.track}>
            <Text style={styles.trackText}>{notice.track}</Text>
          </View>
        )}
        {notice.discipline && (
          <Text style={styles.tag}>{DISCIPLINE_LABEL[notice.discipline] ?? notice.discipline}</Text>
        )}
        {remaining ? (
          <Text style={styles.remain}>
            {remaining.label} D-{remaining.days === 0 ? 'DAY' : remaining.days}
          </Text>
        ) : (
          closed && <Text style={styles.closed}>접수 마감</Text>
        )}
      </View>

      <Text style={styles.dept}>{notice.department ?? '학과 미확인'}</Text>
      {notice.screening && <Text style={styles.screening}>{notice.screening}</Text>}

      <View style={styles.schedule}>
        <Field label="원서접수" value={periodText(notice.apply_start, notice.apply_end)} />
        <Field
          label="실기고사"
          value={periodText(notice.practical_date, notice.practical_date_end)}
        />
        <Field label="합격발표" value={notice.announce_date} />
        <Field label="모집인원" value={notice.quota} />
        <Field label="전형료" value={notice.fee} />
      </View>

      {bars.length > 0 && <WeightBar bars={bars} note={notice.weights_note} />}
      {bars.length === 0 && notice.weights_note && (
        <Block label="전형요소 반영비율" value={notice.weights_note} />
      )}

      {notice.stages.length > 0 && <Stages notice={notice} />}
      {notice.practical_items.length > 0 && <PracticalItems notice={notice} />}

      <Block label="실기 과제 원문" value={notice.practical_task} />
      <Block label="복장" value={notice.dress_code} />
      <Block label="준비물" value={notice.preparation} />
      <Block label="제출서류" value={notice.documents} />
      <Block label="수능 최저" value={notice.csat_minimum} />

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

      {results.length > 0 && (
        <View style={styles.resultBox}>
          <Text style={styles.sectionTitle}>전년도 입시결과</Text>
          {results.map((result) => (
            <Text key={`${result.year}-${result.note ?? ''}`} style={styles.resultLine}>
              {result.year}학년도 · {result.competition_rate}
              {result.transcript_avg ? ` · 학생부 평균 ${result.transcript_avg}` : ''}
              {result.practical_avg ? ` · 실기 평균 ${result.practical_avg}` : ''}
              {result.fill_rate ? ` · 충원율 ${result.fill_rate}` : ''}
              {result.waitlist_last != null ? ` · 예비 ${result.waitlist_last}번` : ''}
            </Text>
          ))}
        </View>
      )}

      {notice.note && <Text style={styles.dimSmall}>{notice.note}</Text>}

      {notice.source_url && (
        <Pressable onPress={() => void Linking.openURL(notice.source_url as string)}>
          <Text style={styles.link}>원문 공고 보기 ↗</Text>
        </Pressable>
      )}
    </View>
  );
}

const BAR_COLOR: Record<string, string> = {
  practical: palette.blue,
  transcript: palette.textMeta,
  csat: palette.textDisabled,
  interview: palette.green,
  portfolio: palette.amber,
  other: palette.border,
};

function WeightBar({
  bars,
  note,
}: {
  bars: { key: string; label: string; value: number }[];
  note?: string | null;
}) {
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);

  return (
    <View>
      <Text style={styles.blockLabel}>전형요소 반영비율</Text>
      <View style={styles.bar}>
        {bars.map((bar) => (
          <View
            key={bar.key}
            style={{
              flex: bar.value / total,
              backgroundColor: BAR_COLOR[bar.key] ?? palette.border,
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: BAR_COLOR[bar.key] ?? palette.border }]} />
            <Text style={styles.legendText}>
              {bar.label} {bar.value}%
            </Text>
          </View>
        ))}
      </View>
      {note && <Text style={styles.dimSmall}>{note}</Text>}
    </View>
  );
}

/** 몇 배수를 뽑는지가 지원 판단을 가른다. 단계를 접지 않고 그대로 편다. */
function Stages({ notice }: { notice: AdmissionNotice }) {
  const stages = [...notice.stages].sort((a, b) => a.order - b.order);

  return (
    <View>
      <Text style={styles.blockLabel}>단계별 전형</Text>
      {stages.map((stage) => (
        <View key={stage.order} style={styles.stage}>
          <View style={styles.row}>
            <View style={styles.stageNo}>
              <Text style={styles.stageNoText}>{stage.order}단계</Text>
            </View>
            <Text style={styles.stageName}>{stage.name}</Text>
            {stage.multiple && (
              <View style={styles.track}>
                <Text style={styles.trackText}>{stage.multiple}</Text>
              </View>
            )}
            {typeof stage.weight === 'number' && (
              <Text style={styles.stageWeight}>
                {stage.weight === 0 ? '성적 미반영' : `반영 ${stage.weight}%`}
              </Text>
            )}
          </View>
          {(stage.date || stage.evaluates.length > 0) && (
            <Text style={styles.stageMeta}>
              {stage.date}
              {stage.date && stage.evaluates.length > 0 ? ' · ' : ''}
              {stage.evaluates.map((c) => PRACTICAL_LABEL[c] ?? c).join(', ')}
            </Text>
          )}
          {stage.note && <Text style={styles.dimSmall}>{stage.note}</Text>}
        </View>
      ))}
    </View>
  );
}

function PracticalItems({ notice }: { notice: AdmissionNotice }) {
  return (
    <View>
      <Text style={styles.blockLabel}>실기 종목</Text>
      {notice.practical_items.map((item, index) => (
        <View key={`${item.category}-${index}`} style={styles.item}>
          <View style={styles.row}>
            <Text style={styles.itemName}>{PRACTICAL_LABEL[item.category] ?? item.category}</Text>
            {item.label && <Text style={styles.itemLabel}>{item.label}</Text>}
            {item.required === false && <Text style={styles.tag}>선택</Text>}
          </View>
          <Text style={styles.itemMeta}>
            {[
              typeof item.count === 'number' ? `${item.count}편` : null,
              typeof item.time_limit_sec === 'number' ? formatSeconds(item.time_limit_sec) : null,
              typeof item.weight === 'number' ? `${item.weight}%` : null,
              typeof item.stage === 'number' ? `${item.stage}단계` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {item.note && <Text style={styles.dimSmall}>{item.note}</Text>}
        </View>
      ))}
    </View>
  );
}

/**
 * 다녀온 사람들이 남긴 실전 정보. 요강에 없는 것만 담는다 — 대기 시간, 고사장
 * 가는 길처럼 겪어 봐야 아는 것들이다. 후기 글을 옮긴 게 아니라 거기서 확인한
 * 사실을 다시 쓴 것이고, 원문 링크를 함께 줘서 판단은 읽는 사람이 하게 한다.
 */
function TipList({ tips }: { tips: AdmissionTip[] }) {
  return (
    <View style={styles.tipBox}>
      <Text style={styles.sectionTitle}>먼저 다녀온 사람들 이야기</Text>
      <Text style={styles.dimSmall}>
        요강에 없는 것만 모았어요. 개인 후기에서 확인한 내용이라 저희가 검증한 건 아니고,
        해마다 달라질 수 있어요.
      </Text>
      {groupTips(tips).map((group) => (
        <View key={group.category} style={styles.tipGroup}>
          <Text style={styles.tipGroupLabel}>{group.label}</Text>
          {group.items.map((tip, index) => (
            <View key={`${group.category}-${index}`} style={styles.tip}>
              <Text style={styles.tipText}>{tip.text}</Text>
              <View style={styles.row}>
                {typeof tip.corroborations === 'number' && tip.corroborations > 1 && (
                  <View style={styles.track}>
                    <Text style={styles.trackText}>후기 {tip.corroborations}건</Text>
                  </View>
                )}
                {/* 배지는 '누가 썼나'다. 올라와 있는 곳은 host로 따로 밝힌다. */}
                <Text style={styles.tag}>
                  {SOURCE_LABEL[tip.source_type] ?? tip.source_type}
                </Text>
                {tip.host && <Text style={styles.tipHost}>{tip.host}</Text>}
                {tip.source_url && (
                  <Pressable onPress={() => void Linking.openURL(tip.source_url as string)}>
                    <Text style={styles.tipLink}>출처 ↗</Text>
                  </Pressable>
                )}
              </View>
              {tip.note && <Text style={styles.dimSmall}>{tip.note}</Text>}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function ResourceList({ resources }: { resources: AdmissionResource[] }) {
  return (
    <View style={styles.resourceBox}>
      <Text style={styles.sectionTitle}>참고 영상</Text>
      <Text style={styles.dimSmall}>
        합격했다고 밝힌 영상이 섞여 있어요. 본인 주장이라 저희가 확인한 건 아니고, 입시학원 홍보
        영상도 따로 표시해 뒀어요.
      </Text>
      {resources.map((resource) => (
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
  safe: { flex: 1, backgroundColor: palette.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], flexWrap: 'wrap' },
  errorBox: { paddingHorizontal: space.gutter, paddingTop: space[2] },
  list: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10], gap: space[4] },
  uniHead: { gap: space[2] },
  uniName: { ...type.title1, color: palette.text },
  region: { ...type.captionBold, color: palette.textMeta },
  tag: {
    paddingHorizontal: space[2],
    height: 20,
    lineHeight: 20,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
    ...type.micro,
    color: palette.textSub,
  },
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
  card: {
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    gap: space[3],
  },
  track: {
    paddingHorizontal: space[2],
    height: 20,
    borderRadius: radius.full,
    backgroundColor: palette.blueSoft,
    justifyContent: 'center',
  },
  trackText: { ...type.micro, color: palette.blueDeep },
  dept: { ...type.title2, color: palette.text },
  screening: { marginTop: -space[2], ...type.captionBold, color: palette.textSub },
  remain: { marginLeft: 'auto', ...type.micro, color: palette.blueDeep },
  closed: { marginLeft: 'auto', ...type.micro, color: palette.textMeta },
  schedule: { padding: space[4], borderRadius: radius.md, backgroundColor: palette.bgSubtle, gap: 2 },
  fieldRow: { flexDirection: 'row', gap: space[3] },
  fieldLabel: { width: 64, ...type.caption, color: palette.textMeta },
  fieldValue: { flex: 1, ...type.captionBold, color: palette.text },
  bar: { marginTop: space[2], flexDirection: 'row', height: 8, borderRadius: radius.xs, overflow: 'hidden' },
  legend: { marginTop: space[2], flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  legendText: { ...type.captionBold, color: palette.textSub },
  stage: { marginTop: space[2], padding: space[4], borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, gap: space[1.5] },
  stageNo: {
    paddingHorizontal: space[2],
    height: 20,
    borderRadius: radius.full,
    backgroundColor: palette.text,
    justifyContent: 'center',
  },
  stageNoText: { ...type.micro, color: palette.onAccent },
  stageName: { ...type.body2Bold, color: palette.text },
  stageWeight: { marginLeft: 'auto', ...type.captionBold, color: palette.textSub },
  stageMeta: { ...type.caption, color: palette.textSub },
  item: { marginTop: space[2], padding: space[4], borderRadius: radius.md, backgroundColor: palette.bgSubtle, gap: space[1] },
  itemName: { ...type.captionBold, color: palette.text },
  itemLabel: { flex: 1, ...type.caption, color: palette.textSub },
  itemMeta: { ...type.captionBold, color: palette.textSub },
  blockLabel: { ...type.captionBold, color: palette.text },
  blockValue: { marginTop: space[1], ...type.caption, color: palette.textSub },
  sectionTitle: { ...type.body2Bold, color: palette.text },
  resultBox: { padding: space[4], borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, gap: space[1.5] },
  resultLine: { ...type.caption, color: palette.textSub },
  link: { ...type.body2Bold, color: palette.blueDeep },
  dim: { ...type.body2, color: palette.textMeta },
  dimSmall: { ...type.caption, color: palette.textMeta },
  resourceBox: { gap: space[3] },
  tipBox: { gap: space[3] },
  tipGroup: { gap: space[1.5] },
  tipGroupLabel: { ...type.captionBold, color: palette.textSub },
  tip: { padding: space[4], borderRadius: radius.md, backgroundColor: palette.bgSubtle, gap: space[1.5] },
  tipText: { ...type.caption, color: palette.text },
  tipLink: { ...type.micro, color: palette.blueDeep },
  tipHost: { ...type.micro, color: palette.textMeta },
  resource: { padding: space[4], borderRadius: radius.lg, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border, gap: space[2] },
  badge: {
    paddingHorizontal: space[1.5],
    height: 20,
    borderRadius: radius.full,
    backgroundColor: palette.bgSoft,
    justifyContent: 'center',
  },
  badgeOfficial: { backgroundColor: palette.blueSoft },
  badgeAcademy: { backgroundColor: palette.dangerSoft },
  badgeText: { ...type.micro, color: palette.textSub },
  badgeTextOfficial: { color: palette.blueDeep },
  badgeTextAcademy: { color: palette.danger },
  publisher: { flex: 1, ...type.micro, color: palette.textMeta },
  resourceTitle: { ...type.body2Bold, color: palette.text },
  foot: { marginTop: space[2], ...type.caption, color: palette.textMeta },
});
