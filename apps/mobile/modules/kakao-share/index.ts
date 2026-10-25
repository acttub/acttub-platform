import { requireOptionalNativeModule } from 'expo';

/**
 * 카카오톡 공유 네이티브 모듈(SOMA-819). 기본 피드 템플릿으로 그림·제목·설명과 버튼 하나를 보낸다.
 *
 * 모듈이 없는 실행(이 모듈이 들어가기 전 빌드·Expo Go·테스트), 앱 키가 없는 빌드, 카카오톡이 없는 기기에서는
 * false 를 돌려준다 — 부르는 쪽이 기기 공유 창으로 대신 보낸다.
 */
export type KakaoFeed = {
  title: string;
  description: string;
  imageUrl: string;
  linkUrl: string;
  buttonTitle: string;
};

type KakaoShareNative = {
  shareFeed(feed: KakaoFeed): Promise<'talk' | 'unavailable'>;
};

const native = requireOptionalNativeModule<KakaoShareNative>('KakaoShare');

/** 카카오톡을 열었으면 true. 열 수 없는 환경이면 false. 카카오 쪽 오류는 던진다. */
export async function shareKakaoFeed(feed: KakaoFeed): Promise<boolean> {
  if (!native) return false;
  return (await native.shareFeed(feed)) === 'talk';
}
