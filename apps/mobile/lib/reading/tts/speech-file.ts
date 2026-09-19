/**
 * 대본을 읽어 준 음성 합성 파일의 이름. 엔진이 문장마다 캐시 폴더에 하나씩 만들고, 탈퇴 때
 * 같은 모양으로 찾아 지운다(local-account-data) — 만드는 쪽과 찾는 쪽이 어긋나지 않게 한곳에 둔다.
 */
export function speechFileName(now: number): string {
  return `reading-${now}.wav`;
}

export function isSpeechFileName(name: string): boolean {
  return /^reading-\d+\.wav$/.test(name);
}
