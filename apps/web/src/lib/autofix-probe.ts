// Sentry 자동 수정 흐름 시험용 파일. 시험이 끝나면 브랜치째 지운다.
// 연습 영상 타임코드("분:초")를 초로 바꾼다.
export function timecodeToSeconds(timecode: string): number {
  const [minutes, seconds] = timecode.split(":");
  // 콜론이 없으면 초만 들어온 것으로 본다.
  if (seconds === undefined) return Number(minutes);
  return Number(minutes) * 60 + Number(seconds.padStart(2, "0"));
}
