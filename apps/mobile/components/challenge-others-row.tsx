import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SkeletonBlock } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { cachedEntryThumb, loadEntryThumb } from '@/lib/challenge/entry-thumbs';
import type { ChallengeCard, EntryCard } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/** 한 줄에 싣는 참여작 수. 더 보려면 「전체 보기」로 상세에 간다. */
export const OTHERS_ROW_MAX = 6;
const TILE_W = 108;
const TILE_H = 150;

/** 좋아요순 공개 참여작 중 재생할 수 있는 남의 것만 앞에서부터 고른다. */
export function pickOthers(entries: EntryCard[], max = OTHERS_ROW_MAX): EntryCard[] {
  return entries.filter((e) => !e.is_mine && !!e.playback_url).slice(0, max);
}

/**
 * 챌린지 탭 이번 주 카드 아래 「다른 배우 영상」 한 줄(SOMA-986). 탭에서 바로 남의 영상을 보게 한다 —
 * 전에는 카드 → 상세 → 목록 줄을 지나야 영상이 처음 보였다. 썸네일을 누르면 그 영상부터 전체 화면으로 재생한다.
 * 고를 참여작이 없으면 줄 자체를 그리지 않는다.
 */
export function ChallengeOthersRow({
  challenge,
  onOpenAll,
  onOpenEntry,
}: {
  challenge: ChallengeCard;
  onOpenAll: () => void;
  onOpenEntry: (entry: EntryCard) => void;
}) {
  const [entries, setEntries] = useState<EntryCard[] | null>(null);
  const hasEntries = challenge.entry_count > 0;

  useEffect(() => {
    setEntries(null);
    if (!hasEntries) return;
    let alive = true;
    api
      .listChallengeEntries(challenge.id, { sort: 'likes' })
      .then((r) => alive && setEntries(pickOthers(r.entries)))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [challenge.id, challenge.entry_count, hasEntries]);

  if (!hasEntries || (entries !== null && entries.length === 0)) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('challenges.othersRowTitle')}</Text>
        <Pressable onPress={onOpenAll} hitSlop={8} accessibilityRole="button" ph-label="challenge_others_row_all">
          <Text style={styles.all}>{t('challenges.othersRowAll')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroller}>
        {entries === null
          ? [0, 1, 2, 3].map((i) => <SkeletonBlock key={i} width={TILE_W} height={TILE_H} radius={radius.md} />)
          : entries.map((entry) => <Tile key={entry.id} entry={entry} onPress={() => onOpenEntry(entry)} />)}
      </ScrollView>
    </View>
  );
}

function Tile({ entry, onPress }: { entry: EntryCard; onPress: () => void }) {
  const [thumb, setThumb] = useState<VideoThumbnail | null>(() => cachedEntryThumb(entry.id));
  useEffect(() => {
    if (thumb || !entry.playback_url) return;
    let alive = true;
    void loadEntryThumb(entry.id, entry.playback_url).then((made) => alive && made && setThumb(made));
    return () => {
      alive = false;
    };
  }, [entry.id, entry.playback_url, thumb]);

  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('challenges.othersRowA11y', { name: entry.author.name })}
      ph-label="challenge_others_row_tile">
      {thumb && <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityElementsHidden />}
      <View style={styles.shade} pointerEvents="none" />
      {entry.view_count === 0 && (
        <View style={styles.newBadge}>
          <Text style={styles.newText}>{t('challenges.newBadge')}</Text>
        </View>
      )}
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.author.name}
        </Text>
        <View style={styles.likes}>
          <Feather name="heart" size={11} color={palette.onAccent} />
          <Text style={styles.likeText}>{entry.like_count}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { ...type.headline, color: palette.text },
  all: { ...type.body2Bold, color: palette.blueDeep },
  // 화면 오른쪽 끝까지 이어 보이게 바깥 여백만큼 넘긴다 — 옆으로 더 있다는 걸 보여 준다.
  scroller: { marginRight: -space.gutter },
  row: { gap: space[2], paddingRight: space.gutter },
  tile: { width: TILE_W, height: TILE_H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: palette.bgSoft },
  pressed: { opacity: 0.85 },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, backgroundColor: palette.scrim },
  newBadge: {
    position: 'absolute',
    left: space[2],
    top: space[2],
    backgroundColor: palette.flame,
    borderRadius: radius.full,
    paddingHorizontal: space[1.5],
  },
  newText: { ...type.micro, color: palette.onAccent },
  meta: {
    position: 'absolute',
    left: space[2],
    right: space[2],
    bottom: space[1.5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  name: { ...type.captionBold, color: palette.onAccent, flex: 1 },
  likes: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  likeText: { ...type.micro, color: palette.onAccent },
});
