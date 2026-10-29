import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardLift } from '@/components/keyboard-lift';
import { Button, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, isEnded } from '@/lib/challenge/browse';
import { canGoPublic, deleteNotice, entryFailure, entryFailureMessage, mosaicNotice } from '@/lib/challenge/entry';
import { CAPTION_MAX, type MyEntriesResponse, type MyEntryCard } from '@/lib/challenge/types';
import { entryStatusLabel, type EntryBucket } from '@/lib/challenge/views';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import type { GestureResponderEvent } from 'react-native';

import { pt } from '@/components/ui/anchored-menu';

/**
 * P03 프로필 챌린지 기록(challenge.browse · challenge.entry).
 *
 * 내 삭제되지 않은 참여작을 한 분류에만 넣어 "전체 · 공개 · 비공개 · 확인 중"으로 센다
 * (우선순위: 확인 중 → 비공개 → 공개). 카드에서 캡션을 고치거나 공개 범위를 바꾸고 참여작을
 * 지울 수 있다 — 지워도 영상은 보관함에 남는다. 다시 공개는 진행 중·정상·파일이 있을 때만 된다.
 */
type Filter = 'all' | EntryBucket;

/**
 * P03 목록을 한 번에 이어 받는 쪽 수의 상한(20개씩, 2,000개). 하루 참여가 셋이라 닿기 어렵지만, 닿으면 목록 끝에 더
 * 있다고 알린다 — 분류 수는 서버가 전체로 세므로 목록과 숫자가 말없이 어긋나지 않게 한다.
 */
const MAX_PAGES = 100;
const NO_COUNTS: MyEntriesResponse['counts'] = { all: 0, public: 0, private: 0, under_review: 0 };

