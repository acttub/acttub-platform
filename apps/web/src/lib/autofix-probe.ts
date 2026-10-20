// Sentry 자동 수정 흐름 시험용 파일. 시험이 끝나면 브랜치째 지운다.
export function familyInitial(name: string): string {
  return name.split(" ")[1]?.slice(0, 1) ?? "";
}
