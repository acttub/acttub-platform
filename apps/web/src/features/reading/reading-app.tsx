"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useDesktop } from "@/features/reading/hooks/useMediaQuery";
import { storage, type Setup, type StoredScript } from "@/lib/reading/storage";
import { DoneScreen, type RunStats } from "@/features/reading/screens/DoneScreen";
import { InputScreen } from "@/features/reading/screens/InputScreen";
import { QuizScreen } from "@/features/reading/screens/QuizScreen";
import { RehearsalScreen } from "@/features/reading/screens/RehearsalScreen";
import { ReviewScreen } from "@/features/reading/screens/ReviewScreen";
import { SetupScreen } from "@/features/reading/screens/SetupScreen";

type Phase = "input" | "review" | "setup" | "run" | "done";

const noop = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
const isClient = typeof window !== "undefined";

export function App() {
  const hydrated = useHydrated();
  const desktop = useDesktop();
  const [script, setScript] = useState<StoredScript | null>(() => (isClient ? storage.loadScript() : null));
  const [setup, setSetup] = useState<Setup | null>(() => (isClient ? storage.loadSetup() : null));
  const [phase, setPhase] = useState<Phase>(() => (isClient && storage.loadScript() ? "setup" : "input"));
  const [stats, setStats] = useState<RunStats | null>(null);

  if (!hydrated) return <div className="min-h-svh" />;

  const saveSetup = (st: Setup) => {
    setSetup(st);
    storage.saveSetup(st);
  };

  if (phase === "input" || !script) {
    return (
      <InputScreen
        initialRaw={script?.raw ?? ""}
        onParsed={(s) => {
          setScript(s);
          storage.saveScript(s);
          const keep = setup && s.roles.includes(setup.myRole) ? setup : null;
          setSetup(keep);
          // 데스크톱은 대본 확인과 배역 정하기를 한 화면에 같이 보여 준다
          setPhase(desktop ? "setup" : "review");
        }}
      />
    );
  }

  if (phase === "review" && !desktop) {
    return <ReviewScreen script={script} onBack={() => setPhase("input")} onNext={() => setPhase("setup")} />;
  }

  if (phase === "setup" || phase === "review") {
    return (
      <SetupScreen
        script={script}
        initialSetup={setup}
        onBack={() => setPhase(desktop ? "input" : "review")}
        onReinput={() => setPhase("input")}
        onStart={(st) => {
          saveSetup(st);
          setPhase("run");
        }}
      />
    );
  }

  if (phase === "run" && setup) {
    const common = {
      script,
      setup,
      onExit: () => setPhase("setup"),
      onFinish: (st: RunStats) => {
        setStats(st);
        setPhase("done");
      },
    };
    return setup.mode === "quiz" ? <QuizScreen {...common} /> : <RehearsalScreen {...common} />;
  }

  if (phase === "done" && setup && stats) {
    return (
      <DoneScreen
        script={script}
        setup={setup}
        stats={stats}
        onRepeat={() => setPhase("run")}
        onChangeSetup={() => setPhase("setup")}
        onNewScript={() => {
          storage.saveScript(null);
          storage.saveSetup(null);
          setScript(null);
          setSetup(null);
          setPhase("input");
        }}
      />
    );
  }

  return <Redirect to={() => setPhase("setup")} />;
}

function Redirect({ to }: { to: () => void }) {
  useEffect(() => {
    to();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="min-h-svh" />;
}
