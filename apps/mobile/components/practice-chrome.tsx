import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';

import { palette } from '@/constants/palette';
import { useVideoPreviewEvents } from '@/hooks/use-video-preview-events';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { limitVideoBuffer } from '@/lib/video-memory';
import { FOLD_OPEN_EVENT, type PreviewScreen } from '@/lib/video-preview-events';

/**
 * 연습 흐름(분석 대기 → 질문 대화)의 화면들이 공유하는 '영상·장면 보기' 접이식.
 *
 * 화면마다 다시 만들면 간격과 색이 조금씩 어긋나서 한곳에 둔다.
 */

/**
 * 펼쳤을 때의 영상. 화면 폭을 그대로 쓴다.
 *
 * `videoUri` 가 문자열이 아니라 VideoSource 인 건 개발용 미리보기 때문이다 —
 * 번들에 든 샘플 파일은 `require()` 로 들어와서 문자열 경로가 아니다.
 */
export function SceneFoldBody({
  open,
  videoUri,
  track,
  startAt,
}: {
  open: boolean;
  videoUri: VideoSource | null;
  /** 펼친 영상을 실제로 틀었는지 기록한다(video_preview_play·end). */
  track?: PreviewScreen;
  /**
   * 코치 말 속 「0:12」를 눌렀을 때 그 초부터 튼다(pen 「추가 · 시간 눌러 장면 보기」, SOMA-748).
   * 같은 시간을 다시 눌러도 다시 감기도록 누를 때마다 `key`를 바꿔 준다. 영상 위에 「0:12부터」 표를 단다.
   */
  startAt?: { seconds: number; label: string; key: number } | null;
}) {
  const player = useVideoPlayer(open ? videoUri : null, (p) => {
    p.loop = false;
    limitVideoBuffer(p);
  });
  // 원본을 막 불러온 참이면 아직 감을 수 없다 — 재생 준비가 끝날 때 한 번 더 감는다.
  const pendingSeek = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !startAt) return;
    pendingSeek.current = startAt.seconds;
    const seek = () => {
      if (pendingSeek.current === null) return;
      try {
        player.currentTime = pendingSeek.current;
        player.play();
        if (player.status === 'readyToPlay') pendingSeek.current = null;
      } catch {}
    };
    seek();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') seek();
    });
    return () => sub.remove();
  }, [open, player, startAt]);
  // 빈 문자열만 '없음' 으로 본다. require() 로 들어온 에셋은 숫자라 truthy 검사로는
  // 걸러지지 않아야 한다.
  const hasVideo = videoUri != null && videoUri !== '';
  const videoKey = typeof videoUri === 'string' ? videoUri : hasVideo ? 'bundled' : null;
  // 접었다 다시 펼쳐도 같은 영상이면 다시 세지 않도록, 접힘 여부와 상관없이 같은 값을 준다.
  useVideoPreviewEvents(player, track ?? 'coach', track && hasVideo ? videoKey : null);
  if (!open) return null;
  return (
    <View style={styles.foldBody}>
      {hasVideo ? (
        <View>
          <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
          {startAt ? (
            <View style={styles.seekBadge} pointerEvents="none">
              <Text style={styles.seekBadgeText}>{startAt.label}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={styles.foldEmpty}>{t('practiceChrome.noVideo')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  foldBody: { paddingHorizontal: 20, paddingTop: 14 },
  foldEmpty: { fontSize: 12.5, fontWeight: '600', color: palette.textMeta },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: palette.bgSoft },
  seekBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: palette.blue,
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  seekBadgeText: { fontSize: 12, fontWeight: '800', color: palette.onAccent },
});

/** 연습 중 '영상·장면 보기'를 펼친 것을 남긴다. 화면 하나에서 여러 번 펼치면 그때마다 남는다. */
export function logFoldOpen(screen: PreviewScreen): void {
  logEvent(FOLD_OPEN_EVENT, { screen });
}
