import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HomeUploadCard } from '@/components/home-upload-card';
import { PracticeProgressDots } from '@/components/practice-progress-dots';
import { InlineError } from '@/components/ui/inline-error';
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { MASCOT } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useNextTakes } from '@/hooks/use-next-takes';
import { useWaitingUpload } from '@/hooks/use-waiting-upload';
import { dateLocale, translate as t } from '@/lib/i18n';
import { coachingEntry } from '@/lib/practice/coaching-entry';
import { groupTagLabels, groupVideoDuration, practiceProgress } from '@/lib/practice/coaching-progress';
import { groupPoster, groupRowTarget, recentGroups, sceneTitle } from '@/lib/practice/groups';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroup } from '@/lib/practice/types';
import { rememberSkeletonHints, useSkeletonHints } from '@/lib/skeleton-hint';

/** 「최근 코칭」에 보이는 묶음 수(pen P13.3). */
const RECENT_COUNT = 2;

function shortDate(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/**
 * 연습 탭 한 페이지의 코칭 구역(예전 코칭 탭의 「다음 연습」 화면, pen P13.3·P13.4·P13.5) — 내 대본 목록 아래에 둔다.
 * 묶음 받기는 연습 탭(components/practice/reading-pane)이 맡고 여기는 그리기만 한다.
 *
 * 위에서부터: 영상 올리는 중 카드(있을 때) → 저번 코치 메모 또는 하던 코칭 카드 → 「다른 방법으로 코칭 받기」 → 최근 코칭 몇 줄과
 * 「연습 기록」 바로가기. 「새 영상으로 코칭 받기」 타일은 맨 위 단계 칸 ③과 겹쳐 뺐다.
 * 코칭을 한 번도 안 했으면(노트 있는 묶음 없음) 올리는 중 카드만 남는다 — 코칭 시작은 단계 칸 ③이 맡는다.
 *
 * 장면 카드의 진행 점과 최근 코칭 줄의 태그·영상 길이는 서버가 값을 줄 때만 그린다(SOMA-810).
 */
export default function CoachingSection({ groups, failed, onRetry }: { groups: PracticeGroup[] | null; failed: boolean; onRetry: () => void }) {
  const router = useRouter();
  const waitingUpload = useWaitingUpload();
  const entry = useMemo(() => (groups ? coachingEntry(groups) : null), [groups]);
  const takes = useNextTakes([entry?.kind === 'next' ? entry.notePracticeId : null]);
  const nextTake = entry?.kind === 'next' ? (takes[entry.notePracticeId] ?? null) : null;
  const visible = useMemo(() => recentGroups(groups ?? [], groups?.length ?? 0), [groups]);

  // 받기 전 모양은 이 기기에서 지난번에 실제로 그린 모양(lib/skeleton-hint)을 따른다 — 코칭 구역이 있었으면 같은 틀의 뼈대.
  const skeletonHints = useSkeletonHints();
  useEffect(() => {
    if (!entry || failed) return;
    rememberSkeletonHints(
      entry.kind === 'first' ? { coaching: 'first' } : { coaching: 'next', coachingRows: Math.min(RECENT_COUNT, visible.length) },
    );
  }, [entry, failed, visible.length]);

  // 「하던 코칭 · 이어서 하기」는 열린 대화로, 「저번 코치 메모 · 한 번 더 연습」은 열린 대화가 있으면 그 대화, 없으면 다음 테이크(새 영상)로 간다.
  const again = () => {
    if (entry?.kind === 'resume') {
      const open = entry.group.in_progress_practice_id;
      if (open) router.push({ pathname: '/coach', params: { practiceId: open } });
      return;
    }
    if (entry?.kind !== 'next') return;
    const action = continueActionFor(entry.group);
    if (action.kind === 'resume') {
      router.push({ pathname: '/coach', params: { practiceId: action.practiceId } });
      return;
    }
    const last = entry.group.practices[entry.group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: entry.group.root_id, practiceId: last?.id ?? entry.group.root_id });
    router.push('/upload');
  };
  const resuming = entry?.kind === 'resume';
  const noteAt =
    entry?.kind === 'next'
      ? (entry.group.practices.find((p) => p.id === entry.notePracticeId)?.created_at ?? entry.group.last_practiced_at)
      : null;
  const progress = entry && entry.kind !== 'first' ? practiceProgress(entry.group) : null;

  return (
    <View style={styles.section} testID="practice-coaching">
      {/* 영상을 올리는 중이면 그 카드(예전 홈 맨 위, SOMA-1120) — 없으면 그리지 않는다. */}
      <HomeUploadCard upload={waitingUpload} />
      {failed && !groups ? (
        <InlineError message={t('history.loadFail')} onRetry={onRetry} />
      ) : !groups ? (
        skeletonHints.coaching === 'next' ? <CoachingSkeleton rows={skeletonHints.coachingRows ?? RECENT_COUNT} /> : null
      ) : entry && entry.kind !== 'first' ? (
        <>
          {/* 저번 코치 메모(노트의 다음 테이크 문장) 또는 하던 코칭 — 카드 전체를 누른다(UX 가이드 5절, 10/23). */}
          <Pressable
            onPress={again}
            accessibilityRole="button"
            accessibilityLabel={t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}
            ph-label={resuming ? 'coaching_resume' : 'coaching_again'}
            style={({ pressed }) => [styles.memo, pressed && styles.pressed]}>
            <View style={styles.memoHead}>
              <View style={styles.memoAvatar}>
                <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              </View>
              <View style={styles.flex}>
                <Text style={styles.memoKind}>{t(resuming ? 'coachingTab.resumeKind' : 'coachingTab.memoKind')}</Text>
                <Text style={styles.memoMeta} numberOfLines={1}>
                  {[shortDate(resuming ? entry.group.last_practiced_at : noteAt), sceneTitle(entry.group)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            {progress && <PracticeProgressDots progress={progress} />}
            {resuming || nextTake ? (
              <View style={styles.quote}>
                {/* 하던 코칭에는 「다음엔 이렇게 해 봐요」 제목을 붙이지 않는다 — 아래 문장은 조언이 아니라 상태 안내다(10/26). */}
                {!resuming && <Text style={styles.quoteLabel}>{t('coachingTab.memoNext')}</Text>}
                <Text style={styles.quoteText}>{resuming ? t('coachingTab.resumeBody') : nextTake}</Text>
              </View>
            ) : null}
            <View style={styles.memoFooter}>
              <View style={styles.againBtn}>
                <Text style={styles.againText}>{t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}</Text>
                <Feather name="arrow-right" size={15} color={palette.blueDeep} />
              </View>
            </View>
          </Pressable>

          <View style={styles.tiles}>
            <Tile
              icon="message-circle"
              title={t('coachingTab.otherWaysTile')}
              sub={t('coachingTab.otherWaysSub')}
              phLabel="coaching_other_ways"
              onPress={() => router.push('/coach-other')}
            />
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
            <Pressable
              onPress={() => router.push('/history')}
              accessibilityRole="button"
              accessibilityLabel={t('coachingTab.historyLinkA11y')}
              ph-label="coaching_history"
              hitSlop={8}
              style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]}>
              <Text style={styles.historyLinkText}>{t('coachingTab.historyLink')}</Text>
              <Feather name="chevron-right" size={16} color={palette.iconFaint} />
            </Pressable>
          </View>
          <View style={styles.recent}>
            {visible.slice(0, RECENT_COUNT).map((g) => {
              const poster = groupPoster(g);
              const tags = groupTagLabels(g);
              const duration = groupVideoDuration(g);
              return (
                <Pressable key={g.root_id} onPress={() => router.push(groupRowTarget(g))} accessibilityRole="button" style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
                  <View style={styles.thumb}>
                    {poster ? <Image source={{ uri: poster.uri, cacheKey: poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
                    <View style={styles.play}>
                      <Feather name="play" size={11} color={palette.onAccent} />
                    </View>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.recentTitle} numberOfLines={1}>{sceneTitle(g)}</Text>
                    <View style={styles.recentMetaRow}>
                      <Text style={styles.recentMeta}>{shortDate(g.last_practiced_at)}</Text>
                      {duration && (
                        <Text style={styles.recentMeta} accessibilityLabel={t('coachingTab.durationA11y', { d: duration })} testID="coaching-recent-duration">
                          {duration}
                        </Text>
                      )}
                      {tags.map((label) => (
                        <Text key={label} style={styles.recentTag} testID="coaching-recent-tag">{label}</Text>
                      ))}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** 코칭 구역 뼈대 — 메모 카드·「다른 방법」 타일·최근 코칭 순서와 높이를 실제와 같게 둔다. */
function CoachingSkeleton({ rows }: { rows: number }) {
  return (
    <SkeletonGroup>
      <View style={styles.memo}>
        <View style={styles.memoHead}>
          <View style={styles.memoAvatar}>
            <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          </View>
          <View style={styles.flex}>
            <SkeletonLine size={type.body2Bold} width="34%" />
            <SkeletonLine size={type.caption} width="46%" />
          </View>
        </View>
        <View style={styles.memoFooter}>
          <SkeletonLine size={type.body2Bold} width={88} />
        </View>
      </View>
      <View style={styles.tiles}>
        <SkeletonBlock height={125} radius={radius.lg} style={styles.flex} />
      </View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
        <SkeletonLine size={type.caption} width={52} />
      </View>
      <View style={styles.recent}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={styles.recentRow}>
            <SkeletonBlock width={44} height={44} radius={radius.sm} />
            <View style={styles.flex}>
              <SkeletonLine size={type.body2Bold} width={i === 0 ? '36%' : '44%'} />
              <SkeletonLine size={type.caption} width="22%" style={{ marginTop: 2 }} />
            </View>
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** 「다른 방법으로 코칭 받기」 타일 — 아이콘 22 + 오른쪽 위 화살표, 제목 16/700, 보조 12.5. */
function Tile({
  icon,
  title,
  sub,
  phLabel,
  onPress,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  phLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title.replace('\n', ' ')}
      ph-label={phLabel}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.tileTop}>
        <Feather name={icon} size={22} color={palette.text} />
        <Feather name="arrow-up-right" size={16} color={palette.iconFaint} />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space[2] },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  // 저번 코치 메모 카드(흰 카드 + bg-subtle 인용) → 타일 → 최근 코칭.
  memo: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  memoHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  memoAvatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  memoMascot: { width: 26, height: 30 },
  memoKind: { ...type.body2Bold, color: palette.text },
  memoMeta: { ...type.caption, color: palette.textMeta },
  quote: { gap: space[1], padding: space[3], borderRadius: radius.md, backgroundColor: palette.bgSubtle },
  quoteLabel: { ...type.micro, color: palette.blueDeep },
  quoteText: { ...type.body1, color: palette.text },
  memoFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  againBtn: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  againText: { ...type.body2Bold, color: palette.blueDeep },
  tiles: { flexDirection: 'row', gap: space[2], paddingTop: space[3] },
  tile: { flex: 1, gap: space[2], padding: space[3], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileText: { gap: space[1] },
  tileTitle: { ...type.body1Bold, color: palette.text },
  tileSub: { ...type.micro, color: palette.textMeta },
  // Button/Text — 알약 바탕 없는 보조 글자 버튼.
  historyLink: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  historyLinkText: { ...type.body2Bold, color: palette.textSub },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[6] },
  sectionTitle: { ...type.headline, color: palette.text },
  recent: { paddingTop: space[3], gap: space[3] },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  play: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { ...type.body2Bold, color: palette.text },
  recentMetaRow: { marginTop: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1.5] },
  recentMeta: { ...type.caption, color: palette.textMeta },
  // 태그 칩 — 공지 상세 배지(app/notice-detail)와 같은 blue-soft 알약(micro).
  recentTag: { overflow: 'hidden', backgroundColor: palette.blueSoft, color: palette.blueDeep, borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: 2, ...type.micro },
});
