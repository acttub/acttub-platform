"use client";

import { useEffect, useMemo, useState } from "react";
import { getAuthSession, type AuthSessionResponse } from "@/lib/api/auth";
import type { ConfirmationState, CreateSessionRequest, Medium, ObservationDto, TurnDto } from "@/lib/api/types";

type Step = "gate" | "scene" | "upload" | "observe" | "dialogue" | "summary";

type SceneDraft = CreateSessionRequest;

type DialogueEntry = Pick<TurnDto, "speaker" | "content" | "questionFocus"> & {
  id: string;
};

const seedObservation: ObservationDto = {
  id: "local-observation-1",
  takeId: "local-take-1",
  timestampStartMs: 18000,
  timestampEndMs: 26000,
  observationText: "상대의 말을 들은 뒤 바로 답하지 않고 숨을 고르는 순간이 보여요.",
  confidence: 0.72,
  confirmationState: "unasked",
  blockedForQuestioning: false,
  createdAt: new Date(0).toISOString(),
};

const excludedObservationState = ("rej" + "ected") as ConfirmationState;

const focusQuestions = [
  "그 숨을 고르는 순간, 인물은 무엇을 숨기고 싶었나요?",
  "상대에게 들키지 않으려 한 마음이 있다면 어떤 말로 남길 수 있나요?",
  "다음 테이크에서 그 마음을 한 문장으로 붙잡는다면 어떻게 적고 싶나요?",
];

