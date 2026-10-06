"use client";

/**
 * 대본 넣기 화면의 상태. 나누는 동안은 진행 숫자를 든 대화상자 하나, 끝나면 결과 대화상자 하나다(reading.script).
 * 흐름 자체는 src/lib/reading/script/import.ts 가 맡고, 여기서는 서버 함수를 잇고 화면 상태로 옮긴다.
 */
import { useState } from "react";
import { listConsentDocuments, recordConsent } from "@/lib/api/v2/consents";
import { completeUpload, createUpload, getImport, putUpload, startImport } from "@/lib/api/v2/reading-imports";
import { getScript } from "@/lib/api/v2/reading-scripts";
import { wait } from "@/lib/api/v2/idempotency";
import {
  agreeAndRetry,
  IMPORT_FAILED_COPY,
  newAttempt,
  retryWith,
  runImport,
  type ImportAttempt,
  type ImportDeps,
  type ImportOutcome,
  type ImportProgress,
  type ScriptInput,
} from "@/lib/reading/script/import";
import { adoptScript } from "@/features/reading/script-save";

const deps: ImportDeps = {
  createUpload,
  putUpload,
  completeUpload,
  startImport,
  getImport,
  wait,
  now: () => Date.now(),
  listConsentDocuments: async () => (await listConsentDocuments()).documents,
  grantConsent: async (documentId) => {
    await recordConsent({ document_id: documentId, action: "granted" });
  },
};

export type ImportDialog = Exclude<ImportOutcome, { kind: "saved" }>;

export type ImportView =
  | { kind: "idle" }
  | { kind: "splitting"; progress: ImportProgress | null }
  | { kind: "dialog"; dialog: ImportDialog; attempt: ImportAttempt };

export interface ScriptImport {
  view: ImportView;
  start: (input: ScriptInput) => void;
  /** R2.7 [새로 넣기]·R2.8 [그래도 나누기] */
  retry: (flag: "allowDuplicate" | "skipScriptCheck") => void;
  /** R2.14 [동의하고 나누기] */
  agree: () => void;
  close: () => void;
}

export function useScriptImport(onSaved: () => void): ScriptImport {
  const [view, setView] = useState<ImportView>({ kind: "idle" });

  const run = async (step: (onProgress: (p: ImportProgress) => void) => Promise<{ outcome: ImportOutcome; attempt: ImportAttempt }>) => {
    setView({ kind: "splitting", progress: null });
    const { outcome, attempt } = await step((progress) => setView({ kind: "splitting", progress }));
    if (outcome.kind !== "saved") {
      setView({ kind: "dialog", dialog: outcome, attempt });
      return;
    }
    try {
      adoptScript(await getScript(outcome.scriptId));
      onSaved();
    } catch {
      setView({ kind: "dialog", dialog: { kind: "failed", message: IMPORT_FAILED_COPY }, attempt });
    }
  };

  const attemptInDialog = () => (view.kind === "dialog" ? view.attempt : null);

  return {
    view,
    start: (input) => {
      if (view.kind === "splitting") return;
      void run((onProgress) => runImport(newAttempt(input), deps, onProgress));
    },
    retry: (flag) => {
      const attempt = attemptInDialog();
      if (attempt) void run((onProgress) => runImport(retryWith(attempt, flag), deps, onProgress));
    },
    agree: () => {
      const attempt = attemptInDialog();
      if (attempt) void run((onProgress) => agreeAndRetry(attempt, deps, onProgress));
    },
    close: () => setView({ kind: "idle" }),
  };
}
