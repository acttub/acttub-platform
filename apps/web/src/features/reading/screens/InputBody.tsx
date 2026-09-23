"use client";

import { useRef, useState } from "react";
import { deleteScript, listScripts } from "@/lib/api/v2/reading-scripts";
import { errorMessage } from "@/lib/api/v2/errors";
import { hasGuestSession } from "@/lib/auth/token-store";
import type { ScriptCard, ScriptListResponse } from "@/lib/reading/api-types";
import { newDraft, resolveDraft, updateDraft, type ScriptDraft } from "@/lib/reading/draft";
import { ACCEPTED, extractText, FileTooLargeError, OldHwpError, UnsupportedFileError } from "@/lib/reading/script/extract";
import { SAMPLE_SCRIPT } from "@/lib/reading/script/sample";
import { useResource } from "@/lib/react/use-resource";
import { activityLabel, COPYRIGHT_NOTICE, listHeadline, myCharactersLabel, statusChip } from "@/features/reading/script-list";
import { ScriptConfirmPanel } from "@/features/reading/screens/ScriptConfirmPanel";
import type { ScriptSave } from "@/features/reading/use-script-save";
import { Button, Card, CardTitle, Icon, OptionRow, StatusPill, StepsPill } from "@/features/reading/ui";

type Entry = "paste" | "write" | null;

export const UNREADABLE_FILE_COPY = "이 파일에서 글자를 읽지 못했어요. 텍스트를 복사해 붙여넣어 주세요.";
const LIST_FAILED_COPY = "저장한 대본을 불러오지 못했어요.";
const DELETE_FAILED_COPY = "대본을 지우지 못했어요. 다시 시도해 주세요.";

/**
 * 대본 넣기(D13)의 본문. 파일·붙여넣기·직접 쓰기·예시 가운데 한 길로 대본을 넣으면 기기가 배역과
 * 줄을 나눈다. 폰은 확인 화면(D16)으로 넘기고, 데스크톱은 오른쪽 열에서 확인·저장한다. 아래에는 이
 * 게스트가 저장해 둔 최근 대본 목록이 있다(reading.script).
 *
 * 화면 껍데기(Page)는 InputScreen 이 씌운다 — 껍데기가 next/link 를 끌어와 Node 에서 그려 볼 수 없어서,
 * 문구를 보는 테스트(tests/reading-script-screens.test.mjs)는 이 본문만 그린다.
 */
