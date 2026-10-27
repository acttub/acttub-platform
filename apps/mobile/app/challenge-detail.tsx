import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog, type DialogAction } from '@/components/app-dialog';
import { ChallengeLineCard } from '@/components/challenge-line-card';
import { ChallengeNotice } from '@/components/challenge-notice';
import { pt } from '@/components/ui/anchored-menu';
import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { NavIconButton } from '@/components/ui/nav-header';
import { SkeletonDetail, SkeletonRows } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { FoundingBadge } from '@/components/founding-badge';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  canPerform,
  canRetryBrowse,
  dDayLabel,
  detailTitleKey,
  firstBadgeLabel,
  hostLabel,
  isEnded,
  moderationNotice,
  rankEntries,
  rankingNotice,
  ranksHidden,
  type BrowseFailure,
  type RankedEntry,
} from '@/lib/challenge/browse';
import { detailHeader, type DetailMenuItem } from '@/lib/challenge/menu';
import { ChallengeReportSheet } from '@/components/challenge-report-sheet';
import { hasFinishedFirstChallenge } from '@/lib/challenge/intro-state';
import { buildReportBody, reportDoneMessage, reportFailure, reportFailureMessage } from '@/lib/challenge/moderation';
import type { ChallengeDetail, EntrySort, ReportReason } from '@/lib/challenge/types';
import { newRequestId } from '@/lib/request-id';
import { postedAtLabel } from '@/lib/time-label';
import { translate as t } from '@/lib/i18n';

type Ranked = RankedEntry;

/**
 * A17 대사 상세·랭킹(challenge.browse).
 *
 * 좋아요순은 공동 순위이고(좋아요가 같으면 같은 순위, 그 안에서는 최초 공개 시각·id 순),
 * 최신순은 순위 숫자 없이 가장 최근 하나에만 NEW 를 붙인다. 좋아요가 모두 0이면 1위 배지가
 * 없다. 종료된 챌린지는 굳은 값을 보여 주고 확정 전에는 "집계 중"이다. 좋아요 랭킹은 반응 수를
 * 세운 순서이지 연기 점수가 아니다(ADR-005 개정).
 *
 * SOMA-748(5fCfUn): 어두운 대사 카드 → 「다른 배우들」 줄 목록 → 아래 고정 「나도 해 볼래요」. 「팀 시범작」 줄은 서버에 시범작
 * 표시가 없어(C) 그리지 않는다. 파란 안내는 첫 참여를 끝낼 때까지만 보인다.
 */
