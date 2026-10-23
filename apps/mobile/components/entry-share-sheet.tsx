import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  canSaveVideo,
  hasShareOptions,
  prepareVideoFile,
  shareFailureKind,
  shareFailureMessage,
  shareMessage,
  shareTargets,
  storyRoute,
  threadsIntentUrl,
  type ShareContext,
  type ShareTarget,
} from '@/lib/challenge/share';
import {
  copyText,
  instagramStoreUrl,
  isInstagramInstalled,
  openSystemShare,
  openSystemShareWithVideo,
  openUrl,
  saveVideoToLibrary,
  shareVideoToInstagramStory,
  videoDeps,
} from '@/lib/challenge/share-native';
import type { EntryCard } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * 참여작 공유 시트(SOMA-819, pen ⑩ 「공유 시트 · SNS에 공유하기」) — 흰 시트 모서리 위 24, 손잡이, 제목 19/800,
 * 미리보기 줄(제목 대사 · 지은이 · 링크), 공유 대상 원 5개(인스타·카카오톡·스레드·링크 복사·더 보기), 「영상으로 저장」.
 * 어떤 대상이 열리는지는 `lib/challenge/share.ts` 의 규칙을 따른다(영상은 내 것만, 링크는 공개된 것만).
 * 영상은 재생 주소에서 받는 동안 「영상을 준비하고 있어요…」를 보이고, 실패하면 안내 문구를 시트 안에 둔다.
 */
export type ShareSheetEntry = ShareContext & { id: string; authorName: string };

export function toShareEntry(card: Pick<EntryCard, 'id' | 'is_mine' | 'published_at' | 'playback_url'> & { author: { name: string } }): ShareSheetEntry {
  return {
    id: card.id,
    is_mine: card.is_mine,
    published_at: card.published_at,
    playback_url: card.playback_url,
    authorName: card.author.name,
  };
}

/**
 * 공유 시트를 여는 훅. 카드가 있으면 `open(card)`, 참여작 id 만 있으면 `openById(id)`(서버에서 받아 연다).
 * 공유할 길이 하나도 없거나 불러오지 못하면 `onUnavailable` 로 알린다.
 */
export function useEntryShare(line: string, onUnavailable: () => void) {
  const [entry, setEntry] = useState<ShareSheetEntry | null>(null);
  const [visible, setVisible] = useState(false);
  const open = (card: Parameters<typeof toShareEntry>[0]) => {
    const next = toShareEntry(card);
    if (!hasShareOptions(next)) {
      onUnavailable();
      return;
    }
    setEntry(next);
    setVisible(true);
  };
  const openById = async (entryId: string) => {
    try {
      open(await api.getEntry(entryId));
    } catch {
      onUnavailable();
    }
  };
  const sheet = <EntryShareSheet visible={visible} entry={entry} line={line} onClose={() => setVisible(false)} />;
  return { open, openById, sheet };
}

const TARGET_ICON: Record<ShareTarget, { icon: keyof typeof Feather.glyphMap; bg: string; fg: string }> = {
  instagram: { icon: 'instagram', bg: '#E1306C', fg: '#FFFFFF' },
  kakao: { icon: 'message-circle', bg: '#FEE500', fg: '#191919' },
  threads: { icon: 'at-sign', bg: '#111111', fg: '#FFFFFF' },
  copy: { icon: 'link', bg: palette.bgSoft, fg: palette.text },
  more: { icon: 'more-horizontal', bg: palette.bgSoft, fg: palette.text },
};

