import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  canPickFrame,
  canSaveVideo,
  DEFAULT_SHARE_FRAME,
  frameLabel,
  hasShareOptions,
  isMosaicNotReady,
  kakaoFeed,
  prepareShareFile,
  prepareVideoFile,
  SHARE_FRAMES,
  shareFailureKind,
  shareFailureMessage,
  shareMessage,
  shareTargets,
  storyRoute,
  threadsIntentUrl,
  type FrameDeps,
  type ShareContext,
  type ShareFrame,
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
  shareKakaoFeed,
  shareVideoToInstagramStory,
  videoDeps,
} from '@/lib/challenge/share-native';
import type { EntryCard } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * 참여작 공유 페이지(SOMA-819, pen ⑩ 「공유 시트 · SNS에 공유하기」) — 아래에서 올라오는 시트 대신 전체 화면
 * 페이지다(SOMA-821, 하단 시트 금지). 머리줄 「공유하기」+닫기, 미리보기 줄(제목 대사 · 지은이 · 링크), 공유 대상 원 5개(인스타·카카오톡·스레드·링크 복사·더 보기), 「영상으로 저장」.
 * 어떤 대상이 열리는지는 `lib/challenge/share.ts` 의 규칙을 따른다(영상은 내 것만, 링크는 공개된 것만).
 * 영상은 재생 주소에서 받는 동안 「영상을 준비하고 있어요…」를 보이고, 실패하면 안내 문구를 페이지 안에 둔다.
 *
 * 공유 프레임(SOMA-1156): 영상이 나가는 길이 열린 내 참여작이면 미리보기 줄 대신 서버가 그린 프레임 미리보기와 「프레임」 줄
 * (흰색·파랑·검정·없음, 기본 흰색)을 둔다. 인스타·영상 저장은 고른 프레임을 씌운 서버 영상을 기다려(「프레임 넣는 중…」)
 * 받는다. 프레임을 넣지 못하면 다시 시도할 수 있는 안내를 두고, 원본 영상으로 대신 보내지 않는다.
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
  const [busy, setBusy] = useState<'prepare' | 'save' | 'frame' | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'toast' | 'error'; retry?: () => void } | null>(null);
  const [frame, setFrame] = useState<ShareFrame>(DEFAULT_SHARE_FRAME);
  const [previews, setPreviews] = useState<Partial<Record<ShareFrame, string | false>>>({});
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 페이지를 닫으면 기다리던 프레임 영상을 더 묻지 않고, 늦게 온 결과를 안내하지 않는다.
  const open = useRef(visible);
  open.current = visible;
  const pickable = entry != null && canPickFrame(entry);
  const entryId = entry?.id;

  useEffect(() => {
    if (!visible) {
      setBusy(null);
      setNotice(null);
      setFrame(DEFAULT_SHARE_FRAME);
      setPreviews({});
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible]);

  // 네 가지 미리보기를 한 번에 받는다 — 서버가 결과 영상과 같은 틀로 그린 그림이다. 못 받으면 빈 칸으로 둔다.
  // 얼굴 가림이 아직 준비되지 않았으면(mosaic_not_ready) 빈 칸과 함께 그 안내를 미리 둔다.
  useEffect(() => {
    if (!visible || !pickable || !entryId) return;
    let alive = true;
    for (const option of SHARE_FRAMES) {
      api.getShareFramePreview(entryId, option).then(
        (preview) => alive && setPreviews((prev) => ({ ...prev, [option]: preview.image_url })),
        (e: unknown) => {
          if (!alive) return;
          setPreviews((prev) => ({ ...prev, [option]: false }));
          if (isMosaicNotReady(e)) setNotice({ text: shareFailureMessage('mosaic_not_ready'), kind: 'error' });
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [visible, pickable, entryId]);

  if (!entry) return null;
  const targets = shareTargets(entry);
  const savable = canSaveVideo(entry);
  const chosen: ShareFrame = pickable ? frame : 'none';
  const frameDeps: FrameDeps = {
    ...videoDeps,
    requestFrame: (id, option) => api.requestShareFrame(id, option),
    wait: (ms) =>
      new Promise((resolve, reject) =>
        setTimeout(() => (open.current ? resolve() : reject(new Error('closed'))), ms),
      ),
    now: () => Date.now(),
  };

  const toast = (text: string) => {
    setNotice({ text, kind: 'toast' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 2200);
  };
  const fail = (e: unknown, retry?: () => void) => {
    if (!open.current) return;
    const kind = shareFailureKind(e);
    setNotice({ text: shareFailureMessage(kind), kind: 'error', retry: kind === 'frame_failed' ? retry : undefined });
  };
  /** 인스타·영상 저장에 쓸 파일. 프레임을 골랐으면 서버 프레임 영상을 기다린다. */
  const prepareFile = (kind: 'prepare' | 'save') => {
    setBusy(chosen === 'none' ? kind : 'frame');
    return prepareShareFile(entry, chosen, frameDeps);
  };

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
    let uri: string;
    try {
      uri = await prepareFile('prepare');
    } catch (e) {
      setBusy(null);
      fail(e, () => void onTarget('instagram'));
      return;
    }
    setBusy(null);
    if (!open.current) return;
    // 받은 파일은 여기서 지우지 않는다. 안드로이드는 인스타를 열자마자 돌아오고 인스타가 그 뒤에 파일을 읽어서,
    // 바로 지우면 스토리에 영상이 올라가지 않는다. 다음 공유 때 videoDeps.download 가 정리한다.
    try {
      await shareVideoToInstagramStory(uri);
    } catch (e) {
      // 스토리 편집 화면을 닫은 경우라 안내하지 않는다. 다른 실패를 가려 내도록 이유만 남긴다.
      logEvent('challenge_share_story_error', { id: entry.id, reason: String((e as Error)?.message ?? e).slice(0, 80) });
    }
  };

  // 카카오톡: 카카오톡 공유 카드(그림·제목·대사 + 「영상 보기」)로 보낸다. 카카오톡이 없거나 이 기능이 없는 빌드, 또는
  // 카카오 쪽 오류면 기기 공유 창으로 링크 문장을 보낸다. 영상 파일은 넘기지 않는다 — 카카오톡은 파일을 받으면 글을 버린다.
  const shareKakao = async () => {
    const message = shareMessage(entry, entry.authorName, line);
    let sent = false;
    try {
      sent = await shareKakaoFeed(kakaoFeed(entry, entry.authorName, line));
    } catch (e) {
      logEvent('challenge_share_kakao_error', { id: entry.id, reason: String((e as Error)?.message ?? e).slice(0, 80) });
    }
    if (!sent) await openSystemShare(message);
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
    logEvent('challenge_share_target', target === 'instagram' ? { id: entry.id, target, frame: chosen } : { id: entry.id, target });
    setNotice(null);
    try {
      if (target === 'instagram') await postStory();
      else if (target === 'kakao') await shareKakao();
      else if (target === 'more') await shareWithVideo();
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
    logEvent('challenge_share_save', { id: entry.id, frame: chosen });
    setNotice(null);
    let uri: string | null = null;
    try {
      uri = await prepareFile('save');
      setBusy('save');
      await saveVideoToLibrary(uri);
      toast(t('entryShare.saved'));
    } catch (e) {
      fail(e, () => void onSave());
    } finally {
      if (uri) videoDeps.remove?.(uri);
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <NavHeader
          title={t(entry.is_mine ? 'entryShare.title' : 'entryShare.titleOthers')}
          left={<NavIconButton icon="x" label={t('entryShare.close')} phLabel="challenge_share_close" onPress={onClose} />}
        />
        <ScrollView contentContainerStyle={styles.body}>
        {pickable ? (
          <>
            <View style={styles.framePreview}>
              <FrameImage
                url={previews[frame]}
                label={t('entryShare.framePreview', { frame: frameLabel(frame) })}
                width={FRAME_PREVIEW_WIDTH}
              />
            </View>
            <View style={styles.frameHead}>
              <Text style={styles.frameTitle}>{t('entryShare.frameTitle')}</Text>
              <Text style={styles.frameHint}>{t('entryShare.frameHint')}</Text>
            </View>
            <View style={styles.frameRow} accessibilityRole="radiogroup">
              {SHARE_FRAMES.map((option) => {
                const selected = option === frame;
                return (
                  <Pressable
                    key={option}
                    style={styles.frameOption}
                    onPress={() => {
                      setFrame(option);
                      setNotice(null);
                    }}
                    disabled={busy !== null}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={frameLabel(option)}
                    ph-label={`challenge_share_frame_${option}`}>
                    <View style={[styles.frameThumb, selected && styles.frameThumbSelected]}>
                      <FrameImage url={previews[option]} width={FRAME_THUMB_WIDTH} />
                    </View>
                    <Text style={[styles.frameLabel, selected && styles.frameLabelSelected]}>{frameLabel(option)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.preview}>
            <View style={styles.thumb}>
              <Feather name="play" size={18} color={palette.textMeta} />
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
        )}
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
            <Text style={styles.statusText}>
              {busy === 'frame' ? t('entryShare.framing') : busy === 'save' ? t('entryShare.saving') : t('entryShare.preparing')}
            </Text>
          </View>
        ) : null}
        {notice?.kind === 'error' ? (
          <View style={styles.error}>
            {notice.retry ? (
              <InlineError message={notice.text} onRetry={notice.retry} />
            ) : (
              <InlineErrorLine message={notice.text} />
            )}
          </View>
        ) : null}
        </ScrollView>
      </View>
      {notice?.kind === 'toast' ? (
        <Toast message={notice.text} bottom={insets.bottom + space[3]} />
      ) : null}
    </Modal>
  );
}

/** 프레임 미리보기의 폭. 높이는 9:16 이다. */
const FRAME_PREVIEW_WIDTH = 200;
const FRAME_THUMB_WIDTH = 60;

/** 서버가 그린 프레임 미리보기 한 장. 받는 동안은 뼈대, 못 받았으면 빈 칸이다. */
function FrameImage({ url, label, width }: { url: string | false | undefined; label?: string; width: number }) {
  const height = Math.round((width * 16) / 9);
  if (url === undefined) return <SkeletonBlock width={width} height={height} radius={0} />;
  if (url === false) return <View style={[styles.frameEmpty, { width, height }]} />;
  return (
    <Image
      source={{ uri: url }}
      style={{ width, height }}
      contentFit="cover"
      accessible={label != null}
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  framePreview: {
    alignSelf: 'center',
    marginTop: space[3],
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  frameHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[5] },
  frameTitle: { ...type.body1Bold, color: palette.text },
  frameHint: { ...type.caption, color: palette.textMeta },
  frameRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[3] },
  frameOption: { alignItems: 'center', gap: space[2] },
  frameThumb: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, overflow: 'hidden', padding: 1 },
  frameThumbSelected: { borderWidth: 2, borderColor: palette.blue, padding: 0 },
  frameEmpty: { backgroundColor: palette.bgSoft },
  frameLabel: { ...type.caption, color: palette.textSub },
  frameLabelSelected: { ...type.captionBold, color: palette.blueDeep },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[8] },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: palette.bgSubtle, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  thumb: { width: 44, height: 56, borderRadius: radius.sm, backgroundColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  previewText: { flex: 1, gap: 2 },
  previewLine: { ...type.body1Bold, color: palette.text },
  previewSub: { ...type.caption, color: palette.textMeta },
  targets: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space[5] },
  target: { alignItems: 'center', gap: space[2], minWidth: 56 },
  circle: { width: 52, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  targetLabel: { ...type.caption, color: palette.textSub },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], marginTop: space[6], height: 48, borderRadius: radius.lg, backgroundColor: palette.bgSoft },
  saveText: { ...type.headline, color: palette.textSub },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], marginTop: space[3] },
  statusText: { ...type.captionBold, color: palette.blueDeep },
  error: { marginTop: space[3] },
});
