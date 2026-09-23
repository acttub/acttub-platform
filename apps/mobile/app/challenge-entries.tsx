import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, isEnded } from '@/lib/challenge/browse';
import { canGoPublic, deleteNotice, entryFailure, entryFailureMessage } from '@/lib/challenge/entry';
import { CAPTION_MAX, type MyEntriesResponse, type MyEntryCard } from '@/lib/challenge/types';
import { bucketOf, entryCounts, entryStatusLabel, type EntryBucket } from '@/lib/challenge/views';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';

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

  const counts = serverCounts ?? entryCounts(entries ?? []);
  const visible = (entries ?? []).filter((entry) => entry.status !== 'deleted');
  const shown = filter === 'all' ? visible : visible.filter((entry) => bucketOf(entry) === filter);

  const saveCaption = async () => {
    if (!editing) return;
    try {
      await api.updateEntry(editing.id, { caption: draft.trim() });
      setEditing(null);
      void alert({ title: t('challengeEntries.captionTitle'), message: t('challengeEntries.captionSaved') });
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.captionTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  const toggleVisibility = async (entry: MyEntryCard) => {
    const next = entry.visibility === 'public' ? 'private' : 'public';
    try {
      await api.updateEntry(entry.id, { visibility: next });
      logEvent('challenge_entry_visibility', { to: next });
      void load();
    } catch (e) {
      void alert({ title: t('challengeEntries.menuTitle'), message: entryFailureMessage(entryFailure(e)) });
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
      void alert({ title: t('challengeUpload.deleteTitle'), message: entryFailureMessage(entryFailure(e)) });
    }
  };

  const openMenu = (entry: MyEntryCard) => {
    // 다시 공개는 진행 중·정상·파일이 남아 있을 때만 된다. 아니면 서버가 422 로 막는다.
    const canPublish = canGoPublic({
      status: entry.status,
      challengeEnded: isEnded({ ends_at: entry.challenge.ends_at }),
      videoPurged: entry.playback_url === null,
    });
    void sheet({
      title: t('challengeEntries.menuTitle'),
      actions: [
        {
          label: t('aiReport.title'),
          onPress: () => router.push({ pathname: '/ai-report', params: { entryId: entry.id } }),
        },
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
                title: t('challengeEntries.menuTitle'),
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
        { label: t('challengeUpload.deleteConfirm'), destructive: true, onPress: () => void remove(entry) },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('challengeEntries.title')}</Text>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['all', t('challengeEntries.tabAll', { count: counts.all })],
            ['public', t('challengeEntries.tabPublic', { count: counts.public })],
            ['private', t('challengeEntries.tabPrivate', { count: counts.private })],
            ['under_review', t('challengeEntries.tabReview', { count: counts.under_review })],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, filter === key && styles.tabOn]}
            onPress={() => setFilter(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === key }}>
            <Text style={[styles.tabText, filter === key && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {entries === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 32 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {entries !== null && shown.length === 0 && !error && <Text style={styles.empty}>{t('challengeEntries.empty')}</Text>}

        {shown.map((entry) => (
          <Pressable
            key={entry.id}
            style={styles.row}
            onPress={() => router.push({ pathname: '/challenge-play', params: { id: entry.challenge.id, entryId: entry.id } })}
            onLongPress={() => openMenu(entry)}
            accessibilityRole="button">
            <View style={styles.rowBody}>
              <Text style={styles.rowLine} numberOfLines={1}>
                “{entry.challenge.line}”
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[entry.challenge.work, entry.challenge.character].filter(Boolean).join(' · ')} ·{' '}
                {formatKoreanDate(entry.created_at, { month: 'long', day: 'numeric' })}
              </Text>
              <Text style={styles.rowStatus}>{entryStatusLabel(entry)}</Text>
            </View>
            <Pressable onPress={() => openMenu(entry)} hitSlop={10} accessibilityRole="button">
              <Feather name="more-horizontal" size={20} color={palette.textFaint} />
            </Pressable>
          </Pressable>
        ))}
        {truncated && <Text style={styles.empty}>{t('challengeEntries.truncated')}</Text>}
      </ScrollView>

      {editing && (
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>{t('challengeEntries.captionTitle')}</Text>
          <TextInput
            style={styles.editorInput}
            value={draft}
            onChangeText={setDraft}
            maxLength={CAPTION_MAX}
            multiline
            autoFocus
          />
          <View style={styles.editorRow}>
            <Pressable onPress={() => setEditing(null)} accessibilityRole="button">
              <Text style={styles.editorCancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.editorSave} onPress={() => void saveCaption()} accessibilityRole="button">
              <Text style={styles.editorSaveText}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  tab: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12, paddingVertical: 7 },
  tabOn: { backgroundColor: palette.text, borderColor: palette.text },
  tabText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  tabTextOn: { color: '#FFFFFF' },
  body: { padding: 16, paddingBottom: 60 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', paddingVertical: 16, textAlign: 'center' },
  empty: { color: palette.textDim, fontSize: 14.5, textAlign: 'center', paddingVertical: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  rowBody: { flex: 1, gap: 4 },
  rowLine: { fontSize: 15, fontWeight: '700', color: palette.text },
  rowMeta: { fontSize: 12, color: palette.textFaint },
  rowStatus: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  editor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.bg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    padding: 16,
    gap: 10,
  },
  editorLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  editorInput: {
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
    padding: 12,
    fontSize: 14,
    color: palette.text,
    textAlignVertical: 'top',
  },
  editorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  editorCancel: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  editorSave: { backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  editorSaveText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