export function InputBody({
  initialDraft,
  save,
  onConfirm,
  onOpen,
}: {
  initialDraft: ScriptDraft | null;
  /** 데스크톱의 인라인 저장 */
  save: ScriptSave;
  /** 폰: 초안을 들고 확인 화면으로 */
  onConfirm: (draft: ScriptDraft) => void;
  /** 목록에서 대본을 골랐다 — 대본 상세로 간다 */
  onOpen: (scriptId: string) => void;
}) {
  const [draft, setDraft] = useState<ScriptDraft>(() => initialDraft ?? newDraft("", "typed"));
  const [entry, setEntry] = useState<Entry>(initialDraft?.raw ? "write" : null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasText = draft.raw.trim().length > 0;
  const { characters } = resolveDraft(draft);
  const canConfirm = hasText && characters.some((c) => !c.excluded);

  /** 새 본문은 새 초안이다 — 이전 본문에서 고친 이름·뺀 배역은 뜻이 없다. */
  const replaceRaw = (raw: string, source: ScriptDraft["source"]) => setDraft(newDraft(raw, source));

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setFileError(null);
    try {
      const text = await extractText(file);
      if (!text.trim()) setFileError(UNREADABLE_FILE_COPY);
      else {
        replaceRaw(text, "file");
        setEntry("write");
      }
    } catch (e) {
      if (e instanceof OldHwpError) {
        setFileError("한글 97 이전 형식이에요. 한글에서 열어 다시 저장하거나 다른 이름으로 저장에서 hwp를 고르면 열려요.");
      } else if (e instanceof UnsupportedFileError || e instanceof FileTooLargeError) {
        setFileError(e.message);
      } else {
        // 암호 걸린 PDF, 그림만 있는 PDF 등 — 서버에는 아무것도 남지 않는다.
        setFileError(UNREADABLE_FILE_COPY);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPaste() {
    setEntry("paste");
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) replaceRaw(text, "paste");
    } catch {
      /* 권한 없으면 아래 입력칸에 직접 붙여넣는다 */
    }
  }

  const confirmCard = (
    <Card>
      <CardTitle title="대본 확인" sub="찾은 배역을 확인하고 저장한 뒤 내 배역을 고릅니다." />
      {!hasText ? (
        <div className="rounded-[14px] border border-dashed border-line min-h-[200px] md:min-h-[300px] flex flex-col items-center justify-center gap-2.5 text-center px-6">
          <span className="w-7 h-7 rounded-full border-2 border-dashed border-ink-5" />
          <p className="text-[13px] text-ink-4 leading-relaxed">대본을 넣으면 배역과 대사 수가<br />여기에 나타나요.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 데스크톱은 여기서 확인·저장한다. 폰은 확인 화면으로 넘어간다. */}
          <div className="hidden md:block">
            <ScriptConfirmPanel draft={draft} onChange={setDraft} />
          </div>
          {save.error && <p className="hidden md:block text-[12.5px] text-red">{save.error}</p>}
          <Button size="lg" className="hidden md:flex" disabled={!canConfirm || save.saving} onClick={() => void save.save(draft)}>
            {save.saving ? "저장하는 중…" : "저장하고 배역 정하러 가기"}
          </Button>
          <p className="md:hidden text-[12.5px] text-ink-sub">
            배역 {characters.filter((c) => !c.excluded).length}명을 찾았어요. 다음 화면에서 확인하고 저장해요.
          </p>
          <Button size="lg" className="md:hidden" disabled={!hasText} onClick={() => onConfirm(draft)}>
            대본 확인하러 가기
          </Button>
        </div>
      )}
    </Card>
  );

  return (
    <div className="px-5 pt-5 md:px-0 md:pt-0 flex flex-col gap-4">
      <header>
        <p className="text-[13px] font-bold text-blue md:hidden">상대역 리딩</p>
        <h1 className="text-[21px] md:text-[22px] font-black mt-1">대본과 배역</h1>
        <p className="text-[13px] text-ink-sub mt-1">대사를 넣고 내가 읽을 배역을 고르세요.</p>
      </header>
      <StepsPill states={["on", "off", "off"]} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <Card>
          <CardTitle title="대본 넣기" sub="파일을 열거나 복사한 대본을 붙여넣으세요." />
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-[14px] bg-blue-mist border border-[#cfe0f5] py-5 flex flex-col items-center gap-1 active:bg-blue-soft"
            >
              <Icon name="upload" size={22} className="text-blue" />
              <span className="text-[14px] font-extrabold">{busy ? "읽는 중…" : "파일에서 열기"}</span>
              <span className="text-[11.5px] text-ink-4">hwp · pdf · docx · txt · 20MB까지</span>
            </button>
            <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            {fileError && <p className="text-[12.5px] text-red">{fileError}</p>}
            <OptionRow icon="clipboard" title="붙여넣기" sub="복사해둔 대본을 바로 넣어요" active={entry === "paste"} onClick={onPaste} />
            <OptionRow icon="pencil" title="직접 쓰기" sub="빈 칸에서 대본을 입력해요" active={entry === "write"} onClick={() => setEntry("write")} />
            <OptionRow
              icon="sparkles"
              title="예시 대본 불러오기"
              sub="두 배역의 대사를 바로 펼쳐봐요"
              onClick={() => {
                replaceRaw(SAMPLE_SCRIPT, "sample");
                setEntry("write");
              }}
            />
            {entry && (
              <textarea
                value={draft.raw}
                onChange={(e) => {
                  // 직접 고친 본문은 typed 다. 예시·파일을 그대로 두면 그 길이 남는다.
                  const source = draft.source === "sample" || draft.source === "file" ? "typed" : entry === "paste" ? "paste" : "typed";
                  setDraft(updateDraft({ ...draft, source }, { raw: e.target.value }));
                }}
                placeholder={"지수: 오래 기다렸어?\n민준: 아니, 나도 방금 왔어.\n\n(지문은 괄호로)"}
                spellCheck={false}
                autoFocus={!draft.raw}
                className="script-text w-full min-h-[200px] rounded-[14px] bg-surface border border-line p-3.5 text-[14px] leading-relaxed placeholder:text-ink-5 focus:outline-none focus:border-blue resize-y"
              />
            )}
            <p className="text-[11.5px] text-ink-4 leading-relaxed">배역 찾기는 이 기기 안에서 해요. {COPYRIGHT_NOTICE}</p>
          </div>
        </Card>
        {confirmCard}
      </div>

      <RecentScripts onOpen={onOpen} />

      <p className="text-[11.5px] text-ink-4 pb-6">{COPYRIGHT_NOTICE}</p>
    </div>
  );
}

/**
 * 이 게스트가 저장한 최근 대본, 최근 고친 순. 게스트가 없으면 볼 자료도 없으므로 서버에 묻지 않는다 —
 * 화면을 여는 것만으로 계정이 생기면 안 된다(account.guest).
 */
function RecentScripts({ onOpen }: { onOpen: (scriptId: string) => void }) {
  const [guest] = useState(() => hasGuestSession());
  // 지운 뒤 다시 묻는다. 키가 바뀌면 useResource 가 다시 조회한다.
  const [version, setVersion] = useState(0);
  const list = useResource<ScriptListResponse>(
    guest ? `scripts:${version}` : null,
    (_key, signal) => listScripts(undefined, { signal }),
    LIST_FAILED_COPY,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!guest || list.state === "idle") return null;

  async function remove(card: ScriptCard) {
    setBusyId(card.id);
    setError(null);
    try {
      await deleteScript(card.id);
      setConfirmId(null);
      setVersion((v) => v + 1);
    } catch (cause) {
      setError(errorMessage(cause, DELETE_FAILED_COPY));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[16px] font-black text-ink">최근 대본</h2>
        {list.state === "ready" && <span className="text-[12px] text-ink-4">{listHeadline(list.data)}</span>}
      </div>
      {list.state === "loading" && <p className="text-[12.5px] text-ink-4">불러오는 중…</p>}
      {list.state === "failed" && <p className="text-[12.5px] text-red">{list.message}</p>}
      {list.state === "ready" && list.data.scripts.length === 0 && (
        <p className="text-[12.5px] text-ink-4">저장한 대본이 여기에 보여요. 앱으로 옮기기 전에는 이 브라우저에서만 볼 수 있어요.</p>
      )}
      {list.state === "ready" && list.data.scripts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.data.scripts.map((card) => {
            const chip = statusChip(card);
            const busy = busyId === card.id;
            return (
              <li key={card.id} className="rounded-[14px] border border-line bg-surface p-3.5 flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <button type="button" disabled={busy} onClick={() => onOpen(card.id)} className="flex-1 min-w-0 text-left">
                    <span className="flex items-center gap-2">
                      <span className="script-text text-[15px] font-black truncate">{card.title}</span>
                      <StatusPill label={chip.label} tone={chip.tone} />
                    </span>
                    <span className="block text-[12px] text-ink-4 mt-1">
                      {myCharactersLabel(card)} · 대사 {card.dialogue_count}줄 · 녹음 {card.recording_count}개 · {activityLabel(card)}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmId(confirmId === card.id ? null : card.id)}
                    aria-label={`${card.title} 지우기`}
                    className="w-8 h-8 rounded-[9px] bg-gray-bg flex items-center justify-center text-ink-4 active:bg-line"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
                {confirmId === card.id && (
                  <div className="rounded-xl bg-warn-bg p-3 flex flex-col gap-2">
                    <p className="text-[12.5px] font-bold text-warn">
                      이 대본과 회차, 녹음 {card.recording_count}개가 함께 지워져요. 되돌릴 수 없어요.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void remove(card)}>
                        {busy ? "지우는 중…" : "지우기"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmId(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-[12.5px] text-red">{error}</p>}
    </Card>
  );
}
