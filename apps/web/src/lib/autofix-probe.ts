// Sentry 자동 수정 흐름 시험용 파일. 시험이 끝나면 브랜치째 지운다.
export function lastWordLength(text: string): number {
  return text.trim().split(" ").at(-1)!.match(/\S+/)![0].length;
}
