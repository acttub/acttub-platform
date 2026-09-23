"use client";

/**
 * 대본 확인(D16)의 편집 부분 — 제목, "배역 N명 · 대사 N줄 · 지문 N개 · 장면 N개", 배역 칩(눌러서 이름
 * 고치기·빼기·되살리기), 빠진 이름 더하기. 폰은 /reading/script 페이지가, 데스크톱은 대본 넣기 화면의
 * 오른쪽 열이 같은 것을 쓴다. 저장 버튼은 부르는 쪽이 놓는다(폰은 화면 아래 고정).
 */
import { useState } from "react";
import { resolveDraft, type ScriptDraft, TITLE_MAX_LENGTH, updateDraft } from "@/lib/reading/draft";

export const NO_CHARACTERS_COPY = "배역을 하나도 못 찾았어요. 배역 이름을 적어 주세요.";

export function ScriptConfirmPanel({ draft, onChange }: { draft: ScriptDraft; onChange: (next: ScriptDraft) => void }) {
  const resolved = resolveDraft(draft);
  const { characters, counts, title } = resolved;
  // 눌러서 고치는 중인 배역(파서가 잡은 원래 이름)과 입력 중인 새 이름
  const [editing, setEditing] = useState<{ original: string; name: string } | null>(null);
  const [hint, setHint] = useState("");

  const change = (c: Parameters<typeof updateDraft>[1]) => onChange(updateDraft(draft, c));
  const kept = characters.filter((c) => !c.excluded);
  const nameOf = (original: string) => characters.find((c) => c.original === original)?.name ?? original;

  const addHint = () => {
    const name = hint.trim();
    if (!name) return;
    change({ addHint: name });
    setHint("");
  };
  // 본문에 없어 배역이 되지 못한 힌트 — 적었는데 칩이 안 생긴 까닭을 알려 준다
  const missingHints = draft.hints.filter((h) => !characters.some((c) => c.original === h));

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-bold text-ink-4">제목</span>
        <input
          value={draft.title ?? title}
          onChange={(e) => change({ title: e.target.value })}
          maxLength={TITLE_MAX_LENGTH}
          aria-label="대본 제목"
          className="script-text w-full h-10 rounded-lg bg-surface border border-line px-3 text-[15px] font-black focus:outline-none focus:border-blue"
        />
      </label>
      <p className="text-[12.5px] text-ink-sub">
        배역 {kept.length}명 · 대사 {counts.dialogue}줄 · 지문 {counts.direction}개 · 장면 {counts.scene}개
      </p>
      <p className="text-[11.5px] text-ink-4">배역을 누르면 이름을 고치거나 뺄 수 있어요. 뺀 배역의 대사는 지문으로 읽어요.</p>
      <div className="flex flex-wrap gap-2">
        {characters.map((c) => (
          <button
            key={c.original}
            type="button"
            onClick={() => (c.excluded ? change({ include: c.original }) : setEditing({ original: c.original, name: c.name }))}
            aria-pressed={!c.excluded}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-extrabold transition-opacity ${
              c.excluded ? "bg-gray-bg text-ink-5 line-through opacity-60" : editing?.original === c.original ? "bg-blue-soft text-blue" : "bg-gray-bg"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${c.excluded ? "bg-ink-5" : "bg-partner-soft"}`} />
            {c.name || c.original}
            <span className="text-ink-4 font-semibold">{c.dialogueCount}줄</span>
          </button>
        ))}
      </div>
      {editing && (
        <div className="rounded-xl bg-blue-mist p-3 flex flex-col gap-2">
          <p className="text-[12px] font-bold text-ink-3">{nameOf(editing.original)} 배역 고치기</p>
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            aria-label="배역 이름"
            autoFocus
            className="w-full h-10 rounded-lg bg-surface border border-line px-3 text-[14px] focus:outline-none focus:border-blue"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                change({ rename: { from: editing.original, to: editing.name } });
                setEditing(null);
              }}
              className="h-9 px-3 rounded-[10px] bg-blue text-white text-[13px] font-bold"
            >
              이름 저장
            </button>
            <button
              type="button"
              onClick={() => {
                change({ exclude: editing.original });
                setEditing(null);
              }}
              className="h-9 px-3 rounded-[10px] bg-surface border border-line text-[13px] font-bold text-ink-3"
            >
              배역에서 빼기
            </button>
            <button type="button" onClick={() => setEditing(null)} className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-ink-4">
              취소
            </button>
          </div>
        </div>
      )}
      <div className={`rounded-xl p-3.5 ${kept.length > 0 ? "bg-gray-bg" : "bg-warn-bg"}`}>
        <p className={`text-[13px] font-bold ${kept.length > 0 ? "text-ink-3" : "text-warn"}`}>
          {kept.length > 0 ? "빠진 배역이 있으면 이름을 적어 주세요." : NO_CHARACTERS_COPY}
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addHint();
              }
            }}
            placeholder="예: 지수"
            aria-label="더할 배역 이름"
            className="flex-1 min-w-0 h-10 rounded-lg bg-surface border border-line px-3 text-[14px] focus:outline-none focus:border-blue"
          />
          <button type="button" onClick={addHint} disabled={!hint.trim()} className="h-10 px-3.5 rounded-lg bg-surface border border-line text-[13px] font-bold text-blue disabled:opacity-40">
            더하기
          </button>
        </div>
        {missingHints.length > 0 && (
          <p className="mt-2 text-[11.5px] text-ink-4">
            {missingHints.join(", ")}: 대본에서 이 이름으로 말하는 줄을 못 찾았어요.
            {missingHints.map((h) => (
              <button key={h} type="button" onClick={() => change({ removeHint: h })} className="ml-1.5 underline underline-offset-2 font-bold">
                {h} 지우기
              </button>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
