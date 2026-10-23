import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  canDelete,
  canPerform,
  dDayLabel,
  detailTitleKey,
  firstBadgeLabel,
  hostLabel,
  isEnded,
  moderationNotice,
  rankEntries,
  rankingNotice,
  ranksHidden,
  type RankedEntry,
} from '@/lib/challenge/browse';
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
  const { alert, confirm, dialog } = useAppDialog();
  const { id, opened } = useLocalSearchParams<{ id?: string; opened?: string }>();
  /** 방금 등록해서 들어왔으면 아래에 어두운 안내줄을 잠깐 띄운다(C4.7). */
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
  const [error, setError] = useState<string | null>(null);
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
        const failure = browseFailure(e);
        setEntries([]);
        setError(browseFailureMessage(failure));
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
      else setError(browseFailureMessage(browseFailure(e)));
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
        title: t('challenges.deleteTitle'),
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
      void alert({ title: t('videoReport.titleChallenge'), message: reportFailureMessage(reportFailure(e)) });
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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t(detailTitleKey(challenge)),
          headerRight: () => (
            <View style={styles.headerRight}>
              {challenge && !canDelete(challenge) && (
                <NavIconButton
                  icon="flag"
                  size={19}
                  color={palette.textDim}
                  label={t('challenges.reportA11y')}
                  phLabel="challenge_detail_report"
                  onPress={() => setReportOpen(true)}
                />
              )}
              {challenge && canDelete(challenge) && (
                <NavIconButton
                  icon="trash-2"
                  size={19}
                  color={palette.textDim}
                  label={t('challenges.deleteA11y')}
                  phLabel="challenge_detail_delete"
                  onPress={() => void remove()}
                />
              )}
              <NavIconButton
                icon="share-2"
                size={20}
                color={palette.textDim}
                label={t('challenges.shareA11y')}
                phLabel="challenge_detail_share"
                onPress={share}
              />
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {!challenge && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {challenge && (
          <>
            <View style={styles.lineCard}>
              <View style={styles.chip}>
                <Feather name="zap" size={15} color={palette.onAccent} />
                <Text style={styles.chipText}>
                  {challenge.origin === 'team' && challenge.featured_on && !ended ? t('challenges.weekLabel') : hostLabel(challenge)} ·{' '}
                  {dDayLabel(challenge)}
                </Text>
              </View>
              <Text style={styles.line}>“{challenge.line}”</Text>
              {!!(challenge.work || challenge.character) && (
                <Text style={styles.work}>{[challenge.work, challenge.character].filter(Boolean).join(' · ')}</Text>
              )}
              {!!challenge.scene_note && <Text style={styles.note}>{challenge.scene_note}</Text>}
              <Text style={styles.stat}>
                {t('challenges.entryCount', { count: challenge.entry_count })} ·{' '}
                {t('challenges.likeSum', { count: challenge.like_sum })}
              </Text>
              {showGuide && !ended && <Text style={styles.guide}>{t('challenges.detailGuide')}</Text>}
            </View>

            {!!moderation && <Text style={styles.notice}>{moderation}</Text>}
            {!!notice && <Text style={styles.notice}>{notice}</Text>}

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('challenges.otherActors')}</Text>
              <View style={styles.tabRow}>
                {(
                  [
                    ['likes', 'challenges.tabLikes'],
                    ['latest', 'challenges.tabRecent'],
                  ] as const
                ).map(([key, label]) => (
                  <Pressable
                    key={key}
                    hitSlop={6}
                    onPress={() => {
                      setSort(key);
                      setEntries(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sort === key }}>
                    <Text style={[styles.tabText, sort === key && styles.tabTextOn]}>{t(label)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {entries === null && <ActivityIndicator color={palette.blue} style={{ marginTop: 24 }} />}
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
                <Feather name="chevron-right" size={20} color={palette.textFaint} />
              </Pressable>
            ))}

            {cursor && (
              <Pressable style={styles.moreBtn} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
                {loadingMore ? (
                  <ActivityIndicator color={palette.blue} />
                ) : (
                  <Text style={styles.moreText}>{t('challenges.moreEntries')}</Text>
                )}
              </Pressable>
            )}

            {entries !== null && entries.length === 0 && !error && (
              <Text style={styles.empty}>{t('challenges.emptyEntries')}</Text>
            )}
          </>
        )}
      </ScrollView>
      {challenge && canPerform(challenge) && (
        <CtaBar safeBottom={false}>
          <PrimaryButton label={t('challenges.performCta')} onPress={perform} />
        </CtaBar>
      )}
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{t('lineNew.doneToast')}</Text>
        </View>
      )}
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

const styles = StyleSheet.create({
  toast: { position: 'absolute', left: 24, right: 24, bottom: 96, backgroundColor: palette.navy, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18 },
  toastText: { fontSize: 14.5, fontWeight: '700', color: palette.onAccent },
  pressed: { opacity: 0.85 },
  moreBtn: { alignItems: 'center', paddingVertical: 14 },
  moreText: { color: palette.blue, fontSize: 14, fontWeight: '600' },
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 14 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  lineCard: { backgroundColor: palette.navy, borderRadius: 20, padding: 18, gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: '800', color: palette.onAccent },
  line: { fontSize: 18, fontWeight: '800', color: palette.onAccent, lineHeight: 27 },
  work: { fontSize: 13, fontWeight: '600', color: 'rgba(255, 255, 255, 0.67)', lineHeight: 20 },
  note: { fontSize: 12.5, color: 'rgba(255, 255, 255, 0.67)', lineHeight: 19 },
  stat: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255, 255, 255, 0.67)' },
  guide: { fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 21 },
  notice: { fontSize: 12.5, fontWeight: '700', color: palette.amber, paddingVertical: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  tabRow: { flexDirection: 'row', gap: 12 },
  tabText: { fontSize: 13, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { fontWeight: '800', color: palette.text },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 4, borderRadius: 16 },
  rankCell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rank: { fontSize: 17, fontWeight: '900', color: palette.blue },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '900', color: palette.blueDeep },
  entryBody: { flex: 1, minWidth: 0, gap: 6 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: palette.text, lineHeight: 24 },
  newBadge: { fontSize: 10.5, fontWeight: '900', color: palette.blue },
  entryMeta: { fontSize: 13, fontWeight: '600', color: palette.textFaint, lineHeight: 20 },
  caption: { fontSize: 13, color: palette.textMuted, lineHeight: 19 },
  firstBadge: { fontSize: 12, fontWeight: '800', color: palette.blueDeep },
  empty: { fontSize: 14, color: palette.textDim, textAlign: 'center', paddingVertical: 40, lineHeight: 22 },
});
