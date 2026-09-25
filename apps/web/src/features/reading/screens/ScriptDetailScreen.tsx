"use client";

/**
 * 대본 상세(웹의 R00.5 대응, reading.session). 회차 목록(최근순)과 "이어서 연습 · K / N", "새로운 연습",
 * 회차 삭제. 회차의 녹음 재생·이어 듣기는 RW3 가 더한다.
 */
import { useState } from "react";
import { deleteSession } from "@/lib/api/v2/reading-sessions";
import { errorMessage } from "@/lib/api/v2/errors";
import type { SessionCard } from "@/lib/reading/api-types";
import type { StoredScript } from "@/lib/reading/storage";
import { recordingSummary } from "@/lib/reading/recording/playback";
import { Page } from "@/features/reading/page-shell";
import { resumeProgress, sessionDateLabel } from "@/features/reading/session-cards";
import { SessionRecordings } from "@/features/reading/screens/SessionRecordings";
import { myCharactersLabel, resumeLabel, sessionStatusLabel } from "@/features/reading/session-copy";
import { Button, Card, CardTitle, StatusPill, TopBar } from "@/features/reading/ui";

const DELETE_FAILED_COPY = "회차를 지우지 못했어요. 다시 시도해 주세요.";

export function ScriptDetailScreen({
  script,
  sessions,
  openSession,
  resuming,
  error,
  onResume,
  onNew,
  onMemorize,
  onDeleted,
  onBack,
}: {
  script: StoredScript;
  sessions: SessionCard[];
  /** 열린 회차의 상세(있으면). "이어서 연습"이 쓴다. */
  openSession: Parameters<typeof resumeProgress>[1] | null;
  resuming: boolean;
  error: string | null;
  onResume: () => void;
  onNew: () => void;
  /** 암기 화면으로(고른 배역의 미암기 줄) */
  onMemorize: () => void;
  onDeleted: (sessionId: string) => void;
  onBack: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogueCount = script.lines.filter((l) => l.type === "dialogue").length;

  async function remove(card: SessionCard) {
    setBusyId(card.id);
    setDeleteError(null);
    try {
      await deleteSession(card.id);
      setConfirmId(null);
      onDeleted(card.id);
    } catch (cause) {
      setDeleteError(errorMessage(cause, DELETE_FAILED_COPY));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <TopBar title={script.title} onBack={onBack} hint={`배역 ${script.roles.length}명 · 대사 ${dialogueCount}줄`} />
      <div className="flex-1 flex flex-col gap-4 p-4 md:p-0 md:pt-4">
        <Card>
          <CardTitle title="배역" sub={`배역 ${script.roles.length}명 · 대사 ${dialogueCount}줄`} />
          <div className="flex flex-wrap gap-2">
            {script.characters.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-bg text-[13px] font-extrabold">
                {c.name}
                <span className="text-ink-4 font-semibold">{script.lines.filter((l) => l.type === "dialogue" && l.role === c.name).length}줄</span>
              </span>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {openSession && (
              <Button size="lg" className="w-full" disabled={resuming} onClick={onResume}>
                {resuming ? "회차를 여는 중…" : resumeLabel(resumeProgress(script, openSession))}
              </Button>
            )}
            <Button size="lg" variant={openSession ? "secondary" : "primary"} className="w-full" disabled={resuming} onClick={onNew}>
              새로운 연습
            </Button>
            <Button size="lg" variant="secondary" className="w-full" onClick={onMemorize}>
              암기하기
            </Button>
            {openSession && <p className="text-[11.5px] text-ink-4">새로운 연습을 시작하면 지금 진행 중인 회차는 중단으로 바뀌어요.</p>}
            {error && <p className="text-[12.5px] text-red">{error}</p>}
          </div>
        </Card>

        <Card>
          <CardTitle title="회차" sub={sessions.length === 0 ? "아직 회차가 없어요. 새로운 연습으로 시작해요." : `회차 ${sessions.length}개 · 최근순`} />
          {sessions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {sessions.map((card) => {
                const busy = busyId === card.id;
                return (
                  <li key={card.id} className="rounded-[14px] border border-line bg-surface p-3.5 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[14px] font-black">
                          {card.ordinal}회차
                          <StatusPill label={sessionStatusLabel(card.status)} tone={card.status === "in_progress" ? "blue" : "neutral"} />
                          <span className="text-[12px] font-semibold text-ink-4">{sessionDateLabel(card.started_at)}</span>
                        </p>
                        <p className="text-[12px] text-ink-4 mt-1">
                          {myCharactersLabel(card.my_character_names)} · {recordingSummary(card)}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-3">
                        <button type="button" onClick={() => setOpenId(openId === card.id ? null : card.id)} className="text-[12px] font-bold text-blue">
                          {openId === card.id ? "접기" : "녹음"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmId(confirmId === card.id ? null : card.id)}
                          className="text-[12px] font-bold text-ink-4"
                        >
                          지우기
                        </button>
                      </div>
                    </div>
                    {openId === card.id && <SessionRecordings script={script} sessionId={card.id} onChanged={() => onDeleted(card.id)} />}
                    {confirmId === card.id && (
                      <div className="rounded-xl bg-warn-bg p-3 flex flex-col gap-2">
                        <p className="text-[12.5px] font-bold text-warn">이 회차와 녹음 {card.recorded_line_count}개가 지워져요. 외웠다고 표시한 것은 남아요.</p>
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
          {deleteError && <p className="mt-2 text-[12.5px] text-red">{deleteError}</p>}
        </Card>
      </div>
    </Page>
  );
}
