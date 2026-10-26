/**
 * 연습 화면 로고가 가리키는 소개 주소. 랜딩(/)은 게스트도 더는 /home 으로 넘기지 않지만,
 * 이미 퍼진 ?intro=1 주소와 유입 구분을 위해 그대로 둔다.
 */
export const LANDING_INTRO_HREF = "/?intro=1";

export function wantsLandingIntro(search: string): boolean {
  return new URLSearchParams(search).get("intro") === "1";
}
