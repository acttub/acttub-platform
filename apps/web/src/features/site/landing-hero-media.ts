/**
 * 랜딩 B안 첫 화면 휴대폰 안에서 도는 앱 녹화 영상(SOMA-918).
 *
 * 영상은 apps/web/public/site/landing/ 에 아래 이름으로 넣는다. 파일이 있으면 빌드할 때
 * landing-page-view 가 찾아서 쓰고, 없으면 지금 첫 화면에 쓰는 코칭 화면 사진을 그대로 보인다.
 * 코드는 손대지 않고 파일만 넣거나 바꾼 뒤 다시 빌드하면 된다.
 *   - coach-demo.webm (있으면 먼저 시도)
 *   - coach-demo.mp4
 *   - coach-demo-poster.jpg (첫 장면 정지 화면 · 움직임 줄이기 사용자에게 보이는 그림)
 * 화면 비율은 휴대폰 화면(약 9:19.5)이고 넘치는 쪽은 잘라 채운다(object-fit: cover).
 */
export type HeroMediaSource = { src: string; type: string };

export type HeroMedia = {
  poster: string;
  sources: HeroMediaSource[];
};

export const HERO_MEDIA_DIR = "/site/landing";

/** 우선순위대로. 브라우저는 재생할 수 있는 첫 파일을 쓴다. */
export const HERO_VIDEO_FILES: readonly HeroMediaSource[] = [
  { src: `${HERO_MEDIA_DIR}/coach-demo.webm`, type: "video/webm" },
  { src: `${HERO_MEDIA_DIR}/coach-demo.mp4`, type: "video/mp4" },
];

export const HERO_POSTER_FILE = `${HERO_MEDIA_DIR}/coach-demo-poster.jpg`;

/** 영상이 아직 없을 때 쓰는 기존 앱 코칭 화면. */
export const FALLBACK_HERO_POSTER = "/site/shot-coach.jpg";

export const DEFAULT_HERO_MEDIA: HeroMedia = { poster: FALLBACK_HERO_POSTER, sources: [] };
