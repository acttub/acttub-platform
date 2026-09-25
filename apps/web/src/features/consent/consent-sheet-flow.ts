import { recordConsent } from "@/lib/api/v2/consents";
import { ApiError, errorMessage } from "@/lib/api/v2/errors";
import type { ConsentDocument } from "@/lib/api/v2/types";

import {
  clearAgeConfirmed,
  markAgeConfirmed,
  needsAgeConfirmation,
} from "./guest-consent-state";

// 게스트의 기능별 동의 시트가 하는 일(account.guest). 무엇을 묻는지는 서버가 403 에 실어
// 준 빠진 문서가 정한다 — 기능마다 어떤 문서가 필요한지는 여기에 없다. 그래서 연습에
// 동의한 뒤 리딩에서 같은 문서를 다시 묻지 않는 것도 서버의 목록을 그대로 따른 결과다.

export type ConsentSheet = {
  documents: ConsentDocument[];
  /** "만 14세 이상이에요" 확인 줄을 두는가. 게스트의 첫 시트에만 있다. */
  askAge: boolean;
};

export type ConsentSheetResult =
  /** 결정을 다 보냈다. 공용 클라이언트가 막혔던 요청을 다시 보낸다. */
  | { kind: "decided" }
  /** 확인 줄을 눌러야 한다. 시트는 그대로 둔다. */
  | { kind: "age_required" }
  | { kind: "failed"; message: string };

export function openSheet(pending: ConsentDocument[]): ConsentSheet {
  return {
    // 선택 문서는 회원에게만 묻는다. 게스트가 보내면 서버가 member_only 로 거절한다.
    documents: pending.filter((document) => document.required),
    askAge: needsAgeConfirmation(),
  };
}

export function canAgree(sheet: ConsentSheet, ageChecked: boolean): boolean {
  return sheet.documents.length > 0 && (!sheet.askAge || ageChecked);
}

function isStaleDocument(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    ((cause.status === 409 && cause.code === "consent_document_outdated") ||
      (cause.status === 404 && cause.code === "consent_document_not_found"))
  );
}

/**
 * 시트의 문서를 하나씩 동의로 보낸다. 결정은 쌓이기만 하고 같은 결정의 재전송은 200 이라
 * 중간에 끊긴 뒤 처음부터 다시 보내도 해롭지 않다.
 */
export async function submitSheet(
  sheet: ConsentSheet,
  ageChecked: boolean,
): Promise<ConsentSheetResult> {
  if (needsAgeConfirmation() && !ageChecked) return { kind: "age_required" };

  for (const document of sheet.documents) {
    try {
      await recordConsent({
        document_id: document.id,
        action: "granted",
        ...(needsAgeConfirmation() ? { age_confirmed: true as const } : {}),
      });
    } catch (cause) {
      // 그 사이 새 판이 나왔다. 다시 보낸 요청이 현재 판을 빠진 문서로 받아 오므로 넘어간다.
      if (isStaleDocument(cause)) continue;
      if (
        cause instanceof ApiError &&
        cause.status === 422 &&
        cause.code === "age_confirmation_required"
      ) {
        clearAgeConfirmed();
        return { kind: "age_required" };
      }
      return {
        kind: "failed",
        message: errorMessage(cause, "동의를 저장하지 못했어요. 다시 시도해 주세요."),
      };
    }
    markAgeConfirmed();
  }
  return { kind: "decided" };
}