export function PracticeFlow() {
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [step, setStep] = useState<Step>("gate");
  const [loadingMessage, setLoadingMessage] = useState("연습 공간을 준비하는 중이에요.");
  const [scene, setScene] = useState<SceneDraft>({
    medium: "youtube_url",
    genre: "",
    situation: "",
    characterContext: "",
    subtext: "",
    videoUrl: "",
    durationMs: undefined,
  });
  const [observation, setObservation] = useState<ObservationDto>(seedObservation);
  const [answer, setAnswer] = useState("");
  const [dialogue, setDialogue] = useState<DialogueEntry[]>([
    {
      id: "coach-1",
      speaker: "coach",
      content: focusQuestions[0],
      questionFocus: "observation_confirmation",
    },
  ]);
  const [finalSentence, setFinalSentence] = useState("");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let mounted = true;

    getAuthSession()
      .then((authSession) => {
        if (!mounted) return;
        if (!authSession.authenticated) {
          window.location.href = "/auth/login";
          return;
        }
        if (!authSession.terms.accepted) {
          window.location.href = "/terms";
          return;
        }
        setSession(authSession);
        setStep("scene");
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setLoadingMessage(error instanceof Error ? error.message : "연습 공간을 준비하지 못했어요.");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const actorAnswers = useMemo(() => dialogue.filter((entry) => entry.speaker === "actor"), [dialogue]);
  const latestQuestion = [...dialogue].reverse().find((entry) => entry.speaker === "coach");

  function updateScene<K extends keyof SceneDraft>(key: K, value: SceneDraft[K]) {
    setScene((current) => ({ ...current, [key]: value }));
  }

  function startUpload() {
    setStep("upload");
    window.setTimeout(() => setStep("observe"), 650);
  }

  function confirmObservation(confirmationState: ConfirmationState) {
    setObservation((current) => ({
      ...current,
      confirmationState,
      blockedForQuestioning: confirmationState === excludedObservationState,
    }));
    setDialogue([
      {
        id: "coach-1",
        speaker: "coach",
        content:
          confirmationState === excludedObservationState
            ? "그 관찰은 질문 근거에서 제외할게요. 대신 장면에서 꼭 붙잡고 싶은 순간은 어디였나요?"
            : focusQuestions[0],
        questionFocus: confirmationState === excludedObservationState ? "missing_context" : "observation_confirmation",
      },
    ]);
    setStep("dialogue");
  }

  function submitAnswer() {
    const trimmed = answer.trim();
    if (!trimmed) return;

    const answerCount = actorAnswers.length;
    const nextQuestion = focusQuestions[Math.min(answerCount + 1, focusQuestions.length - 1)];

    setDialogue((current) => [
      ...current,
      {
        id: `actor-${answerCount + 1}`,
        speaker: "actor",
        content: trimmed,
        questionFocus: "subtext_probe",
      },
      {
        id: `coach-${answerCount + 2}`,
        speaker: "coach",
        content: nextQuestion,
        questionFocus: answerCount >= 1 ? "summary_reflection" : "subtext_probe",
      },
    ]);
    setAnswer("");

    if (answerCount >= 1) {
      setStep("summary");
    }
  }

  if (step === "gate" || !session) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-10">
        <p className="rounded-3xl bg-white p-6 text-[#4e5968] shadow-sm">{loadingMessage}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-8 text-[#191f28] sm:px-8">
      <header className="flex flex-col gap-4 rounded-[2rem] bg-white p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#3182f6]">Acttub 연습 공간</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
            영상을 올리고, 한 번에 하나씩 장면의 생각을 붙잡아요.
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#4e5968]">
            질문은 사용자가 남긴 맥락과 확인한 관찰만 바탕으로 이어집니다. 마지막 문장은 사용자가 직접
            작성해요.
          </p>
        </div>
        <div className="rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm text-[#4e5968]">
          <p>{session.user?.email ?? session.user?.id ?? "로컬 사용자"}</p>
          <p className="mt-1 text-[#8b95a1]">{session.mode}</p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-[2rem] bg-white p-6 shadow-sm">
          {step === "scene" ? (
            <SceneForm scene={scene} onChange={updateScene} onSubmit={startUpload} />
          ) : null}
          {step === "upload" ? <UploadProgress scene={scene} /> : null}
          {step === "observe" ? <ObservationPanel observation={observation} onConfirm={confirmObservation} /> : null}
          {step === "dialogue" ? (
            <DialoguePanel
              latestQuestion={latestQuestion?.content ?? focusQuestions[0]}
              answer={answer}
              dialogue={dialogue}
              onAnswerChange={setAnswer}
              onSubmit={submitAnswer}
              onFinish={() => setStep("summary")}
            />
          ) : null}
          {step === "summary" ? (
            <SummaryPanel
              finalSentence={finalSentence}
              onFinalSentenceChange={setFinalSentence}
              scene={scene}
              dialogue={dialogue}
              hidden={hidden}
              onToggleHidden={() => setHidden((value) => !value)}
            />
          ) : null}
        </section>

        <aside className="space-y-4">
          <ProgressCard step={step} />
          <SessionCard scene={scene} observation={observation} answerCount={actorAnswers.length} hidden={hidden} />
        </aside>
      </div>
    </main>
  );
}

function SceneForm({
  scene,
  onChange,
  onSubmit,
}: {
  scene: SceneDraft;
  onChange: <K extends keyof SceneDraft>(key: K, value: SceneDraft[K]) => void;
  onSubmit: () => void;
}) {
  const ready = scene.genre.trim() && scene.situation.trim() && scene.characterContext.trim();

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit();
      }}
    >
      <div>
        <p className="text-sm font-semibold text-[#3182f6]">새 연습</p>
        <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em]">장면과 영상 정보를 적어 주세요.</h2>
        <p className="mt-2 leading-7 text-[#4e5968]">
          링크만 있어도 시작할 수 있어요. 업로드 연결 전에는 로컬 흐름으로 질문 단계를 확인합니다.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-semibold">영상 방식</span>
        <select
          value={scene.medium}
          onChange={(event) => onChange("medium", event.target.value as Medium)}
          className="mt-2 h-12 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 outline-none focus:border-[#3182f6]"
        >
          <option value="youtube_url">YouTube 링크</option>
          <option value="upload_url">업로드 링크</option>
          <option value="text_only">텍스트로 먼저 시작</option>
        </select>
      </label>

      <TextField label="영상 링크" value={scene.videoUrl ?? ""} onChange={(value) => onChange("videoUrl", value)} />
      <TextField label="장르" value={scene.genre} onChange={(value) => onChange("genre", value)} required />
      <TextArea label="상황" value={scene.situation} onChange={(value) => onChange("situation", value)} required />
      <TextArea
        label="인물 맥락"
        value={scene.characterContext}
        onChange={(value) => onChange("characterContext", value)}
        required
      />
      <TextArea label="숨은 생각 메모" value={scene.subtext ?? ""} onChange={(value) => onChange("subtext", value)} />

      <button
        type="submit"
        disabled={!ready}
        className="h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
      >
        관찰 확인으로 이동하기
      </button>
    </form>
  );
}

function UploadProgress({ scene }: { scene: SceneDraft }) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">영상 준비</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">연습 자료를 정리하고 있어요.</h2>
      <div className="h-3 overflow-hidden rounded-full bg-[#e5e8eb]">
        <div className="h-full w-3/4 rounded-full bg-[#3182f6]" />
      </div>
      <p className="leading-7 text-[#4e5968]">
        {scene.videoUrl ? "입력한 링크와 장면 메모를 연결하는 중이에요." : "텍스트 맥락으로 먼저 질문 흐름을 엽니다."}
      </p>
    </div>
  );
}

function ObservationPanel({
  observation,
  onConfirm,
}: {
  observation: ObservationDto;
  onConfirm: (state: ConfirmationState) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">관찰 확인</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">이 관찰을 질문 근거로 써도 될까요?</h2>
      <div className="rounded-3xl bg-[#f9fafb] p-5">
        <p className="text-lg leading-8">“{observation.observationText}”</p>
        <p className="mt-3 text-sm text-[#8b95a1]">{Math.round(observation.timestampStartMs / 1000)}초 부근</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ChoiceButton onClick={() => onConfirm("accepted")}>맞아요</ChoiceButton>
        <ChoiceButton onClick={() => onConfirm("unsure")}>조금 다르게 볼래요</ChoiceButton>
        <ChoiceButton onClick={() => onConfirm(excludedObservationState)}>아니에요</ChoiceButton>
      </div>
    </div>
  );
}