export function EntryShareSheet({
  visible,
  entry,
  line,
  onClose,
}: {
  visible: boolean;
  entry: ShareSheetEntry | null;
  line: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<'prepare' | 'save' | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'toast' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setBusy(null);
      setNotice(null);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible]);

  if (!entry) return null;
  const targets = shareTargets(entry);
  const savable = canSaveVideo(entry);

  const toast = (text: string) => {
    setNotice({ text, kind: 'toast' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 2200);
  };
  const fail = (e: unknown) => setNotice({ text: shareFailureMessage(shareFailureKind(e)), kind: 'error' });

  const postStory = async () => {
    const route = storyRoute({ installed: await isInstagramInstalled(), storeUrl: instagramStoreUrl() });
    if (route === 'store') {
      setNotice({ text: t('entryShare.noInstagram'), kind: 'error' });
      void openUrl(instagramStoreUrl() as string).catch(() => {});
      return;
    }
    if (route === 'generic') {
      void openSystemShare(shareMessage(entry, entry.authorName, line)).catch(() => {});
      return;
    }
    setBusy('prepare');
    let uri: string;
    try {
      uri = await prepareVideoFile(entry, videoDeps);
    } catch (e) {
      setBusy(null);
      fail(e);
      return;
    }
    setBusy(null);
    try {
      await shareVideoToInstagramStory(uri);
    } catch {
      // 스토리 편집 화면을 닫은 경우라 안내하지 않는다.
    } finally {
      videoDeps.remove?.(uri);
    }
  };

  // 카톡·더보기: 내 참여작은 영상 파일을 받아 글과 같이 넘긴다. 남의 참여작은 영상 저장처럼 파일을 넘기지 않고 링크만 보낸다.
  // 영상을 못 받으면(영상 없음·너무 큼·받기 실패) 글과 링크만 보낸다.
  const shareWithVideo = async () => {
    const message = shareMessage(entry, entry.authorName, line);
    if (!entry.is_mine) {
      await openSystemShare(message);
      return;
    }
    setBusy('prepare');
    let uri: string | null = null;
    try {
      uri = await prepareVideoFile(entry, videoDeps);
    } catch {
      uri = null;
    } finally {
      setBusy(null);
    }
    if (uri) await openSystemShareWithVideo(uri, message);
    else await openSystemShare(message);
  };

  const onTarget = async (target: ShareTarget) => {
    void logEvent('challenge_share_target', { id: entry.id, target });
    setNotice(null);
    try {
      if (target === 'instagram') await postStory();
      else if (target === 'kakao' || target === 'more') await shareWithVideo();
      else if (target === 'threads') await openUrl(threadsIntentUrl(entry, entry.authorName, line));
      else {
        await copyText(shareMessage(entry, entry.authorName, line));
        toast(t('entryShare.copied'));
      }
    } catch {
      // 기기 공유 창을 닫으면 던지는 오류다.
    }
  };

  const onSave = async () => {
    if (busy) return;
    void logEvent('challenge_share_save', { id: entry.id });
    setNotice(null);
    setBusy('save');
    let uri: string | null = null;
    try {
      uri = await prepareVideoFile(entry, videoDeps);
      await saveVideoToLibrary(uri);
      toast(t('entryShare.saved'));
    } catch (e) {
      fail(e);
    } finally {
      if (uri) videoDeps.remove?.(uri);
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('entryShare.close')} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('entryShare.title')}</Text>
        <View style={styles.preview}>
          <View style={styles.thumb}>
            <Feather name="play" size={18} color={palette.textMuted} />
          </View>
          <View style={styles.previewText}>
            <Text style={styles.previewLine} numberOfLines={1}>
              “{line}”
            </Text>
            <Text style={styles.previewSub} numberOfLines={1}>
              {t('entryShare.previewSub', { name: entry.authorName })}
            </Text>
          </View>
        </View>
        <View style={styles.targets}>
          {targets.map((target) => {
            const look = TARGET_ICON[target];
            return (
              <Pressable
                key={target}
                style={styles.target}
                onPress={() => void onTarget(target)}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={t(`entryShare.${target}`)}
                ph-label={`challenge_share_${target}`}>
                <View style={[styles.circle, { backgroundColor: look.bg }]}>
                  <Feather name={look.icon} size={22} color={look.fg} />
                </View>
                <Text style={styles.targetLabel}>{t(`entryShare.${target}`)}</Text>
              </Pressable>
            );
          })}
        </View>
        {savable ? (
          <Pressable
            style={styles.save}
            onPress={() => void onSave()}
            disabled={busy !== null}
            accessibilityRole="button"
            ph-label="challenge_share_save">
            <Feather name="download" size={18} color={palette.text} />
            <Text style={styles.saveText}>{t('entryShare.save')}</Text>
          </Pressable>
        ) : null}
        {busy ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={palette.blueDeep} />
            <Text style={styles.statusText}>{busy === 'save' ? t('entryShare.saving') : t('entryShare.preparing')}</Text>
          </View>
        ) : null}
        {notice?.kind === 'error' ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {notice.text}
          </Text>
        ) : null}
      </View>
      {notice?.kind === 'toast' ? (
        <View style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{notice.text}</Text>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 14 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.bgSoft, borderRadius: 14, padding: 12, marginTop: 14 },
  thumb: { width: 44, height: 56, borderRadius: 8, backgroundColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  previewText: { flex: 1, gap: 2 },
  previewLine: { fontSize: 15, fontWeight: '700', color: palette.text },
  previewSub: { fontSize: 13, fontWeight: '500', color: palette.textMuted },
  targets: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 },
  target: { alignItems: 'center', gap: 8, minWidth: 56 },
  circle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  targetLabel: { fontSize: 12, fontWeight: '600', color: palette.textMuted },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, paddingVertical: 14, borderRadius: 14, backgroundColor: palette.bgSoft },
  saveText: { fontSize: 15, fontWeight: '600', color: palette.text },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  statusText: { fontSize: 13, fontWeight: '600', color: palette.blueDeep },
  error: { fontSize: 13, fontWeight: '600', color: palette.danger, textAlign: 'center', marginTop: 14, lineHeight: 19 },
  toast: { position: 'absolute', left: 24, right: 24, bottom: 120, backgroundColor: '#191F28E6', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  toastText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
