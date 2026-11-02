import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import type { CommunityImage } from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/**
 * 글 상세 사진(SOMA-873) — 본문 아래에 화면 폭(좌우 20 여백)으로 세로로 차례대로, r12, 원본 비율.
 * 비율은 그림을 받아야 알 수 있어 받기 전에는 4:3 자리를 `bg-soft` 로 비워 둔다. 누르면 전체 화면 보기(아래 시트 아님).
 */
export function PostImages({ images }: { images: CommunityImage[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <View style={styles.stack}>
      {images.map((image, i) => (
        <PostImage
          key={image.id}
          image={image}
          index={i}
          onPress={() => {
            void logEvent('community_image_view', { index: i });
            setViewing(i);
          }}
        />
      ))}
      <ImageViewer images={images} index={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

function PostImage({ image, index, onPress }: { image: CommunityImage; index: number; onPress: () => void }) {
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={t('communityPost.imageA11y', { n: index + 1 })}
      ph-label="community_post_image">
      <Image
        source={{ uri: image.url }}
        style={[styles.image, { aspectRatio: ratio ?? 4 / 3 }, ratio === null && styles.placeholder]}
        contentFit="cover"
        onLoad={(e) => {
          const { width, height } = e.source;
          if (width > 0 && height > 0) setRatio(width / height);
        }}
        testID="post-image"
      />
    </Pressable>
  );
}

/** 전체 화면 사진 보기 — 옆으로 넘기고 닫기 x 로 닫는다. 뒤로 가기로도 닫힌다. */
export function ImageViewer({ images, index, onClose }: { images: CommunityImage[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const open = index !== null;
  return (
    <Modal visible={open} animationType="fade" onRequestClose={onClose} onShow={() => setCurrent(index ?? 0)}>
      <View style={styles.viewer}>
        {open ? (
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(image) => image.id}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <Image source={{ uri: item.url }} style={{ width, height }} contentFit="contain" testID="viewer-image" />
            )}
          />
        ) : null}
        <View style={[styles.viewerTop, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
          {images.length > 1 ? <Text style={styles.viewerCount}>{`${current + 1} / ${images.length}`}</Text> : <View />}
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={styles.viewerClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            ph-label="community_image_viewer_close">
            <Feather name="x" size={24} color={palette.onAccent} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[2], marginTop: space[2] },
  image: { width: '100%', borderRadius: radius.md },
  placeholder: { backgroundColor: palette.bgSoft },
  viewer: { flex: 1, backgroundColor: palette.text },
  viewerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
  },
  viewerCount: { ...type.body2Bold, color: palette.onMediaSub },
  viewerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
