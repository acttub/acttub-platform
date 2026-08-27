/**
 * DOCX → 텍스트. 브라우저 안에서 처리한다(서버로 안 간다).
 * 서식은 버리고 글자만 가져온다 — 대본에 필요한 것은 누가 무슨 말을 하느냐뿐이다.
 */
export async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}
