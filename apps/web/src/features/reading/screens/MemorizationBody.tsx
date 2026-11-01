"use client";

/**
 * 암기 화면(R04·R04.1 대응, reading.memorization)의 본문. 대상은 진입 경로가 정한다(대본 → 고른 배역의 미암기 줄,
 * 완료 화면 → 그 회차의 다시 볼 줄). 모드 넷(가리고·빈칸·첫 글자·듣고 따라 하기), 보조(첫 글자 힌트·원문 듣기·원문
 * 보기), 바로 전 상대 대사, "외워서 말해보기"(기기 STT, 없으면 입력하기), "이 대사 외웠어요/아직 헷갈려요". 회차와
 * 녹음을 만들지 않는다. 수치·맞음·틀림은 내지 않는다.
 * 껍데기(Page)는 MemorizationScreen 이 씌운다 — 문구 테스트가 이 본문만 그린다.
 */
import { useEffect, useRef, useState } from "react";
import { startAutoRecognition, sttAvailable, type AutoListening } from "@/lib/reading/audio/stt";
import { speakDevice, unlockTts } from "@/lib/reading/audio/tts";
import type { MemorizationStatus } from "@/lib/reading/api-types";
import { maskTokens, MEMO_MODES, type MemoMode } from "@/lib/reading/memorization/masking";
import { judgeRecital } from "@/lib/reading/memorization/recital";
import type { MemorizationSync } from "@/lib/reading/memorization/sync";
import { EMPTY_TARGETS_COPY, memorizationHeading, memorizationProgress, memorizationTargets } from "@/lib/reading/memorization/targets";
import type { StoredScript } from "@/lib/reading/storage";
import { Button, Icon } from "@/features/reading/ui";

export const MEMORIZED_BUTTON = "이 대사 외웠어요";
export const NOT_YET_BUTTON = "아직 헷갈려요";
export const SHOW_MEMORIZED_TOGGLE = "외운 대사도 보기";
export const NO_SPEECH_NOTE = "말소리를 못 알아들었어요. 다시 말하거나 입력하기를 써 주세요.";

