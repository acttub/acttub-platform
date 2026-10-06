"use client";

import { useRef, useState, type ReactNode } from "react";
import { deleteScript, getScript, listScripts } from "@/lib/api/v2/reading-scripts";
import { errorMessage } from "@/lib/api/v2/errors";
import { hasGuestSession } from "@/lib/auth/token-store";
import type { ScriptCard, ScriptDetail, ScriptListResponse } from "@/lib/reading/api-types";
import { FILE_ACCEPT, type ScriptInput, type TextSource } from "@/lib/reading/script/import";
import { SAMPLE_SCRIPT } from "@/lib/reading/script/sample";
import { useResource } from "@/lib/react/use-resource";
import { activityLabel, COPYRIGHT_NOTICE, listHeadline, myCharactersLabel, statusChip } from "@/features/reading/script-list";
import type { ImportDialog, ScriptImporter } from "@/features/reading/use-script-import";
import { Button, Card, CardTitle, Icon, OptionRow, StatusPill, StepsPill } from "@/features/reading/ui";

type Entry = "file" | "paste" | "write";

const LIST_FAILED_COPY = "저장한 대본을 불러오지 못했어요.";
const DELETE_FAILED_COPY = "대본을 지우지 못했어요. 다시 시도해 주세요.";

/**
 * 대본 넣기(D13)의 본문. 파일·붙여넣기·직접 쓰기·예시 가운데 한 길로 대본을 넣고 [다음]을 누르면 서버가 배역과 줄을
 * 나눠 바로 저장한다. 나누는 동안과 끝난 뒤의 알림은 이 화면 위 대화상자다(R2.4·R2.7·R2.8·R2.11~R2.15). 아래에는 이
 * 게스트가 저장해 둔 최근 대본 목록이 있다(reading.script).
 *
 * 화면 껍데기(Page)는 InputScreen 이 씌운다 — 껍데기가 next/link 를 끌어와 Node 에서 그려 볼 수 없어서,
 * 문구를 보는 테스트(tests/reading-script-screens.test.mjs)는 이 본문만 그린다.
 */
export function InputBody({
  importer,
  onOpen,
}: {
  importer: ScriptImporter;
  /** 목록이나 중복 알림에서 대본을 골랐다 — 대본 상세로 간다 */
  onOpen: (scriptId: string) => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState<TextSource>("typed");
  const fileRef = useRef<HTMLInputElement>(null);

  const input: ScriptInput | null =
    entry === "file" ? (file ? { kind: "file", file } : null) : entry && text.trim() ? { kind: "text", text, source } : null;

  const putText = (next: string, from: TextSource) => {
    setText(next);
    setSource(from);
  };

  async function onPaste() {
    setEntry("paste");
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted.trim()) putText(pasted, "paste");
    } catch {
      /* 권한 없으면 아래 입력칸에 직접 붙여넣는다 */
    }
  }

  return (
    <div className="px-5 pt-5 md:px-0 md:pt-0 flex flex-col gap-4">
      <header>
        <p className="text-[13px] font-bold text-blue md:hidden">상대역 리딩</p>
        <h1 className="text-[21px] md:text-[22px] font-black mt-1">대본과 배역</h1>
        <p className="text-[13px] text-ink-sub mt-1">대사를 넣고 내가 읽을 배역을 고르세요.</p>
      </header>
      <StepsPill states={["on", "off", "off"]} />

      <Card>
        <CardTitle title="대본 넣기" sub="파일로 넣거나 글을 붙여넣으면 화자와 대사를 자동으로 나눠드려요." />
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`rounded-[14px] border py-5 flex flex-col items-center gap-1 active:bg-blue-soft ${
              entry === "file" && file ? "bg-blue-soft border-blue" : "bg-blue-mist border-[#cfe0f5]"
            }`}
          >
            <Icon name="upload" size={22} className="text-blue" />
            {entry === "file" && file ? (
              <>
                <span className="script-text text-[14px] font-extrabold">{file.name}</span>
                <span className="text-[11.5px] text-ink-4">{fileSizeLabel(file.size)} · 다른 파일로 바꾸기</span>
              </>
            ) : (
              <>
                <span className="text-[14px] font-extrabold">파일에서 열기</span>
                <span className="text-[11.5px] text-ink-4">TXT·DOCX·PDF·HWP · 50MB까지</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) {
                setFile(picked);
                setEntry("file");
              }
              e.target.value = "";
            }}
          />
          <OptionRow icon="clipboard" title="붙여넣기" sub="복사해둔 대본을 바로 넣어요" active={entry === "paste"} onClick={onPaste} />
          <OptionRow icon="pencil" title="직접 쓰기" sub="빈 칸에서 대본을 입력해요" active={entry === "write"} onClick={() => setEntry("write")} />
          <OptionRow
            icon="sparkles"
            title="예시 대본 불러오기"
            sub="두 배역의 대사를 바로 펼쳐봐요"
            onClick={() => {
              putText(SAMPLE_SCRIPT, "sample");
              setEntry("write");
            }}
          />
          {(entry === "paste" || entry === "write") && (
            <textarea
              value={text}
              onChange={(e) => putText(e.target.value, entry === "paste" && source !== "sample" ? "paste" : "typed")}
              placeholder={"지수: 오래 기다렸어?\n민준: 아니, 나도 방금 왔어.\n\n(지문은 괄호로)"}
              spellCheck={false}
              autoFocus={!text}
              className="script-text w-full min-h-[200px] rounded-[14px] bg-surface border border-line p-3.5 text-[14px] leading-relaxed placeholder:text-ink-5 focus:outline-none focus:border-blue resize-y"
            />
          )}
          <Button size="lg" disabled={!input || importer.view.kind === "splitting"} onClick={() => input && importer.start(input)}>
            다음
          </Button>
          <p className="text-[11.5px] text-ink-4 leading-relaxed">{COPYRIGHT_NOTICE}</p>
        </div>
      </Card>

      <RecentScripts onOpen={onOpen} />

      <ImportDialogs importer={importer} onOpen={onOpen} />
    </div>
  );
}