export default function ChallengeDetailScreen() {
  const router = useRouter();
  const { alert, confirm, sheet, dialog } = useAppDialog();
  const { id, opened } = useLocalSearchParams<{ id?: string; opened?: string }>();
  /** 방금 등록해서 들어왔으면 아래에 토스트를 잠깐 띄운다(C4.7). */
  const [toast, setToast] = useState(opened === '1');
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const [sort, setSort] = useState<EntrySort>('likes');
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [entries, setEntries] = useState<Ranked[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 지금 보이는 정렬. 이어 받는 중에 정렬을 바꾸면 늦게 온 옛 정렬의 결과를 버린다. */
  const shownSort = useRef<EntrySort>('likes');
  const [error, setError] = useState<BrowseFailure | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    void hasFinishedFirstChallenge().then((done) => setShowGuide(!done));
  }, []);

  const load = useCallback(
    async (nextSort: EntrySort) => {
      if (!id) return;
      shownSort.current = nextSort;
      setCursor(null);
      setError(null);
      try {
        const [detail, list] = await Promise.all([
          api.getChallenge(id),
          api.listChallengeEntries(id, { sort: nextSort }),
        ]);
        setChallenge(detail);
        setEntries(rankEntries(list.entries, nextSort));
        setCursor(list.next_cursor);
      } catch (e) {
        setEntries([]);
        setError(browseFailure(e));
      }
    },
    [id],
  );

  /**
   * 20개씩 이어 받는다. 좋아요순은 서버가 첫 조회의 순서를 10분 굳혀 두므로 그대로 붙이고, 기준이 바뀌었거나 오래돼
   * 410 cursor_expired 면 처음부터 다시 읽는다.
   */
  const loadMore = async () => {
    if (!id || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const asked = sort;
      const list = await api.listChallengeEntries(id, { sort: asked, cursor });
      if (shownSort.current !== asked) return;
      setEntries((prev) => [...(prev ?? []), ...rankEntries(list.entries, asked)]);
      setCursor(list.next_cursor);
    } catch (e) {
      if (browseFailure(e).kind === 'cursor_expired') void load(sort);
      else setError(browseFailure(e));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void load(sort);
  }, [load, sort]);

  /** 참여작이 없는 자기 챌린지만 지운다. 지우면 목록·상세에서 사라진다(행은 남는다). */
  const remove = async () => {
    if (!challenge) return;
    const ok = await confirm({
      title: t('challenges.deleteTitle'),
      message: t('challenges.deleteBody'),
      confirmLabel: t('challenges.deleteConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteChallenge(challenge.id);
      logEvent('challenge_deleted', { id: challenge.id });
      router.back();
    } catch (e) {
      const failure = browseFailure(e);
      void alert({
        title: t('challenges.deleteFailTitle'),
        message: failure.kind === 'other' ? t('challenges.deleteHasEntries') : browseFailureMessage(failure),
      });
    }
  };

  /** 부적절한 대사는 챌린지 자체를 신고한다 — 신고가 쌓이면 운영이 본다(즉시 숨기지 않는다). */
  const sendReport = async (reason: ReportReason, note: string) => {
    setReportOpen(false);
    if (!challenge) return;
    try {
      await api.createReport(
        buildReportBody({ requestId: newRequestId(), target: 'challenge', targetId: challenge.id, reason, note }),
      );
      logEvent('challenge_report', { reason, target: 'challenge' });
      void alert({ title: t('videoReport.doneTitle'), message: reportDoneMessage('challenge') });
    } catch (e) {
      void alert({ title: t('videoReport.failTitle'), message: reportFailureMessage(reportFailure(e)) });
    }
  };

  const share = () => {
    if (!challenge) return;
    logEvent('challenge_share', { id: challenge.id });
    void Share.share({ message: t('profileTab.shareText', { name: challenge.work, line: challenge.line }) }).catch(() => {});
  };

  const perform = () => {
    if (!challenge || !canPerform(challenge)) return;
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };

  const ended = challenge ? isEnded(challenge) : false;
  const hideRanks = challenge ? ranksHidden(challenge) : false;
  const notice = challenge ? rankingNotice(challenge) : null;
  const moderation = challenge ? moderationNotice(challenge) : null;
  const header = detailHeader(challenge);
  const menuAction: Record<DetailMenuItem, DialogAction> = {
    share: { label: t('challenges.menuShare'), icon: 'share-2', onPress: share },
    report: { label: t('challenges.menuReport'), icon: 'flag', onPress: () => setReportOpen(true) },
    delete: { label: t('challenges.menuDelete'), icon: 'trash-2', destructive: true, onPress: () => void remove() },
  };
  const openMenu = (e: GestureResponderEvent, items: readonly DetailMenuItem[]) =>
    void sheet({ anchor: pt(e), actions: items.map((item) => menuAction[item]) });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t(detailTitleKey(challenge)),
          headerRight: () =>
            header.kind === 'share' ? (
              <NavIconButton icon="share-2" label={t('challenges.shareA11y')} phLabel="challenge_detail_share" onPress={share} />
            ) : header.kind === 'menu' ? (
              <NavIconButton
                icon="more-horizontal"
                label={t('challenges.moreA11y')}
                phLabel="challenge_detail_more"
                onPress={(e) => openMenu(e, header.items)}
              />
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {!challenge && !error && <SkeletonDetail media lines={3} style={styles.flush} />}
        {error && !canRetryBrowse(error) && <InlineErrorLine message={browseFailureMessage(error)} />}
        {error && canRetryBrowse(error) && (
          <InlineError message={browseFailureMessage(error)} onRetry={() => void load(sort)} />
        )}

        {challenge && (
          <>
            <ChallengeLineCard
              pill={`${challenge.origin === 'team' && challenge.featured_on && !ended ? t('challenges.weekLabel') : hostLabel(challenge)} · ${dDayLabel(challenge)}`}
              line={challenge.line}
              meta={[
                [challenge.work, challenge.character].filter(Boolean).join(' · '),
                challenge.scene_note,
                `${t('challenges.entryCount', { count: challenge.entry_count })} · ${t('challenges.likeSum', { count: challenge.like_sum })}`,
              ]}
            />
            {showGuide && !ended && <Text style={styles.guide}>{t('challenges.detailGuide')}</Text>}

            <AdSlot slot="challenge_detail_top" />

            {!!moderation && <ChallengeNotice message={moderation} tone={challenge.moderation === 'hidden' ? 'danger' : 'amber'} />}
            {!!notice && <ChallengeNotice message={notice} />}

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('challenges.otherActors')}</Text>
              <View style={styles.tabRow}>
                {(
                  [
                    ['likes', 'challenges.tabLikes'],
                    ['latest', 'challenges.tabRecent'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip
                    key={key}
                    label={t(label)}
                    role="radio"
                    selected={sort === key}
                    size="sm"
                    phLabel={`challenge_detail_sort_${key}`}
                    onPress={() => {
                      setSort(key);
                      setEntries(null);
                    }}
                  />
                ))}
              </View>
            </View>

            {entries === null && <SkeletonRows count={3} avatar card={false} style={styles.flush} />}
            {entries?.map((entry) => (
              <Pressable
                key={entry.id}
                style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
                onPress={() =>
                  router.push({ pathname: '/challenge-play', params: { id: challenge.id, entryId: entry.id } })
                }
                accessibilityRole="button">
                <View style={styles.rankCell}>
                  {!hideRanks && entry.displayRank !== null ? (
                    <Text style={styles.rank}>{entry.displayRank}</Text>
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{avatarLetter(entry.author.name)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.entryBody}>
                  <View style={styles.entryHead}>
                    <Text style={styles.author} numberOfLines={1}>
                      {entry.author.name}
                    </Text>
                    <FoundingBadge number={entry.author.founding_number} inline />
                    {entry.isNew && <Text style={styles.newBadge}>{t('challenges.newBadge')}</Text>}
                  </View>
                  <Text style={styles.entryMeta} numberOfLines={1}>
                    {[entry.published_at ? postedAtLabel(entry.published_at) : null, t('challenges.likeSum', { count: entry.like_count })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {!!entry.caption && (
                    <Text style={styles.caption} numberOfLines={2}>
                      {entry.caption}
                    </Text>
                  )}
                  {!hideRanks && entry.showsFirstBadge && (
                    <Text style={styles.firstBadge}>{firstBadgeLabel(entry, ended)}</Text>
                  )}
                </View>
                <Feather name="chevron-right" size={20} color={palette.iconFaint} />
              </Pressable>
            ))}

            {cursor && (
              <Pressable style={styles.moreBtn} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
                {loadingMore ? (
                  <ActivityIndicator color={palette.iconFaint} accessibilityLabel={t('loadingText.loading')} />
                ) : (
                  <Text style={styles.moreText}>{t('challenges.moreEntries')}</Text>
                )}
              </Pressable>
            )}

            {entries !== null && entries.length === 0 && !error && (
              <InlineEmpty title={t('challenges.emptyEntriesTitle')} description={t('challenges.emptyEntriesSub')} />
            )}
          </>
        )}
      </ScrollView>
      {challenge && canPerform(challenge) && (
        <CtaBar safeBottom={false}>
          <PrimaryButton label={t('challenges.performCta')} onPress={perform} />
        </CtaBar>
      )}
      {toast && <Toast message={t('lineNew.doneToast')} bottom={TOAST_ABOVE_CTA} />}
      <ChallengeReportSheet
        visible={reportOpen}
        target="challenge"
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, note) => void sendReport(reason, note)}
      />
      {dialog}
    </SafeAreaView>
  );
}

/** 아래 고정 바(위아래 12 + 버튼 48) 위 12. */
const TOAST_ABOVE_CTA = space[3] * 3 + 48;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  flush: { paddingHorizontal: 0 },
  moreBtn: { alignItems: 'center', paddingVertical: space[3] },
  moreText: { ...type.body2Bold, color: palette.blueDeep },
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[6], gap: space[3] },
  guide: { ...type.body2, color: palette.textSub },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[1] },
  sectionTitle: { ...type.headline, color: palette.text },
  tabRow: { flexDirection: 'row', gap: space[1.5] },
  entry: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[4] },
  rankCell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rank: { ...type.title2, color: palette.blueDeep },
  avatar: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.body2Bold, color: palette.blueDeep },
  entryBody: { flex: 1, minWidth: 0, gap: space[1] },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  author: { ...type.body1Bold, flexShrink: 1, color: palette.text },
  newBadge: { ...type.micro, color: palette.blueDeep },
  entryMeta: { ...type.caption, color: palette.textMeta },
  caption: { ...type.body2, color: palette.textSub },
  firstBadge: {
    ...type.micro,
    alignSelf: 'flex-start',
    color: palette.blueDeep,
    backgroundColor: palette.blueSoft,
    borderRadius: radius.full,
    paddingHorizontal: space[1.5],
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