export function MemorizationBody({
  script,
  roles,
  lineIds,
  sync,
  onRolesChange,
  onBack,
  onReading,
}: {
  script: StoredScript;
  roles: string[];
  /** 완료 화면에서 왔으면 다시 볼 줄 id. 대본에서 왔으면 null. */
  lineIds: string[] | null;
  sync: MemorizationSync;
  onRolesChange: (roles: string[]) => void;
  onBack: () => void;
  /** 대상이 없을 때 리딩으로 가는 길 */
  onReading: () => void;
}) {
  const [mode, setMode] = useState<MemoMode>("hidden");
  const [index, setIndex] = useState(0);
  const [showMemorized, setShowMemorized] = useState(false);
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [tempo, setTempo] = useState<1 | 0.7>(1);
  const [, rerender] = useState(0);
  const tick = () => rerender((n) => n + 1);

  // 외워서 말해보기
  const [said, setSaid] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "retry" | null>(null);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const misses = useRef(new Map<string, number>());
  const recRef = useRef<AutoListening | null>(null);
  const speakAbort = useRef<AbortController | null>(null);

  const targets = memorizationTargets(script, roles, sync.entries(), lineIds ? { onlyLineIds: lineIds } : { includeMemorized: showMemorized });
  const current = targets.lines[Math.min(index, Math.max(0, targets.lines.length - 1))] ?? null;
  const currentId = current?.lineId ?? null;

  // 줄이 바뀌면 말한 것·결과를 비운다. 인식 텍스트는 어디에도 남기지 않는다.
  useEffect(() => {
    recRef.current?.abort();
    recRef.current = null;
    speakAbort.current?.abort();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaid("");
    setOutcome(null);
    setListening(false);
    setTyped("");
    setNote(null);
    setSpeaking(false);
  }, [currentId]);

  useEffect(
    () => () => {
      recRef.current?.abort();
      speakAbort.current?.abort();
    },
    [],
  );

  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(targets.lines.length - 1, i + delta)));

  async function mark(status: MemorizationStatus) {
    if (!current) return;
    await sync.set(current.lineId, status);
    tick();
    // 대본에서 들어온 목록은 외운 줄이 빠지므로 같은 자리가 다음 줄이다. 그 밖에는 다음으로 간다.
    if (lineIds || showMemorized) go(1);
  }

  function recite(text: string) {
    if (!current) return;
    setSaid(text);
    const result = judgeRecital(text, current.text, misses.current.get(current.lineId) ?? 0);
    if (result.kind === "nothing") {
      setNote(NO_SPEECH_NOTE);
      return;
    }
    if (result.kind === "pass") {
      setOutcome("pass");
      return;
    }
    misses.current.set(current.lineId, result.misses);
    if (result.kind === "advance") {
      // 2회 미달 — 안내 없이 다음 줄. 암기 상태는 바꾸지 않는다(외웠는지는 배우가 정한다).
      go(1);
      return;
    }
    setOutcome("retry");
  }

  function listen() {
    setNote(null);
    setOutcome(null);
    setSaid("");
    recRef.current?.abort();
    recRef.current = startAutoRecognition({
      onListening: () => setListening(true),
      onInterim: (t) => setSaid(t),
      onText: (t) => {
        setListening(false);
        recite(t);
      },
      onError: (reason) => {
        setListening(false);
        if (reason === "unavailable" || reason === "denied") {
          setTyping(true);
          setNote(reason === "denied" ? "마이크 권한이 없어요. 입력하기로 진행해요." : "이 브라우저에선 음성인식이 안 돼요. 입력하기로 진행해요.");
        } else setNote(NO_SPEECH_NOTE);
      },
    });
  }

  /** 원문 듣기 — 마이크는 열지 않는다. */
  async function playOriginal(): Promise<boolean> {
    if (!current) return false;
    unlockTts();
    speakAbort.current?.abort();
    const ac = new AbortController();
    speakAbort.current = ac;
    setSpeaking(true);
    try {
      const ok = await speakDevice(current.text, { tempo, signal: ac.signal });
      if (!ok) setNote("이 브라우저는 기기 음성을 지원하지 않아요.");
      return ok && !ac.signal.aborted;
    } finally {
      setSpeaking(false);
    }
  }

  /** 듣고 따라 말하기 — 재생이 끝난 뒤에만 음성인식을 시작한다. 재생 중 말한 것은 대조되지 않는다. */
  async function listenThenRepeat() {
    if (await playOriginal()) listen();
  }

  if (!current) {
    return (
      <div className="flex-1 flex flex-col gap-4 p-4 md:p-0 md:pt-4">
        <Header roles={roles} count={0} progress={memorizationProgress(targets)} onBack={onBack} />
        <div className="rounded-[18px] bg-surface border border-line p-6 flex flex-col items-center gap-3 text-center">
          <p className="text-[15px] font-black">{EMPTY_TARGETS_COPY}</p>
          {!lineIds && targets.total > 0 && (
            <button type="button" onClick={() => setShowMemorized(true)} className="text-[13px] font-bold text-blue">
              {SHOW_MEMORIZED_TOGGLE}
            </button>
          )}
          <Button onClick={onReading}>리딩하러 가기</Button>
        </div>
      </div>
    );
  }

  const tokens = maskTokens(current.text, mode, { hint });
  const isRevealed = revealed === current.lineId || outcome === "pass";

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 md:p-0 md:pt-4">
      <Header roles={roles} count={targets.lines.length} progress={memorizationProgress(targets)} onBack={onBack} />

      {!lineIds && (
        <div className="flex flex-wrap items-center gap-2">
          {script.roles.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={roles.includes(r)}
              onClick={() => onRolesChange(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
              className={`h-8 px-3 rounded-full text-[12.5px] font-bold border ${roles.includes(r) ? "bg-blue-soft border-blue text-blue" : "bg-surface border-line text-ink-3"}`}
            >
              {r}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[12px] font-bold text-ink-3">
            <input type="checkbox" checked={showMemorized} onChange={(e) => setShowMemorized(e.target.checked)} />
            {SHOW_MEMORIZED_TOGGLE}
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {MEMO_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            className={`h-8 px-3 rounded-full text-[12.5px] font-bold border ${mode === m.value ? "bg-blue-soft border-blue text-blue" : "bg-surface border-line text-ink-3"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {current.previousPartner && (
        <p className="script-text text-[13px] text-ink-4">
          <span className="font-extrabold text-partner-soft mr-1.5">{current.previousPartner.role}</span>
          {current.previousPartner.text}
        </p>
      )}

      <div className={`rounded-[20px] p-5 border ${outcome === "pass" ? "bg-green-bg border-green" : "bg-surface border-line"}`}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-black text-blue">
            {current.role} · {current.dialogueNo}번 대사{current.memorized ? " · 외웠어요" : ""}
          </span>
          <span className="text-[11.5px] font-bold text-ink-4">{index + 1} / {targets.lines.length}</span>
        </div>
        <p className="script-text mt-3 text-[22px] md:text-[26px] leading-[1.45] font-extrabold flex flex-wrap gap-x-2 gap-y-1">
          {isRevealed
            ? current.text
            : tokens.map((t, i) =>
                t.masked ? (
                  <span key={i} className="inline-flex items-baseline">
                    <span>{t.shown}</span>
                    <span className="blur-line">{"·".repeat(Math.max(1, Array.from(t.text).length - Array.from(t.shown).length))}</span>
                  </span>
                ) : (
                  <span key={i} className={t.kind === "direction" ? "italic text-ink-4" : ""}>
                    {t.text}
                  </span>
                ),
              )}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] font-bold">
          {(mode === "hidden" || mode === "blanks") && (
            <button type="button" onClick={() => setHint((v) => !v)} className={hint ? "text-blue" : "text-ink-3"}>
              첫 글자 힌트
            </button>
          )}
          <button type="button" onClick={() => void playOriginal()} disabled={speaking} className="text-ink-3 disabled:opacity-40">
            원문 듣기
          </button>
          {mode === "listen" && (
            <button type="button" onClick={() => setTempo(tempo === 1 ? 0.7 : 1)} className="text-ink-3">
              {tempo === 1 ? "1.0×" : "천천히 0.7×"}
            </button>
          )}
          {!isRevealed && (
            <button type="button" onClick={() => setRevealed(current.lineId)} className="text-blue underline underline-offset-2">
              원문 보기
            </button>
          )}
        </div>
      </div>

      <div className="rounded-[14px] bg-gray-bg px-3.5 py-3 flex flex-col gap-2">
        <p className="text-[11.5px] font-bold text-ink-4">{listening ? "듣는 중 · 말하는 대로 적혀요" : "외워서 말해보기"}</p>
        <p className="script-text text-[15px] min-h-6">
          {said || (listening ? <span className="text-blue">듣고 있어요…</span> : <span className="text-ink-5">아직 없어요</span>)}
        </p>
        {outcome === "retry" && <p className="text-[12px] text-warn">원문과 달라요. 다시 말하거나 넘어갈 수 있어요.</p>}
        {outcome === "pass" && <p className="text-[12px] text-green">원문과 맞아요. 외웠으면 아래에서 표시해요.</p>}
        {note && <p className="text-[12px] text-ink-3">{note}</p>}
        <div className="flex flex-wrap gap-2">
          {mode === "listen" ? (
            <Button size="sm" disabled={speaking || listening} onClick={() => void listenThenRepeat()}>
              듣고 따라 말하기
            </Button>
          ) : (
            <Button size="sm" disabled={listening} onClick={() => (sttAvailable() ? listen() : setTyping(true))}>
              {sttAvailable() ? "말해보기" : "입력하기"}
            </Button>
          )}
          {listening && (
            <Button size="sm" variant="secondary" onClick={() => recRef.current?.finish()}>
              지금 확정
            </Button>
          )}
          {outcome === "retry" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => { setOutcome(null); setSaid(""); }}>
                다시
              </Button>
              <Button size="sm" variant="secondary" onClick={() => go(1)}>
                넘어가기
              </Button>
            </>
          )}
          {sttAvailable() && (
            <button type="button" onClick={() => setTyping((v) => !v)} className="text-[12px] font-bold text-blue underline underline-offset-2">
              입력하기
            </button>
          )}
        </div>
        {typing && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) recite(typed.trim());
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="대사 입력" className="script-text flex-1 h-10 rounded-xl bg-surface border border-line px-3 text-[14px] focus:outline-none focus:border-blue" />
            <Button type="submit" size="sm">확인</Button>
          </form>
        )}
        {sttAvailable() && <p className="text-[11px] text-ink-4">말소리는 브라우저 음성 서비스로 가요. 말한 것은 맞춰 보는 데만 쓰고 저장하지 않아요.</p>}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => void mark("not_yet")}>
          {NOT_YET_BUTTON}
        </Button>
        <Button size="lg" className="flex-1" onClick={() => void mark("memorized")}>
          {MEMORIZED_BUTTON}
        </Button>
      </div>
      <div className="flex items-center justify-between text-[12.5px] font-bold text-ink-3">
        <button type="button" disabled={index <= 0} onClick={() => go(-1)} className="flex items-center gap-1 disabled:opacity-40">
          <Icon name="chevron-left" size={14} /> 이전
        </button>
        {sync.pending() > 0 && <span className="text-[11.5px] text-ink-4">표시 저장 중 {sync.pending()}</span>}
        <button type="button" disabled={index >= targets.lines.length - 1} onClick={() => go(1)} className="flex items-center gap-1 disabled:opacity-40">
          다음 <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}

function Header({ roles, count, progress, onBack }: { roles: string[]; count: number; progress: string; onBack: () => void }) {
  return (
    <header className="flex items-center gap-2.5">
      <button type="button" onClick={onBack} aria-label="뒤로" className="w-8 h-8 rounded-[9px] bg-gray-bg flex items-center justify-center active:bg-line">
        <Icon name="chevron-left" size={18} />
      </button>
      <div className="min-w-0">
        <h1 className="text-[16px] font-black truncate">{memorizationHeading(roles, count)}</h1>
        <p className="text-[12px] text-ink-4">{progress}</p>
      </div>
    </header>
  );
}
