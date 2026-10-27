import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { palette } from '@/constants/palette';
import { radius } from '@/constants/tokens';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';

/**
 * 보관함에서 가장 최근 영상의 첫 장면 사진. 사진첩은 읽지 않는다 — 사진첩 권한 확인만으로도 iOS 가 「사진 보관함 전체」
 * 팝업을 띄워(시뮬레이터 확인) 촬영 화면에 팝업이 하나 더 생긴다. 사진이 없거나 못 받으면 null 이고 앨범 버튼은 아이콘이다.
 */
function useRecentPoster(): { uri: string; cacheKey: string } | null {
  const [poster, setPoster] = useState<{ uri: string; cacheKey: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .listVideos('all')
      .then(({ videos }) => {
        const uri = videos.find((v) => !v.purged_at && v.poster_url)?.poster_url;
        // 서명 주소는 10분마다 바뀐다 — 서명을 뗀 주소를 캐시 키로 쓴다(보관함 칸과 같은 캐시).
        if (alive && uri) setPoster({ uri, cacheKey: uri.split('?')[0] });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return poster;
}

/** 촬영 화면 왼쪽 아래 앨범 버튼(pen record-video 「upload · 최근 영상」). 누르면 사진첩에서 영상을 고른다. */
/** hidden 이면(녹화 중) 자리를 둔 채 보이지 않고 눌리지 않으며 화면 읽기에서도 빠진다. */
export function RecordAlbumButton({ onPress, hidden = false }: { onPress: () => void; hidden?: boolean }) {
  const poster = useRecentPoster();
  return (
    <Pressable
      style={[styles.album, hidden && styles.hidden]}
      onPress={onPress}
      disabled={hidden}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityRole="button"
      accessibilityLabel={t('record.album')}
      ph-label="record_gallery">
      {poster ? (
        <Image source={poster} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Feather name="image" size={22} color={palette.onAccent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  album: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.onAccent,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  hidden: { opacity: 0 },
});
