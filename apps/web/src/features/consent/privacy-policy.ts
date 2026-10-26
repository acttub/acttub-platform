import { listConsentNotices } from "@/lib/api/v2/consents";
import type { ConsentNotice } from "@/lib/api/v2/types";

// 개인정보 처리방침 공개 페이지(/privacy)가 그리는 것의 순수한 부분. 정본은 서버의
// consent-docs/privacy_policy.md 이고 /terms 와 같은 GET /v2/consents/notices 로 받는다.

/** 처리방침이 응답에 없으면 실패로 본다 — 빈 페이지는 처리방침이 없는 것처럼 보인다. */
export class PrivacyPolicyMissingError extends Error {
  constructor() {
    super("개인정보 처리방침을 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    this.name = "PrivacyPolicyMissingError";
  }
}

export async function loadPrivacyPolicy(signal?: AbortSignal): Promise<ConsentNotice> {
  const { notices } = await listConsentNotices({ signal });
  const policy = notices.find((notice) => notice.type === "privacy_policy");
  if (!policy) throw new PrivacyPolicyMissingError();
  return policy;
}
