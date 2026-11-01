// 내 계정 화면의 표시 규칙(SOMA-834). 화면 없이 테스트한다.
import type { MyInquiry } from "@/lib/api/v2/support";

export const PROVIDER_NAME: Record<string, string> = { google: "구글", naver: "네이버", kakao: "카카오", apple: "애플" };

/** 이메일 앞부분을 가린다: abcd@x.com -> a••••@x.com. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "없어요";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, 1)}••••${email.slice(at)}`;
}

const STATUS: Record<string, { label: string; tone: "blue" | "gray" }> = {
  open: { label: "확인 중", tone: "gray" },
  answered: { label: "답변 완료", tone: "blue" },
  closed: { label: "종료", tone: "gray" },
};

export function inquiryStatus(status: MyInquiry["status"]): { label: string; tone: "blue" | "gray" } {
  return STATUS[status] ?? { label: "확인 중", tone: "gray" };
}

/** 10월 28일. 읽지 못하면 빈 문자열. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(date);
}

/** 마케팅(혜택·이벤트 소식) 문서 종류. */
export const MARKETING_TYPES: readonly string[] = ["marketing_email", "marketing_push"];
