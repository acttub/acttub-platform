/**
 * 사용자가 자기 영상을 실제로 틀어 봤는지 센다.
 * 새 연습 화면의 미리보기, 보관함 상세, 연습 중 '영상·장면 보기'(분석·코칭·노트 화면)에서, 영상 하나당 "재생 시작"과 "끝까지 봄"을 한 번씩만 남긴다.
 * 같은 영상을 멈췄다 다시 틀거나 반복 재생해도 다시 세지 않고, 다른 영상으로 바뀌면 새로 센다.
 *
 * 화면 코드에서 떼어 둔 이유는 테스트 때문이다. expo-video 플레이어 연결은 hooks/use-video-preview-events.ts 가 맡는다.
 */
export type PreviewScreen = 'upload' | 'archive' | 'analyzing' | 'coach' | 'report';
export type PreviewParams = Record<string, string | number | boolean>;
export type PreviewLog = (name: string, params: PreviewParams) => void;

export const PREVIEW_PLAY_EVENT = 'video_preview_play';
export const PREVIEW_END_EVENT = 'video_preview_end';
/** 연습 중 '영상·장면 보기'를 펼칠 때마다 남긴다. 연습 도중 자기 영상을 보려 하는지 센다. */
export const FOLD_OPEN_EVENT = 'video_fold_open';

export function createPreviewTracker(screen: PreviewScreen, log: PreviewLog) {
  let key: string | null = null;
  let extra: PreviewParams = {};
  let played = false;
  let ended = false;

  return {
    /** 지금 화면에 걸린 영상. 영상이 바뀌면 다시 센다. */
    setSource(next: string | null, params: PreviewParams = {}) {
      if (next !== key) {
        key = next;
        played = false;
        ended = false;
      }
      extra = params;
    },
    onPlaying(isPlaying: boolean) {
      if (!isPlaying || !key || played) return;
      played = true;
      log(PREVIEW_PLAY_EVENT, { screen, ...extra });
    },
    onEnd() {
      if (!key || ended) return;
      ended = true;
      log(PREVIEW_END_EVENT, { screen, ...extra });
    },
  };
}
