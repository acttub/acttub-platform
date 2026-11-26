import { errorCode } from '../api-request.ts';
import { translate } from '../i18n.ts';
import { entryShareUrl } from './deeplink.ts';
import type { EntryCard } from './types.ts';

/**
 * 참여작 공유 시트(SOMA-819, pen ⑩ 「공유 시트 · SNS에 공유하기」).
 *
 * 공유 대상은 인스타(스토리에 영상), 카카오톡, 스레드, 링크 복사, 더 보기이고, 내 영상은 기기에 저장할 수 있다.
 * - 영상이 나가는 길(인스타 스토리·영상 저장)은 **내 참여작에만** 연다. 남의 영상은 링크만 나간다.
 * - 링크가 나가는 길(카카오톡·스레드·링크 복사·더 보기)은 **공개된 참여작에만** 연다. 비공개 참여작의 주소는
 *   남이 열면 「볼 수 없는 영상」이므로 보내지 않는다.
 * - 카카오톡은 카카오톡 공유(피드 카드: 그림·제목·대사 + 「영상 보기」 버튼)로 보낸다. 카카오톡이 없거나 이 기능이 없는
 *   빌드면 기기 공유 창(링크 문장)으로 대신 보낸다. 스레드는 웹 intent 주소로 보낸다.
 * 이 파일은 네이티브 모듈을 직접 부르지 않는다 — 실제 연결은 `share-native.ts` 가 `ShareDeps` 로 넣는다.
 */
export type ShareTarget = 'instagram' | 'kakao' | 'threads' | 'copy' | 'more';

/** 인스타 스토리 업로드용 영상 크기 상한(바이트). 넘으면 받지 않고 안내한다. */
export const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export const INSTAGRAM_STORE_URL = {
  ios: 'https://apps.apple.com/app/instagram/id389801252',
  android: 'market://details?id=com.instagram.android',
} as const;

export type ShareContext = Pick<EntryCard, 'is_mine' | 'published_at' | 'playback_url'>;

export function isPublicEntry(entry: Pick<EntryCard, 'published_at'>): boolean {
  return entry.published_at != null;
}

/** 시트에 보일 공유 대상. 시트의 순서(인스타, 카카오톡, 스레드, 링크 복사, 더 보기)를 지킨다. */
export function shareTargets(entry: ShareContext): ShareTarget[] {
  const out: ShareTarget[] = [];
  if (entry.is_mine && entry.playback_url) out.push('instagram');
  if (isPublicEntry(entry)) out.push('kakao', 'threads', 'copy', 'more');
  return out;
}

/** 「영상으로 저장」은 내 참여작이고 재생 주소가 있을 때만 보인다. */
export function canSaveVideo(entry: ShareContext): boolean {
  return entry.is_mine && Boolean(entry.playback_url);
}

/** 시트를 열 만한 것이 하나라도 있는지. 없으면 시트 대신 안내만 한다. */
export function hasShareOptions(entry: ShareContext): boolean {
  return shareTargets(entry).length > 0 || canSaveVideo(entry);
}

export function shareText(authorName: string, line: string): string {
  return translate('profileTab.shareText', { name: authorName, line });
}

/** 링크 문장 — 카카오톡·더 보기·링크 복사가 같은 문장을 쓴다. */
export function shareMessage(entry: Pick<EntryCard, 'id'>, authorName: string, line: string): string {
  return `${shareText(authorName, line)}\n${entryShareUrl(entry.id)}`;
}

/** 카카오톡 공유 카드의 그림. 참여작 공유 페이지(apps/web e/[id])가 장면 이미지가 없을 때 쓰는 사이트 공통 OG 이미지다. */
export const KAKAO_FEED_IMAGE_URL = 'https://acttub.com/opengraph-image';

/** 카카오톡 공유 카드에 들어갈 값. 카드와 버튼 모두 참여작 공유 페이지로 간다. */
export function kakaoFeed(entry: Pick<EntryCard, 'id'>, authorName: string, line: string) {
  const url = entryShareUrl(entry.id);
  return {
    title: translate('entryShare.kakaoTitle', { name: authorName }),
    description: translate('entryShare.kakaoDescription', { line }),
    imageUrl: KAKAO_FEED_IMAGE_URL,
    linkUrl: url,
    buttonTitle: translate('entryShare.kakaoButton'),
  };
}

/** 스레드 웹 intent. 앱이 있으면 스레드가, 없으면 브라우저가 연다. */
export function threadsIntentUrl(entry: Pick<EntryCard, 'id'>, authorName: string, line: string): string {
  return `https://www.threads.net/intent/post?text=${encodeURIComponent(shareMessage(entry, authorName, line))}`;
}

export type ShareFailureKind =
  | 'no_video'
  | 'too_large'
  | 'download_failed'
  | 'permission_denied'
  | 'save_failed'
  | 'frame_failed'
  | 'mosaic_not_ready';

export class ShareError extends Error {
  readonly kind: ShareFailureKind;
  constructor(kind: ShareFailureKind) {
    super(kind);
    this.kind = kind;
  }
}

export function shareFailureKind(error: unknown): ShareFailureKind {
  return error instanceof ShareError ? error.kind : 'download_failed';
}

export function shareFailureMessage(kind: ShareFailureKind): string {
  return translate(`entryShare.fail.${kind}`);
}

export type StoryRoute = 'story' | 'store' | 'generic';

