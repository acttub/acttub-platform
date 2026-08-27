/**
 * HWP(한글) → 텍스트. 브라우저 안에서 처리한다(서버로 안 간다).
 *
 * 대본에서는 탭이 뜻을 갖는다 — 배역과 대사를 탭으로 가르는 대본이 많아서
 * 공백으로 뭉개지 않고 그대로 남긴다.
 *
 * 한글 97(HWP 3.0)은 형식이 완전히 달라 이 라이브러리가 읽지 못한다.
 * 그때는 무엇을 해야 하는지 알려 주는 편이 낫다.
 */

/** 문단 안의 글자 하나. 값이 숫자면 글자가 아니라 제어 부호다. */
interface HwpChar {
  value: string | number;
}

export class OldHwpError extends Error {
  constructor() {
    super("한글 97 이전 형식이라 열 수 없어요.");
    this.name = "OldHwpError";
  }
}

/** 한글 97 파일은 첫머리가 "HWP Document File" 로 시작한다. */
export function isOldHwp(bytes: Uint8Array): boolean {
  let head = "";
  for (let i = 0; i < Math.min(17, bytes.length); i++) head += String.fromCharCode(bytes[i]);
  return head.startsWith("HWP Document File");
}

const NUL = String.fromCharCode(0);

export async function extractHwpText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isOldHwp(bytes)) throw new OldHwpError();

  const { parse } = await import("hwp.js");
  const doc = parse(bytes, { type: "array" }) as unknown as {
    sections?: { content?: { content?: HwpChar[] }[] }[];
  };

  const lines: string[] = [];
  for (const section of doc.sections ?? []) {
    for (const paragraph of section.content ?? []) {
      let text = "";
      for (const ch of paragraph.content ?? []) {
        const v = ch.value;
        if (typeof v === "string") text += v;
        // 9는 탭. 13은 문단 끝이고 그 밖의 부호는 글자가 아니다.
        else if (v === 9) text += "\t";
      }
      lines.push(text.split(NUL).join("").trimEnd());
    }
  }
  return lines.join("\n");
}