export default function ChallengeEntriesScreen() {
  const router = useRouter();
  const { alert, confirm, sheet, dialog } = useAppDialog();
  const [entries, setEntries] = useState<MyEntryCard[] | null>(null);
  const [serverCounts, setServerCounts] = useState<MyEntriesResponse['counts'] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MyEntryCard | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      // 분류 수는 서버가 전체로 센다. 목록은 20개씩이라 다음 쪽이 있으면 이어 받는다(하루 3개 참여라 길지 않다).
      const first = await api.listMyChallengeEntries();
      const all = [...first.entries];
      let cursor = first.next_cursor;
      for (let page = 1; cursor && page < MAX_PAGES; page += 1) {
        const next = await api.listMyChallengeEntries(undefined, cursor);
        all.push(...next.entries);
        cursor = next.next_cursor;
      }
      setEntries(all);
      setServerCounts(first.counts);
      setTruncated(Boolean(cursor));
    } catch (e) {
      setEntries([]);
      setError(browseFailureMessage(browseFailure(e)));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const counts = serverCounts ?? NO_COUNTS;
  const visible = (entries ?? []).filter((entry) => entry.status !== 'deleted');
  const shown = filter === 'all' ? visible : visible.filter((entry) => entry.category === filter);

  const saveCaption = async () => {
    if (!editing) return;
    try {
      await api.updateEntry(editing.id, { caption: draft.trim() });
      setEditing(null);
      void alert({ title: t('challengeEntries.captionSaved') });
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.captionFailTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  const toggleVisibility = async (entry: MyEntryCard) => {
    const next = entry.visibility === 'public' ? 'private' : 'public';
    // 공개로 바꿀 때는 한 번 묻는다(SOMA-748 Avv5P0). 비공개로 돌리는 것은 바로 한다.
    let faceMosaic: boolean | undefined;
    if (next === 'public') {
      const ok = await confirm({
        title: t('challengeEntries.publicTitle'),
        message: t('challengeEntries.publicBody'),
        confirmLabel: t('challengeEntries.publicConfirm'),
      });
      if (!ok) return;
      // 모자이크를 아직 켜지 않았으면 공개하면서 켤지 고른다(SOMA-809). 창을 닫거나 취소하면 공개하지 않는다.
      if (!entry.face_mosaic) {
        // 공개 범위·얼굴 노출을 정하는 중요한 결정이라 가운데 팝업으로 묻고, 두 버튼으로만 답한다(locked).
        const choice = await confirm({
          title: t('challengeEntries.mosaicAskTitle'),
          confirmLabel: t('challengeEntries.mosaicAskConfirm'),
          cancelLabel: t('challengeEntries.mosaicAskSkip'),
          locked: true,
        });
        faceMosaic = choice || undefined;
      }
    }
    try {
      await api.updateEntry(entry.id, faceMosaic ? { visibility: next, face_mosaic: true } : { visibility: next });
      logEvent('challenge_entry_visibility', { to: next });
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.visibilityFailTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  /** 얼굴 모자이크를 켜거나(실패했으면 다시 만들기) 끈다. 끄면 공개 참여작은 원본이 보이므로 한 번 묻는다. */
  const toggleMosaic = async (entry: MyEntryCard) => {
    const on = !entry.face_mosaic || entry.mosaic_status === 'failed';
    if (!on) {
      const ok = await confirm({
        title: t('challengeEntries.mosaicOffTitle'),
        message: t('challengeEntries.mosaicOffBody'),
        confirmLabel: t('challengeEntries.mosaicOff'),
      });
      if (!ok) return;
    }
    try {
      await api.updateEntry(entry.id, { face_mosaic: on });
      void logEvent('challenge_entry_face_mosaic', { on });
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.mosaicFailTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  const remove = async (entry: MyEntryCard) => {
    const ok = await confirm({
      title: t('challengeUpload.deleteTitle'),
      message: deleteNotice(),
      confirmLabel: t('challengeUpload.deleteConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteEntry(entry.id);
      logEvent('challenge_entry_deleted', {});
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.deleteFailTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  const openMenu = (entry: MyEntryCard, e?: GestureResponderEvent) => {
    // 다시 공개는 진행 중·정상·파일이 남아 있을 때만 된다. 아니면 서버가 422 로 막는다.
    const canPublish = canGoPublic({
      status: entry.status,
      challengeEnded: isEnded({ ends_at: entry.challenge.ends_at }),
      videoPurged: entry.playback_url === null,
    });
    void sheet({
      anchor: pt(e),
      actions: [
        {
          label: t('challengeUpload.editCaption'),
          onPress: () => {
            setEditing(entry);
            setDraft(entry.caption ?? '');
          },
        },
        {
          label: t(entry.visibility === 'public' ? 'challengeUpload.makePrivate' : 'challengeUpload.makePublic'),
          onPress: () => {
            if (entry.visibility === 'private' && !canPublish) {
              void alert({
                title: t('challengeEntries.cannotPublishTitle'),
                message:
                  entry.status !== 'visible'
                    ? t('challengeUpload.errHidden')
                    : entry.playback_url === null
                      ? t('challengeUpload.errVideoNotReady')
                      : t('challengeUpload.errClosed'),
              });
              return;
            }
            void toggleVisibility(entry);
          },
        },
        {
          label: t(
            !entry.face_mosaic
              ? 'challengeEntries.mosaicOn'
              : entry.mosaic_status === 'failed'
                ? 'challengeEntries.mosaicRetry'
                : 'challengeEntries.mosaicOff',
          ),
          onPress: () => void toggleMosaic(entry),
        },
        { label: t('challengeUpload.deleteConfirm'), destructive: true, onPress: () => void remove(entry) },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardLift>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('challengeEntries.title')}
        left={<NavIconButton icon="chevron-left" label={t('common.back')} phLabel="challenge_entries_back" onPress={() => router.back()} />}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
        {(
          [
            ['all', t('challengeEntries.tabAll', { count: counts.all })],
            ['public', t('challengeEntries.tabPublic', { count: counts.public })],
            ['private', t('challengeEntries.tabPrivate', { count: counts.private })],
            ['under_review', t('challengeEntries.tabReview', { count: counts.under_review })],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            label={label}
            role="radio"
            selected={filter === key}
            size="sm"
            phLabel={`challenge_entries_filter_${key}`}
            onPress={() => setFilter(key)}
          />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body}>
        {entries === null && !error && <SkeletonRows count={4} avatar style={styles.flush} />}
        {!!error && <InlineError message={error} onRetry={() => void load()} />}
        {entries !== null && shown.length === 0 && !error && (
          <InlineEmpty title={t('challengeEntries.emptyTitle')} description={t('challengeEntries.emptySub')} />
        )}

        {shown.map((entry) => (
          <Pressable
            key={entry.id}
            style={styles.row}
            onPress={() => router.push({ pathname: '/challenge-play', params: { id: entry.challenge.id, entryId: entry.id } })}
            onLongPress={(e) => openMenu(entry, e)}
            accessibilityRole="button">
            {/* 첫 장면 사진(SOMA-845). 아직 없거나 파기된 영상은 아이콘. */}
            <View style={styles.thumb}>
              {entry.poster_url ? (
                <Image
                  testID={`entry-poster-${entry.id}`}
                  source={{ uri: entry.poster_url, cacheKey: entry.poster_url.split('?')[0] }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <Feather testID={`entry-poster-empty-${entry.id}`} name="video" size={20} color={palette.blue} />
              )}
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowLine} numberOfLines={1}>
                “{entry.challenge.line}”
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[entry.challenge.work, entry.challenge.character].filter(Boolean).join(' · ')} ·{' '}
                {formatKoreanDate(entry.created_at, { month: 'long', day: 'numeric' })}
              </Text>
              <Text style={styles.rowStatus}>{entryStatusLabel(entry)}</Text>
              {mosaicNotice(entry) && (
                <Text style={styles.rowStatus}>
                  {t(mosaicNotice(entry) === 'pending' ? 'challengeEntries.mosaicPending' : 'challengeEntries.mosaicFailed')}
                </Text>
              )}
            </View>
            <Pressable onPress={(e) => openMenu(entry, e)} hitSlop={10} accessibilityRole="button" ph-label="challenge_entries_more">
              <Feather name="more-horizontal" size={20} color={palette.iconFaint} />
            </Pressable>
          </Pressable>
        ))}
        {truncated && <Text style={styles.truncated}>{t('challengeEntries.truncated')}</Text>}
      </ScrollView>

      {/* 캡션 편집 줄은 스크롤 밖 형제라 KeyboardLift 가 비운 만큼 키보드 위로 올라온다(키보드에 가리던 문제). */}
      {editing && (
        <View style={styles.editor}>
          <TextField
            label={t('challengeEntries.captionTitle')}
            value={draft}
            onChangeText={setDraft}
            maxLength={CAPTION_MAX}
            multiline
            autoFocus
            style={styles.editorInput}
          />
          <View style={styles.editorRow}>
            <TextButton label={t('common.cancel')} onPress={() => setEditing(null)} />
            <Button size="md" label={t('common.save')} onPress={() => void saveCaption()} style={styles.editorSave} />
          </View>
        </View>
      )}
      </KeyboardLift>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flush: { paddingHorizontal: 0 },
  tabsScroll: { flexGrow: 0 },
  tabs: { gap: space[1.5], paddingHorizontal: space.gutter, paddingVertical: space[3] },
  body: { paddingHorizontal: space.gutter, paddingBottom: space[10] },
  truncated: { ...type.caption, color: palette.textMeta, textAlign: 'center', paddingVertical: space[6] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  thumb: {
    width: 64,
    aspectRatio: 9 / 16,
    borderRadius: radius.sm,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowBody: { flex: 1, gap: space[1] },
  rowLine: { ...type.body1Bold, color: palette.text },
  rowMeta: { ...type.caption, color: palette.textMeta },
  rowStatus: { ...type.captionBold, color: palette.textMeta },
  editor: {
    backgroundColor: palette.bg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: space.gutter,
    paddingVertical: space[3],
    gap: space[3],
  },
  editorInput: { minHeight: 80, paddingTop: space[3], textAlignVertical: 'top' },
  editorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2] },
  editorSave: { paddingHorizontal: space[5] },
});
