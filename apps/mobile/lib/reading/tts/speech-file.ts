/**
 * 대본을 읽어 준 음성 합성 파일의 이름. 엔진이 문장마다 캐시 폴더에 하나씩 만들고, 탈퇴 때
 * 같은 모양으로 찾아 지운다(local-account-data) — 만드는 쪽과 찾는 쪽이 어긋나지 않게 한곳에 둔다.
 *
 * <p>이름이 두 가지다 (SOMA-547).
 * <ul>
 *   <li>{@link speechFileName} — 만든 시각으로 짓던 옛 이름. 같은 문장을 다시 읽어도 새 파일이
 *       생겨 다시 쓸 수 없었다. 기기에 남아 있는 옛 파일을 계속 찾아 지우려고 규칙만 남긴다.
 *   <li>{@link speechScriptFileName} — 대본과 내용으로 짓는 지금 이름. 같은 문장·같은 설정이면
 *       같은 이름이라 다시 만들지 않고, 앞부분이 대본이라 그 대본만 골라 지울 수 있다.
 * </ul>
 */

/** 이름에 넣을 수 있게 다듬는다 — 파일 이름에 쓸 수 없는 글자를 없앤다. */
function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '');
}

/** @deprecated 새로 만들 때는 {@link speechScriptFileName} 을 쓴다. 옛 파일을 찾기 위해 남긴다. */
export function speechFileName(now: number): string {
  return `reading-${now}.wav`;
}

/** 대본 하나에 딸린 음성. 같은 대본·같은 내용이면 항상 같은 이름이다. */
export function speechScriptFileName(scriptId: string, key: string): string {
  return `reading-${safe(scriptId)}-${safe(key)}.wav`;
}

/** 이 대본이 만든 음성인가 — 대본을 지울 때 그 대본 것만 고른다. */
export function isSpeechFileOfScript(name: string, scriptId: string): boolean {
  return isSpeechFileName(name) && name.startsWith(`reading-${safe(scriptId)}-`);
}

export function isSpeechFileName(name: string): boolean {
  return /^reading-[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)?\.wav$/.test(name);
}