/** 인스타 스토리 길 결정: 설치돼 있으면 스토리, 없으면 스토어(스토어 주소가 있을 때), 아니면 일반 공유. */
export function storyRoute(opts: { installed: boolean; storeUrl: string | null }): StoryRoute {
  if (opts.installed) return 'story';
  return opts.storeUrl ? 'store' : 'generic';
}

export type VideoDeps = {
  /** 재생 주소의 영상을 기기 임시 폴더로 받는다. */
  download: (url: string) => Promise<{ uri: string; size: number | null }>;
  /** 받은 임시 파일을 지운다(실패해도 무시). */
  remove?: (uri: string) => void;
};

/** 공유·저장에 쓸 영상을 로컬 파일로 준비한다. 주소가 없으면 no_video, 너무 크면 too_large(파일은 지운다). */
export async function prepareVideoFile(entry: Pick<EntryCard, 'playback_url'>, deps: VideoDeps): Promise<string> {
  if (!entry.playback_url) throw new ShareError('no_video');
  let file: { uri: string; size: number | null };
  try {
    file = await deps.download(entry.playback_url);
  } catch {
    throw new ShareError('download_failed');
  }
  if (file.size != null && file.size > STORY_VIDEO_MAX_BYTES) {
    deps.remove?.(file.uri);
    throw new ShareError('too_large');
  }
  return file.uri;
}

/**
 * 공유 프레임(SOMA-1156). 인스타 스토리와 「영상으로 저장」에 씌울 틀을 고른다. 「없음」이면 지금처럼 영상 그대로다.
 * 카카오톡·스레드·링크 복사·더 보기는 링크만 나가므로 프레임과 상관없다. 틀은 서버가 영상에 입히고(만드는 동안 앱이
 * 같은 요청을 다시 보내 기다린다), 미리보기도 서버가 같은 틀로 그린 그림이라 앱 미리보기와 결과가 같다.
 */
export type ShareFrame = 'white' | 'blue' | 'black' | 'none';

/** 고르는 줄의 순서. */
export const SHARE_FRAMES: readonly ShareFrame[] = ['white', 'blue', 'black', 'none'];
export const DEFAULT_SHARE_FRAME: ShareFrame = 'white';
/** 프레임 영상이 다 됐는지 다시 묻는 간격과 기다리는 한도. 넘으면 실패로 안내한다. */
export const FRAME_POLL_MS = 1_500;
export const FRAME_WAIT_MS = 180_000;

/**
 * 얼굴 가림을 켰는데 모자이크본이 아직 없다는 서버 응답(422 mosaic_not_ready). 프레임 영상·미리보기 모두 이렇게 오고, 원본에
 * 씌우지 않으므로 다시 하기 대신 잠시 뒤에 하라고 안내한다.
 */
export function isMosaicNotReady(error: unknown): boolean {
  return errorCode(error) === 'mosaic_not_ready';
}

/** 서버 응답(ChallengeEntryShareFrameVideo). */
export type ShareFrameVideo = { status: 'rendering' | 'ready' | 'failed'; video_url: string | null };
/** 서버 응답(ChallengeEntryShareFramePreview). */
export type ShareFramePreview = { image_url: string };

/** 프레임 고르기는 영상이 나가는 길(인스타 스토리·영상 저장)이 열릴 때만 보인다. */
export function canPickFrame(entry: ShareContext): boolean {
  return canSaveVideo(entry);
}

export function frameLabel(frame: ShareFrame): string {
  return translate(`entryShare.frames.${frame}`);
}

export type FrameDeps = VideoDeps & {
  /** 프레임 영상을 요청한다(서버가 만들고 있으면 rendering). */
  requestFrame: (entryId: string, frame: Exclude<ShareFrame, 'none'>) => Promise<ShareFrameVideo>;
  /** 다시 묻기 전에 기다린다. */
  wait: (ms: number) => Promise<void>;
  /** 지금 시각(밀리초). 기다리는 한도를 잰다. */
  now: () => number;
};

/**
 * 공유·저장에 쓸 영상을 로컬 파일로 준비한다. 「없음」이면 재생 주소 그대로(prepareVideoFile), 프레임을 골랐으면 서버의
 * 프레임 영상이 준비될 때까지 다시 묻고 그것을 받는다. 프레임을 만들지 못하면 frame_failed 다 — 원본 영상으로 몰래
 * 대신 보내지 않는다.
 */
export async function prepareShareFile(
  entry: Pick<EntryCard, 'id' | 'playback_url'>,
  frame: ShareFrame,
  deps: FrameDeps,
): Promise<string> {
  if (frame === 'none') return prepareVideoFile(entry, deps);
  if (!entry.playback_url) throw new ShareError('no_video');
  const until = deps.now() + FRAME_WAIT_MS;
  let url: string | null = null;
  while (url == null) {
    let video: ShareFrameVideo;
    try {
      video = await deps.requestFrame(entry.id, frame);
    } catch (e) {
      throw new ShareError(isMosaicNotReady(e) ? 'mosaic_not_ready' : 'frame_failed');
    }
    if (video.status === 'ready' && video.video_url) url = video.video_url;
    else if (video.status === 'failed') throw new ShareError('frame_failed');
    else if (deps.now() >= until) throw new ShareError('frame_failed');
    else await deps.wait(FRAME_POLL_MS);
  }
  return prepareVideoFile({ playback_url: url }, deps);
}
