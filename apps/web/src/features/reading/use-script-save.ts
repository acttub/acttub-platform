"use client";

/**
 * 확인 화면의 저장 버튼이 쓰는 상태. 같은 본문에는 같은 요청 id 를 다시 쓴다 — 실패 뒤 다시
 * 눌러도 서버에는 대본이 하나다(reading.script). 본문·배역·제목이 바뀌면 새 요청이다.
 */
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/api/v2/errors";
import { newRequestId } from "@/lib/reading/request-id";
import { toCreateRequest, type ScriptDraft } from "@/lib/reading/draft";
import type { StoredScript } from "@/lib/reading/storage";
import { saveScriptDraft } from "@/features/reading/script-save";

export const SAVE_FAILED_COPY = "대본을 저장하지 못했어요. 다시 시도해 주세요.";

export interface ScriptSave {
  save: (draft: ScriptDraft) => Promise<void>;
  saving: boolean;
  error: string | null;
}

export function useScriptSave(onSaved: (script: StoredScript) => void): ScriptSave {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);

  const requestIdFor = (draft: ScriptDraft) => {
    const key = JSON.stringify(toCreateRequest(draft).request);
    if (request.current?.key !== key) request.current = { key, id: newRequestId() };
    return request.current.id;
  };

  const save = async (draft: ScriptDraft) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveScriptDraft(draft, requestIdFor(draft)));
    } catch (cause) {
      setError(errorMessage(cause, SAVE_FAILED_COPY));
      setSaving(false);
    }
  };

  return { save, saving, error };
}
