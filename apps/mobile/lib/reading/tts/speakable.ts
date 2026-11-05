/**
 * TTS로 읽을 때 괄호 지문·따옴표를 뺀 본문. 닫히지 않은 괄호는 어디까지 지문인지 몰라 괄호 글자만 빼고 읽는다 —
 * 침묵으로 넘기는 것보다 낫다(11/5 「대사가 씹힘」 제보).
 */
export function speakableText(text: string): string {
  return text
    .replace(/[(（[【][^)）\]】]*[)）\]】]/g, ' ')
    .replace(/[(（[【)）\]】]/g, ' ')
    .replace(/["“”'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
