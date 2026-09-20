/**
 * 확인 화면의 "저장" 과 목록 카드의 "열기" 가 하는 일. 서버에 저장하거나 받은 대본을 기기 캐시에
 * 두고, 이전 대본의 설정·결과를 버린다. 화면은 이 둘을 부르고 결과로 옮겨 가기만 한다.
 */
import { createScript, getScript } from "@/lib/api/v2/reading-scripts";
import { READING_SCRIPT_MESSAGES } from "@/lib/api/v2/errors";
import type { ScriptDetail } from "@/lib/reading/api-types";
import { toCreateRequest, type DraftCheck, type ScriptDraft } from "@/lib/reading/draft";
import { toStoredScript } from "@/lib/reading/script/from-server";
import { storage, type StoredScript } from "@/lib/reading/storage";

/** 기기 쪽 검사에 걸려 보내지 않은 것. 서버의 같은 사유 422 와 같은 문구를 든다. */
export class DraftRejectedError extends Error {
  constructor(readonly code: Exclude<DraftCheck, { ok: true }>["code"]) {
    super(READING_SCRIPT_MESSAGES[code]);
    this.name = "DraftRejectedError";
  }
}

/** 서버가 돌려준 대본을 지금 대본으로 든다. 다른 대본이므로 하던 회차·결과는 버린다. */
export function adoptScript(detail: ScriptDetail): StoredScript {
  return adoptStoredScript(toStoredScript(detail));
}

/** 이미 화면 모양으로 바꾼 대본(상세 화면이 받은 것)을 지금 대본으로 든다. */
export function adoptStoredScript(stored: StoredScript): StoredScript {
  storage.saveScript(stored);
  storage.saveSession(null);
  storage.saveStats(null);
  return stored;
}

/**
 * 초안을 서버에 저장한다. 저장이 끝나면 초안은 버린다 — 확인 화면에서 나가면 아무것도 남지
 * 않는다는 규칙의 반대편이다.
 */
export async function saveScriptDraft(
  draft: ScriptDraft,
  requestId: string,
  options: { signal?: AbortSignal } = {},
): Promise<StoredScript> {
  const { request, check } = toCreateRequest(draft);
  if (!check.ok) throw new DraftRejectedError(check.code);
  const { script } = await createScript(request, { requestId, signal: options.signal });
  const stored = adoptScript(script);
  storage.saveDraft(null);
  return stored;
}

/** 목록에서 고른 대본을 서버에서 받아 지금 대본으로 든다. */
export async function openScript(scriptId: string, options: { signal?: AbortSignal } = {}): Promise<StoredScript> {
  return adoptScript(await getScript(scriptId, options));
}