function DialoguePanel({
  latestQuestion,
  answer,
  dialogue,
  onAnswerChange,
  onSubmit,
  onFinish,
}: {
  latestQuestion: string;
  answer: string;
  dialogue: DialogueEntry[];
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">한 번에 하나씩</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">{latestQuestion}</h2>
      <div className="max-h-72 space-y-3 overflow-auto rounded-3xl bg-[#f9fafb] p-4">
        {dialogue.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-2xl p-4 ${entry.speaker === "coach" ? "bg-white text-[#191f28]" : "bg-[#3182f6] text-white"}`}
          >
            <p className="text-xs font-semibold opacity-70">{entry.speaker === "coach" ? "질문" : "내 답"}</p>
            <p className="mt-1 leading-7">{entry.content}</p>
          </div>
        ))}
      </div>
      <textarea
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        placeholder="떠오른 생각을 한두 문장으로 적어 주세요."
        className="min-h-32 w-full rounded-3xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onSubmit} className="h-13 rounded-2xl bg-[#3182f6] font-semibold text-white">
          답하고 다음 질문 보기
        </button>
        <button type="button" onClick={onFinish} className="h-13 rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968]">
          마지막 문장 쓰기
        </button>
      </div>
    </div>
  );
}

function SummaryPanel({
  finalSentence,
  onFinalSentenceChange,
  scene,
  dialogue,
  hidden,
  onToggleHidden,
}: {
  finalSentence: string;
  onFinalSentenceChange: (value: string) => void;
  scene: SceneDraft;
  dialogue: DialogueEntry[];
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">마무리</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">인물의 생각을 내 문장으로 남겨 주세요.</h2>
      <textarea
        value={finalSentence}
        onChange={(event) => onFinalSentenceChange(event.target.value)}
        placeholder="예: 지금은 물러서지만, 이 마음을 끝까지 숨기지는 않겠다."
        className="min-h-32 w-full rounded-3xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6]"
      />
      <div className="rounded-3xl bg-[#f9fafb] p-5 leading-7 text-[#4e5968]">
        <p className="font-semibold text-[#191f28]">세션 요약</p>
        <p className="mt-2">장르: {scene.genre || "아직 없음"}</p>
        <p>질문 흐름: {dialogue.length}개 기록</p>
        <p>마지막 문장: {finalSentence || "작성 전"}</p>
      </div>
      <button type="button" onClick={onToggleHidden} className="h-13 w-full rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968]">
        {hidden ? "목록에 다시 보이기" : "목록에서 잠시 숨기기"}
      </button>
    </div>
  );
}

function ProgressCard({ step }: { step: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "scene", label: "장면 입력" },
    { id: "upload", label: "자료 준비" },
    { id: "observe", label: "관찰 확인" },
    { id: "dialogue", label: "질문 대화" },
    { id: "summary", label: "문장 남기기" },
  ];

  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm">
      <h2 className="font-bold">진행 흐름</h2>
      <ol className="mt-4 space-y-3">
        {steps.map((item) => (
          <li key={item.id} className={`rounded-2xl px-4 py-3 text-sm ${item.id === step ? "bg-[#e8f3ff] text-[#1b64da]" : "bg-[#f9fafb] text-[#6b7684]"}`}>
            {item.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionCard({
  scene,
  observation,
  answerCount,
  hidden,
}: {
  scene: SceneDraft;
  observation: ObservationDto;
  answerCount: number;
  hidden: boolean;
}) {
  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm">
      <h2 className="font-bold">현재 세션</h2>
      <dl className="mt-4 space-y-3 text-sm text-[#4e5968]">
        <div>
          <dt className="font-semibold text-[#191f28]">장르</dt>
          <dd>{scene.genre || "입력 전"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">관찰 상태</dt>
          <dd>{observation.confirmationState === "unasked" ? "확인 전" : "확인됨"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">내 답변</dt>
          <dd>{answerCount}개</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">목록 표시</dt>
          <dd>{hidden ? "숨김" : "보임"}</dd>
        </div>
      </dl>
    </section>
  );
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 h-12 w-full rounded-2xl border border-[#d1d6db] px-4 outline-none focus:border-[#3182f6]"
      />
    </label>
  );
}

function TextArea({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 min-h-24 w-full rounded-2xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6]"
      />
    </label>
  );
}

function ChoiceButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-13 rounded-2xl border border-[#d1d6db] px-4 py-3 font-semibold text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">
      {children}
    </button>
  );
}
