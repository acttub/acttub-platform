/**
 * 이 브라우저에 게스트 연습 기록이 있으면 랜딩(/)은 바로 /home 으로 보낸다.
 * 연습 화면 로고를 눌러 일부러 랜딩을 보러 온 경우만 이 표시로 구분한다.
 */
export const LANDING_INTRO_HREF = "/?intro=1";

export function wantsLandingIntro(search: string): boolean {
  return new URLSearchParams(search).get("intro") === "1";
}
