/**
 * 챌린지(대사) 예시 데이터 — 백엔드 계약이 서기 전까지 화면을 채우는 목업.
 *
 * 사진은 pen(acttub 디자인.pen)의 A15·A17 연기 장면에서 뽑아 번들했다. 서버가 서면
 * 이 배열을 실제 API 응답으로 갈아끼운다.
 */

export const PERF_IMAGES = [
  require('@/assets/images/challenge/perf1.png'),
  require('@/assets/images/challenge/perf2.png'),
  require('@/assets/images/challenge/perf3.png'),
  require('@/assets/images/challenge/perf4.png'),
  require('@/assets/images/challenge/perf5.png'),
];

export const STORY_IMAGE = require('@/assets/images/challenge/story.jpg');

export type Performer = { name: string; likes: string; img: number };

/** 오늘의 대사에 올라온 연기 영상들(좋아요순). img는 PERF_IMAGES 인덱스. */
export const PERFORMERS: readonly Performer[] = [
  { name: '박도윤', likes: '1.2천', img: 0 },
  { name: '이하은', likes: '980', img: 1 },
  { name: '최민재', likes: '740', img: 2 },
  { name: '정유진', likes: '512', img: 3 },
  { name: '한서율', likes: '431', img: 4 },
];

export const TODAY_LINE = {
  line: '가지 마, 딱 한 번만 내 얘기 듣고 가.',
  work: '옥상, 밤',
  plays: '1천',
  likes: '12천',
};
