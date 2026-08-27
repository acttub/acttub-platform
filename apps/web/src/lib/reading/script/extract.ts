/**
 * 어떤 파일이든 대본 텍스트로. 확장자와 종류를 함께 보고 고른다 —
 * 브라우저가 hwp 의 종류를 모른다고 답하는 일이 흔하다.
 */
import { extractDocxText } from "@/lib/reading/script/docx";
import { extractHwpText, OldHwpError } from "@/lib/reading/script/hwp";
import { extractPdfText } from "@/lib/reading/script/pdf";

export type ScriptFileKind = "txt" | "pdf" | "hwp" | "docx" | "unknown";

export const ACCEPTED = ".txt,.pdf,.hwp,.docx,text/plain,application/pdf";

export function kindOf(file: File): ScriptFileKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".hwp")) return "hwp";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt") || file.type.startsWith("text/")) return "txt";
  return "unknown";
}

export class UnsupportedFileError extends Error {
  constructor(name: string) {
    super(`${name} 형식은 아직 못 읽어요. txt · pdf · hwp · docx 를 넣어 주세요.`);
    this.name = "UnsupportedFileError";
  }
}

export async function extractText(file: File): Promise<string> {
  switch (kindOf(file)) {
    case "pdf":
      return extractPdfText(file);
    case "hwp":
      return extractHwpText(file);
    case "docx":
      return extractDocxText(file);
    case "txt":
      return file.text();
    default:
      throw new UnsupportedFileError(file.name.split(".").pop() ?? "이");
  }
}

export { OldHwpError };
