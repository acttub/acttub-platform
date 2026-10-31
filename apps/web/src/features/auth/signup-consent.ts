// 웹 가입 동의 줄 구성(SOMA-834). 앱 가입 화면(apps/mobile/app/consent.tsx, lib/consent-entry-submission.ts)과 같은 묶음 규칙을 따른다.
// 줄은 넷이다: [필수] 만 14세 이상 · 이용약관, [필수] 개인정보 처리 · AI 분석, [선택] 탈퇴 후 영상·녹음 보관, [선택] 혜택·이벤트 소식.
import type { SignupDecision } from "@/lib/api/v2/auth";
import type { ConsentDocument } from "@/lib/api/v2/types";

export type ConsentChoice = "granted" | "declined";

export type ConsentLine = {
  key: string;
  required: boolean;
  label: string;
  documents: ConsentDocument[];
  /** 이 줄이 만 14세 확인을 함께 켠다(「만 14세 이상 · 이용약관」). */
  age?: boolean;
};

/** 가입 화면에서 묻지 않는 선택 문서(개인정보 동의에 들어 있어 기능 안에서 따로 묻는다). 제출에서는 거절로 채운다. */
const DEFERRED_TYPES = ["cloud_voice", "script_split"];
const MARKETING_TYPES = ["marketing_email", "marketing_push"];

const LABEL: Record<string, string> = {
  terms: "만 14세 이상 · 이용약관",
  privacy: "개인정보 처리 · AI 분석",
  retention: "탈퇴 후 영상·녹음 보관",
  post_withdrawal_retention: "탈퇴 후 영상·녹음 보관",
};
const MARKETING_LABEL = "혜택·이벤트 소식 받기";
const AGE_LABEL = "만 14세 이상이에요";

export function consentLines(documents: readonly ConsentDocument[]): ConsentLine[] {
  const visible = documents.filter((d) => d.required || !DEFERRED_TYPES.includes(d.type));
  const required = visible.filter((d) => d.required);
  const optional = visible.filter((d) => !d.required && !MARKETING_TYPES.includes(d.type));
  const marketing = visible.filter((d) => !d.required && MARKETING_TYPES.includes(d.type));

  const terms = required.find((d) => d.type === "terms");
  const privacy = required.find((d) => d.type === "privacy");
  const lines: ConsentLine[] = [];
  if (!terms) lines.push({ key: "age", required: true, label: AGE_LABEL, documents: [], age: true });
  for (const document of required) {
    // AI 분석 동의는 개인정보 줄에 묶어 한 번에 받는다.
    if (privacy && document.type === "ai_analysis") continue;
    const extra = document === privacy ? required.filter((d) => d.type === "ai_analysis") : [];
    lines.push({
      key: document.id,
      required: true,
      label: LABEL[document.type] ?? document.title,
      documents: [document, ...extra],
      age: document === terms,
    });
  }
  for (const document of optional) {
    lines.push({ key: document.id, required: false, label: LABEL[document.type] ?? document.title, documents: [document] });
  }
  if (marketing.length > 0) lines.push({ key: "marketing", required: false, label: MARKETING_LABEL, documents: marketing });
  return lines;
}

export function lineChecked(line: ConsentLine, choices: Readonly<Record<string, ConsentChoice>>, ageConfirmed: boolean): boolean {
  return (!line.age || ageConfirmed) && line.documents.every((d) => choices[d.id] === "granted");
}

/** 줄을 누르면 켜고, 켜져 있으면 끈다. 끄면 그 줄의 문서 결정은 비운다(선택 줄은 거절이 된다). */
export function toggleLine(
  line: ConsentLine,
  choices: Readonly<Record<string, ConsentChoice>>,
  ageConfirmed: boolean,
): { choices: Record<string, ConsentChoice>; ageConfirmed: boolean } {
  const off = lineChecked(line, choices, ageConfirmed);
  const next = { ...choices };
  for (const d of line.documents) {
    if (off) delete next[d.id];
    else next[d.id] = "granted";
  }
  return { choices: next, ageConfirmed: line.age ? !off : ageConfirmed };
}

/** 모두 동의하기. 선택 줄까지 한 번에 켜거나(이미 모두 켜져 있으면) 한 번에 끈다. */
export function toggleAll(
  lines: readonly ConsentLine[],
  choices: Readonly<Record<string, ConsentChoice>>,
  ageConfirmed: boolean,
): { choices: Record<string, ConsentChoice>; ageConfirmed: boolean } {
  const off = lines.length > 0 && lines.every((l) => lineChecked(l, choices, ageConfirmed));
  const next = { ...choices };
  for (const line of lines) for (const d of line.documents) {
    if (off) delete next[d.id];
    else next[d.id] = "granted";
  }
  return { choices: next, ageConfirmed: !off };
}

/** 필수 문서에 모두 동의하고 만 14세를 확인했으면 제출할 수 있다. */
export function canSubmit(documents: readonly ConsentDocument[], choices: Readonly<Record<string, ConsentChoice>>, ageConfirmed: boolean): boolean {
  return ageConfirmed && documents.length > 0 && documents.every((d) => !d.required || choices[d.id] === "granted");
}

/** 서버로 보낼 결정. 안 고른 선택 문서(가입 화면에서 뺀 것 포함)는 거절로 채운다. */
export function buildDecisions(documents: readonly ConsentDocument[], choices: Readonly<Record<string, ConsentChoice>>): SignupDecision[] {
  return documents.map((d) => ({ document_id: d.id, action: choices[d.id] ?? "declined" }));
}

/** 가입 제출이 실패했을 때 화면이 할 일. */
export function signupFailureAction(error: unknown): "restart" | "retry" {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "invalid_signup_token" || code === "account_exists_with_different_provider" || code === "consent_document_outdated" || code === "consent_document_not_found"
    ? "restart"
    : "retry";
}
