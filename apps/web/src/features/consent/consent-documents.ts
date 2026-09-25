import { listConsentDocuments, listConsentNotices } from "@/lib/api/v2/consents";
import type { ConsentDocument, ConsentNotice } from "@/lib/api/v2/types";

// 동의 문서 공개 페이지(/terms)가 그리는 것의 순수한 부분(account.consent).

export type ConsentDocumentsPageData = {
  /** 동의 문서의 현재 판. 판과 시행일이 있고 기능 안의 시트에서 결정을 받는다. */
  documents: ConsentDocument[];
  /** 개인정보 처리방침 같은 고지. 결정 대상이 아니라서 판도 결정 버튼도 없다(결정 I-6). */
  notices: ConsentNotice[];
};

/**
 * 둘을 함께 받는다. 하나라도 못 받으면 실패다 — 처리방침이 빠진 반쪽 페이지는 처리방침이
 * 없는 것처럼 보이므로, 그리지 않고 다시 시도하게 한다.
 */
export async function loadConsentDocumentsPage(
  signal?: AbortSignal,
): Promise<ConsentDocumentsPageData> {
  const [{ documents }, { notices }] = await Promise.all([
    listConsentDocuments({ signal }),
    listConsentNotices({ signal }),
  ]);
  return { documents, notices };
}
