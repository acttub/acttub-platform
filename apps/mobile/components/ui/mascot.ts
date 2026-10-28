import type { ImageSourcePropType } from 'react-native';

import { dailyIndex } from '@/lib/mascot-day';

/**
 * 액티(마스코트) 자세 — pen images/app 의 그림 그대로(SOMA-770). 화면마다 디자인이 쓰는 자세를 고른다.
 * - home: 두 팔 들고 웃는 액티 — 홈·온보딩 시작·첫 가이드 1·4·완료/마무리 화면
 * - coach: 물음표 갸웃 — 질문하는 화면(온보딩 질문·코칭 준비·상태/실패 화면·대화)
 * - reading: 대본 든 액티 — 리딩 화면 전부, 첫 가이드 2
 * - cheer: 손 흔드는 액티 — 노트 응원(디자인 프레임에는 없음, 1차부터 쓰던 것)
 * - 그 밖(10/22 20종): 코칭 끝 jump, 코칭 탭 첫 화면 slate, 알림 꺼짐 whisper, 챌린지 소개 bow·참여 끝 dance,
 *   리딩 마무리 love, 홈 머리는 HOME_POSES 를 날마다 돌린다.
 */
export type MascotPose = 'home' | 'coach' | 'reading' | 'cheer' | 'jump' | 'run' | 'dizzy' | 'breathe' | 'shy' | 'hamlet' | 'sob' | 'angry' | 'surprised' | 'smug' | 'love' | 'wink' | 'flat' | 'dance' | 'whisper' | 'bow' | 'slate' | 'selfie' | 'nervous' | 'yawn';

// 그리는 곳은 expo-image 에 cachePolicy="memory-disk" 를 준다 — 기본(disk)은 뜰 때마다 PNG 를 다시 읽고 풀어 늦게 뜬다(SOMA-847).
export const MASCOT: Record<MascotPose, ImageSourcePropType> = {
  home: require('@/assets/images/mascot-home.png'),
  coach: require('@/assets/images/mascot-coach.png'),
  reading: require('@/assets/images/mascot-reading.png'),
  cheer: require('@/assets/images/mascot-cheer.png'),
  // 10/22 자세·표정 20종(액티_자세표정_20종_시안v1 누끼) — 「액티가 매번 같은 자리·같은 자세」(10/20 피드백). 원본 한 장에서
  // 잘라 한 장이 약 220~320px 다 — 큰 자리(hero·intro)에 쓰면 흐릴 수 있어 그 자리는 큰 그림을 다시 만든 뒤 바꾼다.
  jump: require('@/assets/images/acty/01-jump.png'), // 01 점프 환호
  run: require('@/assets/images/acty/02-run.png'), // 02 달리기 결의
  dizzy: require('@/assets/images/acty/03-dizzy.png'), // 03 뻗음 어지러움
  breathe: require('@/assets/images/acty/04-breathe.png'), // 04 명상 호흡
  shy: require('@/assets/images/acty/05-shy.png'), // 05 커튼뒤 수줍음
  hamlet: require('@/assets/images/acty/06-hamlet.png'), // 06 햄릿 해골
  sob: require('@/assets/images/acty/07-sob.png'), // 07 오열
  angry: require('@/assets/images/acty/08-angry.png'), // 08 분노
  surprised: require('@/assets/images/acty/09-surprised.png'), // 09 깜짝 놀람
  smug: require('@/assets/images/acty/10-smug.png'), // 10 으쓱 팔짱
  love: require('@/assets/images/acty/11-love.png'), // 11 하트눈 대본
  wink: require('@/assets/images/acty/12-wink.png'), // 12 윙크
  flat: require('@/assets/images/acty/13-flat.png'), // 13 납작 민망
  dance: require('@/assets/images/acty/14-dance.png'), // 14 춤
  whisper: require('@/assets/images/acty/15-whisper.png'), // 15 속삭임
  bow: require('@/assets/images/acty/16-bow.png'), // 16 조명아래 인사
  slate: require('@/assets/images/acty/17-slate.png'), // 17 슬레이트
  selfie: require('@/assets/images/acty/18-selfie.png'), // 18 셀카촬영
  nervous: require('@/assets/images/acty/19-nervous.png'), // 19 대본뒤 덜덜
  yawn: require('@/assets/images/acty/20-yawn.png'), // 20 하품 기지개
};

/** 홈 머리에서 날마다 돌아가며 나오는 밝은 자세들. */
export const HOME_POSES: readonly MascotPose[] = ['home', 'jump', 'wink', 'dance', 'bow', 'smug'];

/** 기기 시간대 기준 오늘의 자세 — 하루 동안은 같다. */
export function dailyPose(poses: readonly MascotPose[], now: Date = new Date()): MascotPose {
  return poses[dailyIndex(poses.length, now)];
}

/** pen 에서 쓰는 크기 — 그림 비율(약 9:10)을 지킨다. */
export const MASCOT_SIZE = {
  /** 질문 대화 코치 머리줄(30×36) — pen 09 「Coach Message」. */
  chat: { width: 30, height: 36 },
  /** 대화 머리(36×40). */
  xs: { width: 36, height: 40 },
  /** 홈 카드(48×54). */
  card: { width: 48, height: 54 },
  /** 마스코트 줄·리딩/챌린지 마무리(52×58). */
  sm: { width: 52, height: 58 },
  /** 질문 말풍선 옆(52×61) — pen 「온보딩 / 질문 말풍선」. */
  bubble: { width: 52, height: 61 },
  /** 예전 말풍선 옆(70×78). */
  md: { width: 70, height: 78 },
  /** 상태 화면 가운데(84×94). */
  lg: { width: 84, height: 94 },
  /** 첫 가이드 말풍선(86×96). */
  guide: { width: 86, height: 96 },
  /** 빈 상태(96×106) — 개편후 모양 화면(components/ds)이 쓴다. */
  empty: { width: 96, height: 106 },
  /** 가입할 수 없어요(120×132). */
  xl: { width: 120, height: 132 },
  /** 가입 시작·광고성 정보 결과 팝업 뒤(127×142). */
  intro: { width: 127, height: 142 },
  /** 온보딩 시작(150×168). */
  hero: { width: 150, height: 168 },
} as const;
