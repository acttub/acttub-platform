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

const STATUS_LABEL: Record<string, string> = { open: "확인 중", closed: "종료" };

/** 서버의 문의 상태는 open·closed 둘이다(app.support-inquiry). 모르는 값은 「확인 중」으로 보인다. */
export function inquiryStatusLabel(status: MyInquiry["status"]): string {
  return STATUS_LABEL[status] ?? "확인 중";
}

/** 10월 28일. 읽지 못하면 빈 문자열. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(date);
}

/** 마케팅(혜택·이벤트 소식) 문서 종류. */
export const MARKETING_TYPES: readonly string[] = ["marketing_email", "marketing_push"];
