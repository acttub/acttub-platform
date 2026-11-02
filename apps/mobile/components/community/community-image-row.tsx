import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { MAX_IMAGES, type DraftImage } from '@/lib/community';
import { translate as t } from '@/lib/i18n';

const TILE = 64;

/**
 * 글쓰기 사진 줄 — 맨 앞 「+ 사진 n/5」 칸(64 · r8 · 1px border · bg-subtle · 카메라 아이콘) 뒤로 고른 사진 썸네일(64 · r8).
 * 썸네일 오른쪽 위 작은 x 로 뺀다. 올리는 중이면 옅은 막 + 「올리는 중」, 실패하면 빨간 테두리 + 다시 시도 아이콘(누르면 다시 올린다).
 * 5장이 차면 추가 칸을 끈다.
 */
export function CommunityImageRow({
  drafts,
  onAdd,
  onRemove,
  onRetry,
}: {
  drafts: DraftImage[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const full = drafts.length >= MAX_IMAGES;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroll}>
      <Pressable
        style={({ pressed }) => [styles.add, full && styles.addOff, pressed && !full && styles.pressed]}
        onPress={onAdd}
        disabled={full}
        accessibilityRole="button"
        accessibilityState={{ disabled: full }}
        accessibilityLabel={t('communityNew.addImageA11y', { count: drafts.length, max: MAX_IMAGES })}
        ph-label="community_new_add_image">
        <Feather name="camera" size={22} color={palette.iconFaint} />
        <Text style={styles.addText} numberOfLines={1}>
          {t('communityNew.addImageLabel', { count: drafts.length, max: MAX_IMAGES })}
        </Text>
      </Pressable>
      {drafts.map((d, i) => (
        <View key={d.key} style={styles.tileWrap} testID={`draft-image-${d.status}`}>
          <Pressable
            style={[styles.tile, d.status === 'failed' && styles.tileFailed]}
            onPress={d.status === 'failed' ? () => onRetry(d.key) : undefined}
            disabled={d.status !== 'failed'}
            accessibilityRole={d.status === 'failed' ? 'button' : 'image'}
            accessibilityLabel={
              d.status === 'failed'
                ? t('communityNew.imageRetryA11y', { n: i + 1 })
                : d.status === 'uploading'
                  ? t('communityNew.imageUploadingA11y', { n: i + 1 })
                  : t('communityNew.imageA11y', { n: i + 1 })
            }
            ph-label={d.status === 'failed' ? 'community_new_image_retry' : undefined}>
            <Image source={{ uri: d.uri }} style={styles.image} contentFit="cover" />
            {d.status === 'uploading' ? (
              <View style={styles.veil}>
                <Text style={styles.veilText}>{t('communityNew.imageUploading')}</Text>
              </View>
            ) : null}
            {d.status === 'failed' ? (
              <View style={styles.veil}>
                <Feather name="rotate-cw" size={18} color={palette.danger} />
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={styles.remove}
            onPress={() => onRemove(d.key)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('communityNew.removeImageA11y', { n: i + 1 })}
            ph-label="community_new_remove_image">
            <Feather name="x" size={12} color={palette.onAccent} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -space.gutter, flexGrow: 0 },
  // 썸네일 오른쪽 위 x 가 잘리지 않게 위·오른쪽을 비운다.
  row: { gap: space[3], paddingHorizontal: space.gutter, paddingTop: space[1.5], paddingRight: space.gutter + space[1.5] },
  pressed: { opacity: 0.7 },
  add: {
    width: TILE,
    height: TILE,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addOff: { opacity: 0.5 },
  addText: { ...type.micro, color: palette.textMeta },
  tileWrap: { width: TILE, height: TILE },
  tile: { width: TILE, height: TILE, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: palette.border },
  tileFailed: { borderWidth: 1.5, borderColor: palette.danger },
  image: { width: '100%', height: '100%' },
  veil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // 옅은 흰 막 — 사진은 비쳐 보이고 글자는 읽힌다.
    backgroundColor: palette.onMediaSub,
  },
  veilText: { ...type.micro, color: palette.textSub },
  remove: {
    position: 'absolute',
    top: -space[1.5],
    right: -space[1.5],
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: palette.toast,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
