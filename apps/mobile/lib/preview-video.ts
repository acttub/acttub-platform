import type { VideoSource } from 'expo-video';

/**
 * 개발용 미리보기 영상 한 개.
 *
 * '영상·장면 보기' 를 눌렀을 때 무엇이 나오는지 확인하려면 영상이 필요한데, 미리보기
 * 통로에는 배우가 올린 파일이 없다. 그래서 번들에 든 테스트 패턴 4초짜리(75KB)를
 * 대신 그린다. 실제 테이크로 착각하지 않도록 일부러 색 막대 패턴을 쓴다.
 *
 * `__DEV__` 를 여기서 한 번만 확인한다 — 화면마다 따로 가드를 두면 한 군데를 빼먹었을 때
 * 배포 빌드에서 가짜 영상이 뜬다.
 */
export function previewVideoSource(): VideoSource | null {
  if (!__DEV__) return null;
  return require('@/assets/dev/sample-take.mp4');
}
