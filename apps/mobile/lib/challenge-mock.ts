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

/** 예시 재생용 짧은 샘플 영상(포스터에서 만든 목업). 서버가 서면 실제 연기 영상으로 교체. */
export const SAMPLE_VIDEO = require('@/assets/images/challenge/sample.mp4');

/** 연기자별 예시 클립 — PERFORMERS[i].img 와 같은 인덱스. 스와이프 피드에서 한 장씩 튼다. */
export const CLIPS = [
  require('@/assets/images/challenge/clip1.mp4'),
  require('@/assets/images/challenge/clip2.mp4'),
  require('@/assets/images/challenge/clip3.mp4'),
  require('@/assets/images/challenge/clip4.mp4'),
  require('@/assets/images/challenge/clip5.mp4'),
];

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

// ---- 아래는 "곧 열려요"였던 화면들의 예시 데이터(SOMA-526). 백엔드가 서면 이 파일만 갈아끼운다. ----

export type MockComment = { id: string; name: string; ago: string; text: string; liked: boolean };

/** A15.3 댓글 시트 — 오늘의 챌린지 영상에 달린 예시 댓글. */
export const COMMENTS: readonly MockComment[] = [
  { id: 'c1', name: '이하윤', ago: '2분 전', text: '마지막 시선 처리가 정말 좋았어요!', liked: true },
  { id: 'c2', name: '김민준', ago: '12분 전', text: '같은 대사인데 해석이 완전히 다르네요.', liked: false },
  { id: 'c3', name: '박서연', ago: '1시간 전', text: '호흡을 길게 가져간 부분이 인상적이에요.', liked: true },
  { id: 'c4', name: '정우진', ago: '3시간 전', text: '저도 이 대사로 참여해보고 싶어요.', liked: false },
];

/** A15.4 신고 사유 — i18n 키. */
export const REPORT_REASONS = ['copyright', 'inappropriate', 'spam', 'other'] as const;

export type MockSavedVideo = { id: string; name: string; likes: string; line: string; img: number };

/** A15.5 저장한 영상 / 내 영상 — img는 PERF_IMAGES 인덱스. */
export const SAVED_VIDEOS: readonly MockSavedVideo[] = [
  { id: 's1', name: '박도윤', likes: '128', line: '가지 마. 딱 한 번만', img: 0 },
  { id: 's2', name: '이서연', likes: '96', line: '나는 갈매기…', img: 1 },
  { id: 's3', name: '최민준', likes: '74', line: '밥은 먹고 다니냐', img: 2 },
  { id: 's4', name: '한지우', likes: '52', line: '어떻게 사랑이 변하니', img: 3 },
  { id: 's5', name: '윤서아', likes: '41', line: '네가 먼저 말했잖아', img: 4 },
  { id: 's6', name: '김태오', likes: '33', line: '나 다시 돌아갈래', img: 0 },
];

export const MY_VIDEOS: readonly MockSavedVideo[] = [
  { id: 'm1', name: '나', likes: '12', line: '가지 마. 딱 한 번만', img: 2 },
  { id: 'm2', name: '나', likes: '8', line: '괜찮아, 이제 그만 울어도 돼.', img: 4 },
  { id: 'm3', name: '나', likes: '5', line: '한 번만 더 믿어보면 안 될까.', img: 1 },
];

/** A16 대사 검색 — 랭킹 목록과 같은 풀에서 찾는다. */
export const ALL_LINES: readonly { line: string; work: string; likes: string }[] = [
  { line: '가지 마, 딱 한 번만 내 얘기 듣고 가.', work: '옥상, 밤', likes: '12천' },
  { line: '네가 먼저 말했잖아, 같이 가자고, 어디든.', work: '가로등 아래', likes: '8.2천' },
  { line: '나 다시 돌아왔다니까!?', work: '재회', likes: '5.1천' },
  { line: '이렇게 사랑이 변하니.', work: '겨울 끝', likes: '4.7천' },
  { line: '괜찮아, 이제 그만 울어도 돼.', work: '병실 305호', likes: '4.4천' },
  { line: '한 번만 더 믿어보면 안 될까.', work: '마지막 밤', likes: '3.9천' },
];

export type MockArchiveVideo = {
  id: string;
  /** 초 */
  duration: number;
  /** 촬영 시각(ISO). */
  createdAt: string;
  favorite: boolean;
  line: string;
  img: number;
};

function daysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 10, 0, 0);
  return d.toISOString();
}

/** A2.2 보관함 — 촬영으로 기기에 남은 영상 예시. 실제 촬영 결과는 아직 여기 안 쌓인다. */
export const ARCHIVE_VIDEOS: readonly MockArchiveVideo[] = [
  { id: 'a1', duration: 42, createdAt: daysAgo(0, 14), favorite: true, line: '가지 마. 딱 한 번만 내 얘기 듣고 가.', img: 0 },
  { id: 'a2', duration: 65, createdAt: daysAgo(0, 11), favorite: false, line: '네가 먼저 말했잖아, 같이 가자고.', img: 1 },
  { id: 'a3', duration: 38, createdAt: daysAgo(1, 19), favorite: false, line: '괜찮아, 이제 그만 울어도 돼.', img: 2 },
  { id: 'a4', duration: 51, createdAt: daysAgo(3, 9), favorite: true, line: '한 번만 더 믿어보면 안 될까.', img: 3 },
  { id: 'a5', duration: 72, createdAt: daysAgo(9, 16), favorite: false, line: '이렇게 사랑이 변하니.', img: 4 },
  { id: 'a6', duration: 47, createdAt: daysAgo(12, 20), favorite: false, line: '나 다시 돌아왔다니까!?', img: 0 },
];