function fileSizeLabel(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))}KB` : `${(bytes / 1_000_000).toFixed(1)}MB`;
}

/** 확인 하나로 닫는 알림. 문구는 앱 pen 의 R2 장들과 같은 뜻이다. */
const NOTICE_COPY: Record<Exclude<ImportDialog["kind"], "duplicate" | "not_script" | "consent_required" | "failed">, { title: string; body: string }> = {
  no_characters: { title: "배역을 찾지 못했어요", body: "대본에 말하는 사람 이름이 있는지 확인하고 다시 넣어 주세요." },
  daily_limit: { title: "오늘은 대본을 더 넣을 수 없어요", body: "대본은 하루 20번까지 나눌 수 있어요. 내일 다시 넣어 주세요." },
  split_unavailable: { title: "아직 웹에서는 내 대본을 넣을 수 없어요", body: "예시 대본으로 먼저 해 볼 수 있어요." },
  file_too_large: { title: "파일을 읽지 못했어요", body: "파일이 너무 커요. 50MB까지 열 수 있어요." },
  file_unreadable: {
    title: "파일을 읽지 못했어요",
    body: "대본을 읽지 못했어요. 스캔한 PDF이거나 지원하지 않는 형식일 수 있어요. 복사해서 붙여넣어 주세요.",
  },
};

export function ImportDialogs({ importer, onOpen }: { importer: ScriptImporter; onOpen: (scriptId: string) => void }) {
  const { view } = importer;
  if (view.kind === "idle") return null;
  if (view.kind === "splitting") {
    const { progress } = view;
    return (
      <DialogShell title="대본을 나누고 있어요">
        <p className="text-[13px] text-ink-sub leading-relaxed">배역과 대사를 찾는 중이에요.</p>
        {progress && progress.totalLines > 0 && (
          <p className="text-[13px] font-bold text-blue tabular-nums">
            {progress.doneLines.toLocaleString("ko-KR")} / {progress.totalLines.toLocaleString("ko-KR")}줄
          </p>
        )}
      </DialogShell>
    );
  }
  const { dialog } = view;
  const ok = (
    <Button className="flex-1" onClick={importer.close}>
      확인
    </Button>
  );
  switch (dialog.kind) {
    case "duplicate":
      return (
        <DialogShell
          title="이미 넣은 대본이에요"
          actions={
            <>
              <Button variant="secondary" className="flex-1" onClick={() => importer.retry("allowDuplicate")}>
                새로 넣기
              </Button>
              <Button className="flex-1" onClick={() => onOpen(dialog.scriptId)}>
                그 대본 열기
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-sub leading-relaxed">내 대본에 같은 글이 있어요.</p>
          <DuplicateTitle scriptId={dialog.scriptId} />
        </DialogShell>
      );
    case "not_script":
      return (
        <DialogShell
          title="대본이 아닌 것 같아요"
          actions={
            <>
              <Button variant="secondary" className="flex-1" onClick={() => importer.retry("skipScriptCheck")}>
                그래도 나누기
              </Button>
              <Button className="flex-1" onClick={importer.close}>
                다시 고르기
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-sub leading-relaxed">배역 이름과 대사가 있는 글이 필요해요.</p>
        </DialogShell>
      );
    case "consent_required":
      return (
        <DialogShell
          title="대본을 나누려면 동의가 필요해요"
          actions={
            <>
              <Button variant="secondary" className="flex-1" onClick={importer.close}>
                취소
              </Button>
              <Button className="flex-1" onClick={importer.agree}>
                동의하고 나누기
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-sub leading-relaxed">동의해야 대본을 넣을 수 있어요.</p>
          <ul className="flex flex-col gap-1 text-[13px] text-ink-3 leading-relaxed list-disc pl-4">
            <li>대본 글을 OpenAI로 보내 배역과 대사를 나눠요.</li>
            <li>넣은 파일은 대본과 함께 보관하고, 대본을 지우면 같이 지워요.</li>
          </ul>
          <a href="/terms" target="_blank" rel="noreferrer" className="self-start text-[12.5px] font-semibold text-ink-4 underline underline-offset-2">
            자세히 보기
          </a>
          {dialog.error && (
            <p role="alert" className="text-[12.5px] text-red">
              {dialog.error}
            </p>
          )}
        </DialogShell>
      );
    case "failed":
      return (
        <DialogShell title="저장하지 못했어요" actions={ok}>
          <p className="text-[13px] text-ink-sub leading-relaxed">{dialog.message}</p>
        </DialogShell>
      );
    default: {
      const copy = NOTICE_COPY[dialog.kind];
      return (
        <DialogShell title={copy.title} actions={ok}>
          <p className="text-[13px] text-ink-sub leading-relaxed">{copy.body}</p>
        </DialogShell>
      );
    }
  }
}

function DuplicateTitle({ scriptId }: { scriptId: string }) {
  const script = useResource<ScriptDetail>(scriptId, (id, signal) => getScript(id, { signal }), "");
  if (script.state !== "ready") return null;
  return <p className="script-text text-[14px] font-black">「{script.data.title}」</p>;
}

function DialogShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4">
      <div className="w-full md:max-w-[420px] bg-surface rounded-[18px] p-5 flex flex-col gap-3">
        <p className="text-[15px] font-black">{title}</p>
        {children}
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
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
