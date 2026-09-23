"use client";

/**
 * 배역 정하기(D17, reading.cast·reading.session). 내 배역을 하나 이상 고르고(기본은 마지막 회차의 내 배역),
 * 상대역마다 목소리(자동 + M1~M5·F1~F5)를 고르며, 방식·넘김·가리기·녹음을 정해 회차를 시작한다. 웹은 전체
 * 구간으로 시작한다. 여기서는 아무것도 서버에 남지 않는다 — "시작"을 눌러야 회차가 생긴다.
 */
import { useEffect, useState } from "react";
import { micSupported } from "@/lib/reading/audio/mic";
import { VOICE_PRESETS, type VoicePreset } from "@/lib/reading/audio/supertonic/models";
import { speak, unlockTts } from "@/lib/reading/audio/tts";
import type { ReadingAdvance, ReadingMode } from "@/lib/reading/api-types";
import { assignPresets, isVoicePreset, voicesFor } from "@/lib/reading/session/cast";
import { loadMask, MASK_MODES, type MaskMode } from "@/lib/reading/session/mask";
import { retryPendingVoicePresets, saveVoicePreset } from "@/lib/reading/session/voice-presets";
import type { StoredScript } from "@/lib/reading/storage";
import type { PartnerVoice } from "@/features/reading/hooks/useRehearsalRunner";
import { Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { MIC_DENIED_NOTICE, RECORD_NOTICE } from "@/features/reading/session-copy";
import { checkStart, defaultMyCharacterIds, hasPartnerLines, rolesOf, START_BUTTON, type SessionStartInput } from "@/features/reading/session-start";
import { Button, Card, CardTitle, Icon, SelectCard, StepsPill, TopBar } from "@/features/reading/ui";
import { VoiceSetup } from "@/features/reading/voice-setup";

export interface SetupResult extends SessionStartInput {
  partnerVoice: PartnerVoice;
}

export function SetupScreen({
  script,
  starting,
  error,
  onStart,
  onVoiceChange,
  onBack,
  onReinput,
}: {
  script: StoredScript;
  starting: boolean;
  error: string | null;
  onStart: (result: SetupResult) => void;
  /** 목소리를 고쳤다 — 부모가 캐시의 대본을 갱신한다 */
  onVoiceChange: (characterId: string, preset: string | null) => void;
  onBack: () => void;
  onReinput: () => void;
}) {
  const [myIds, setMyIds] = useState<string[]>(() => defaultMyCharacterIds(script));
  const [mode, setMode] = useState<ReadingMode>("read");
  const mic = micSupported();
  const [advance, setAdvance] = useState<ReadingAdvance>(mic ? "silence" : "manual");
  const [record, setRecord] = useState(mic);
  const [mask, setMask] = useState<MaskMode>(() => loadMask(script.id));
  const [voice, setVoice] = useState<{ ready: boolean; partnerVoice: PartnerVoice }>({ ready: false, partnerVoice: "supertonic" });
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  // 지난번에 저장하지 못한 목소리를 다시 보낸다(reading.cast 예외).
  useEffect(() => {
    void retryPendingVoicePresets(script.id);
  }, [script.id]);

  const solo = script.characters.length === 1;
  const dialogueCount = (name: string) => script.lines.filter((l) => l.type === "dialogue" && l.role === name).length;
  const presets = assignPresets(script.characters, myIds);
  const partners = hasPartnerLines(script, myIds);
  const check = checkStart(script, myIds, voice.ready || !partners);
  const myRoles = rolesOf(script, myIds);

  const toggle = (id: string) => {
    if (solo) return;
    setMyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  async function changeVoice(characterId: string, value: string) {
    const preset = value === "auto" ? null : value;
    onVoiceChange(characterId, preset);
    const saved = await saveVoicePreset(script.id, characterId, preset);
    setVoiceNote(saved ? null : "목소리를 저장하지 못했어요. 이번 회차는 고른 목소리로 읽고 다음에 다시 저장해요.");
  }

  function preview(characterId: string) {
    unlockTts();
    const character = script.characters.find((c) => c.id === characterId);
    if (!character) return;
    const voices = voicesFor(script, myIds);
    const v = voices[character.name];
    if (v) void speak(`${character.name} 역이에요.`, v);
  }

  const roleCard = (
    <Card>
      <CardTitle
        title="내 배역 고르기"
        sub={solo ? "배역이 하나라 이 배역으로 연습해요." : "여러 배역을 함께 고를 수 있어요. 고른 배역은 기다리고, 나머지 배역을 기기가 읽어요."}
      />
      {/* 배역이 마흔 명 넘는 대본이 있다. 한 줄에 하나씩 세로로 쌓고 길면 안에서 굴린다. */}
      <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
        {script.characters.map((c) => {
          const mine = myIds.includes(c.id);
          const auto = presets.get(c.id);
          return (
            <div key={c.id} className="flex flex-col gap-1.5">
              <SelectCard compact selected={mine} onClick={() => toggle(c.id)} title={c.name} sub={`${dialogueCount(c.name)}줄`} />
              {!mine && (
                <div className="flex items-center gap-2 pl-3.5">
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-4">
                    <Icon name="volume" size={14} className="text-ink-4" />
                    <span className="sr-only">{c.name} 목소리</span>
                    <select
                      aria-label={`${c.name} 목소리`}
                      value={isVoicePreset(c.voicePreset) ? c.voicePreset : "auto"}
                      onChange={(e) => void changeVoice(c.id, e.target.value)}
                      className="h-8 rounded-lg bg-surface border border-line px-2 text-[12.5px] font-bold text-ink"
                    >
                      <option value="auto">자동{auto ? ` (${auto})` : ""}</option>
                      {VOICE_PRESETS.map((p: VoicePreset) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => preview(c.id)} className="text-[12px] font-bold text-blue">
                    미리 듣기
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {voiceNote && <p className="mt-2 text-[12px] text-warn">{voiceNote}</p>}
    </Card>
  );

  const modeCard = (
    <Card>
      <CardTitle title="리딩 방식" />
      <div className="flex gap-2">
        <SelectCard selected={mode === "read"} onClick={() => setMode("read")} icon="volume" title="읽어주기" sub="상대 대사를 소리로 듣고 내 차례에 읽어요" />
        <SelectCard selected={mode === "quiz"} onClick={() => setMode("quiz")} icon="eye-off" title="암기 대조" sub="내 대사를 가리고 말한 것을 원문과 맞춰요" />
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <SettingRow
          icon="timer"
          title="내 차례 넘기는 방식"
          value={advance === "silence" ? "침묵 감지 · 말이 끝나고 1.8초" : `버튼으로 직접 넘기기 · ${MIC_DENIED_NOTICE}`}
          onClick={mic ? () => setAdvance(advance === "silence" ? "manual" : "silence") : undefined}
          action={mic ? "바꾸기" : undefined}
        />
        <SettingRow
          icon="mic"
          title="내 차례 녹음"
          value={record ? `켬 · ${RECORD_NOTICE}` : "끔"}
          onClick={mic ? () => setRecord((v) => !v) : undefined}
          action={mic ? "바꾸기" : undefined}
        />
        <div className="rounded-xl bg-gray-bg px-3.5 py-3">
          <p className="text-[13.5px] font-extrabold">가리기</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MASK_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMask(m.value)}
                aria-pressed={mask === m.value}
                className={`h-8 px-3 rounded-full text-[12.5px] font-bold border ${mask === m.value ? "bg-blue-soft border-blue text-blue" : "bg-surface border-line text-ink-3"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "quiz" && <p className="mt-1.5 text-[11.5px] text-ink-4">암기 대조에서는 내 대사가 늘 가려져요.</p>}
        </div>
        {partners && <VoiceSetup onChange={setVoice} />}
      </div>
    </Card>
  );

  const startLabel = starting
    ? "회차를 시작하는 중…"
    : check.ok
      ? START_BUTTON(myIds.length)
      : check.reason === "voice_not_ready"
        ? "상대 목소리 준비 중…"
        : check.reason === "empty_range"
          ? "고른 배역의 대사가 없어요"
          : "내 배역을 골라 주세요";

  const start = () => onStart({ myCharacterIds: myIds, mode, advance, record, mask, partnerVoice: voice.partnerVoice });

  return (
    <Page>
      <div className="md:hidden">
        <TopBar title="배역 정하기" onBack={onBack} />
      </div>
      <div className="hidden md:block mb-4">
        <TopBar title={`상대역 리딩 · ${script.title}`} onBack={onBack} hint={`배역 ${script.roles.length}명 · 대사 ${script.lines.filter((l) => l.type === "dialogue").length}줄`} />
      </div>
      <div className="flex-1 flex flex-col gap-4 p-4 md:p-0">
        <StepsPill states={["done", "on", "off"]} />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 items-start">
          <Card className="hidden md:block">
            <div className="flex items-center justify-between pb-2.5 border-b border-line-soft mb-1">
              <h2 className="text-[16px] font-black">대본 확인</h2>
              <button type="button" onClick={onReinput} className="text-[12.5px] font-bold text-blue">
                다른 대본
              </button>
            </div>
            <ReviewList lines={script.lines} myRoles={myRoles} className="max-h-[560px] overflow-y-auto" />
          </Card>
          <div className="flex flex-col gap-4">
            {roleCard}
            {modeCard}
            {error && <p className="hidden md:block text-[12.5px] text-red">{error}</p>}
            <Button size="lg" className="w-full hidden md:flex" disabled={!check.ok || starting} onClick={start}>
              {startLabel}
            </Button>
          </div>
        </div>
      </div>
      <div className="md:hidden sticky bottom-0 p-4 bg-gray-bg-2/90 backdrop-blur flex flex-col gap-2">
        {error && <p className="text-[12.5px] text-red">{error}</p>}
        <Button size="lg" className="w-full" disabled={!check.ok || starting} onClick={start}>
          {startLabel}
        </Button>
      </div>
    </Page>
  );
}

function SettingRow({ icon, title, value, onClick, action }: { icon: "volume" | "timer" | "mic"; title: string; value: string; onClick?: () => void; action?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-gray-bg text-left active:bg-line disabled:active:bg-gray-bg">
      <Icon name={icon} size={18} className="text-ink-3" />
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-extrabold">{title}</span>
        <span className="block text-[12px] text-ink-4">{value}</span>
      </span>
      {action && <span className="text-[12px] font-bold text-blue">{action}</span>}
    </button>
  );
}
