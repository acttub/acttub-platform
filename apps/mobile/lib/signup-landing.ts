/**
 * 가입(프로필 저장)을 마친 뒤 홈 위에 한 번 더 열 화면(SOMA-864). 입시 준비를 고른 배우는 입시 예시 대본 고르기로 간다.
 * 가입 화면이 저장 직전에 얹고, 화면을 옮기는 _layout 이 한 번 꺼내 간다.
 */
let landing: string | null = null;

export function setSignupLanding(route: string | null): void {
  landing = route;
}

export function takeSignupLanding(): string | null {
  const route = landing;
  landing = null;
  return route;
}

/** 경력에 따라 가입 직후 열 화면. 입시생이 아니면 null(홈 그대로). */
export function signupLandingFor(experience: string | null | undefined): string | null {
  return experience === 'exam_prep' ? '/reading/sample?exam=1' : null;
}
