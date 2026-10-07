"use client";

/**
 * 대본 넣기 화면의 상태. 나누는 동안은 진행 숫자를 든 대화상자 하나, 끝나면 결과 대화상자 하나다(reading.script).
 * 흐름 자체는 src/lib/reading/script/import.ts 가 맡고, 여기서는 서버 함수를 잇고 화면 상태로 옮긴다.
 */
import { useEffect, useRef, useState } from "react";
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

export type ScriptImportDeps = ImportDeps & { getScript: typeof getScript };

const apiDeps: ScriptImportDeps = {
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
  getScript,
};

export type ImportDialog = Exclude<ImportOutcome, { kind: "saved" }>;

export type ImportView =
  | { kind: "idle" }
  | { kind: "splitting"; progress: ImportProgress | null }
  | { kind: "dialog"; dialog: ImportDialog; attempt: ImportAttempt };

export interface ScriptImporter {
  view: ImportView;
  start: (input: ScriptInput) => void;
  /** R2.7 [새로 넣기]·R2.8 [그래도 나누기] */
  retry: (flag: "allowDuplicate" | "skipScriptCheck") => void;
  /** R2.14 [동의하고 나누기] */
  agree: () => void;
  close: () => void;
}

export function useScriptImport(onSaved: () => void, deps: ScriptImportDeps = apiDeps): ScriptImporter {
  const [view, setView] = useState<ImportView>({ kind: "idle" });
  const live = useRef<AbortController | null>(null);
  // 화면을 떠나면 폴링을 멈춘다. 서버 작업은 그대로 끝나 대본 목록에 생기고, 다른 화면을 이 결과로 옮기지 않는다.
  useEffect(() => () => live.current?.abort(), []);

  type Step = (deps: ImportDeps, onProgress: (p: ImportProgress) => void) => Promise<{ outcome: ImportOutcome; attempt: ImportAttempt }>;
  const run = async (step: Step) => {
    const controller = new AbortController();
    live.current = controller;
    const { signal } = controller;
    const bound: ImportDeps = { ...deps, getImport: (id) => deps.getImport(id, signal), wait: (ms) => deps.wait(ms, signal) };
    setView({ kind: "splitting", progress: null });
    const { outcome, attempt } = await step(bound, (progress) => {
      if (!signal.aborted) setView({ kind: "splitting", progress });
    });
    if (signal.aborted) return;
    if (outcome.kind !== "saved") {
      setView({ kind: "dialog", dialog: outcome, attempt });
      return;
    }
    try {
      const detail = await deps.getScript(outcome.scriptId, { signal });
      if (signal.aborted) return;
      adoptScript(detail);
      onSaved();
    } catch {
      if (!signal.aborted) setView({ kind: "dialog", dialog: { kind: "failed", message: IMPORT_FAILED_COPY }, attempt });
    }
  };

  const attemptInDialog = () => (view.kind === "dialog" ? view.attempt : null);

  return {
    view,
    start: (input) => {
      if (view.kind === "splitting") return;
      void run((d, onProgress) => runImport(newAttempt(input), d, onProgress));
    },
    retry: (flag) => {
      const attempt = attemptInDialog();
      if (attempt) void run((d, onProgress) => runImport(retryWith(attempt, flag), d, onProgress));
    },
    agree: () => {
      const attempt = attemptInDialog();
      if (attempt) void run((d, onProgress) => agreeAndRetry(attempt, d, onProgress));
    },
    close: () => setView({ kind: "idle" }),
  };
}
