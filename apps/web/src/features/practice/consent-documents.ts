import {
  getPendingConsents as fetchPendingConsents,
  listConsentDocuments,
} from "@/lib/api/v2/consents";
import type { ConsentDocument } from "@/lib/api/v2/types";
import { isLoggedIn } from "@/lib/auth/token-store";
import {
  getPendingConsents as getStoredPendingConsents,
  savePendingConsents,
} from "@/features/auth/pending-consents";

export type ConsentDocuments = {
  /**
   * `pending` 은 받을 동의가 남았다는 뜻이다 — 화면이 체크박스를 그리고 앱으로 들여보내기
   * 전에 막는다. `info` 는 그냥 읽으러 온 것이다(랜딩의 "안전 약속").
   */
  mode: "pending" | "info";
  documents: ConsentDocument[];
};

/**
 * 어느 문서를 보여 줄지 세 곳에 차례로 묻는다 — 기기에 남은 것, 서버가 남았다고 하는 것,
 * 그리고 전체 목록. 앞의 둘에서 답이 나오면 거기서 멈춘다.
 *
 * 이 순서가 뜻하는 것: 기기에 남은 것이 가장 빠르고(로그인 직후 여기로 오는 길이 그것을
 * 심어 둔다), 서버는 그것이 없을 때만 묻는다. 서버가 남았다고 하면 다음 진입이 서버를
 * 다시 묻지 않게 기기에도 심는다.
 *
 * 화면 밖으로 뽑은 까닭은 이 세 단계를 실제로 돌려 볼 표면이 없었기 때문이다 — 컴포넌트
 * 안 이펙트에 있는 동안에는 마크업 단언 없이 순서를 확인할 길이 없었다.
 */
export async function loadConsentDocuments(
  signal?: AbortSignal,
): Promise<ConsentDocuments> {
  const stored = getStoredPendingConsents();
  if (stored.length > 0) return { mode: "pending", documents: stored };

  if (isLoggedIn()) {
    const serverPending = await fetchPendingConsents({ signal });
    if (serverPending.documents.length > 0) {
      savePendingConsents(serverPending.documents);
      return { mode: "pending", documents: serverPending.documents };
    }
  }

  const response = await listConsentDocuments({ signal });
  return { mode: "info", documents: response.documents };
}
