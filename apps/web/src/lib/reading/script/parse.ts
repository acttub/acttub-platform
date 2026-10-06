/**
 * 대본 줄의 화면 모양. 배역·줄은 서버가 나누고(reading.script) 기기는 그 결과를 이 모양으로 들고 그린다
 * (src/lib/reading/script/from-server.ts).
 */

export type DialogueLine = { type: "dialogue"; role: string; text: string };
export type DirectionLine = { type: "direction"; text: string };
/** 막·장 머리 줄. 배역이 없고 구간 선택의 "장면으로 찾기"가 경계로 쓴다(reading.session). */
export type SceneLine = { type: "scene"; text: string };
export type ScriptLine = DialogueLine | DirectionLine | SceneLine;

/**
 * 줄마다 대사 번호. 대사 줄만 1부터 세고 지문·장면은 null 이다 — 화면이 "12번 대사"로 쓰는
 * 값이며 저장하지 않고 줄 순서에서 센다(reading.script).
 */
export function dialogueNumbers(lines: ScriptLine[]): (number | null)[] {
  let n = 0;
  return lines.map((l) => (l.type === "dialogue" ? ++n : null));
}

/** TTS로 읽을 때 괄호 지문·따옴표를 뺀 본문. */
export function speakableText(text: string): string {
  return text
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, " ")
    .replace(/["“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
