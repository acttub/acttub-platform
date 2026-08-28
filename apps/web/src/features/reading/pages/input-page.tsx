"use client";

import { useRouter } from "next/navigation";
import { InputScreen } from "@/features/reading/screens/InputScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { afterInput } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading — 대본 넣기. 이미 넣어 둔 대본이 있으면 그 본문을 채워 둔다. */
export function InputPage() {
  const router = useRouter();
  const { script, setup, ready, desktop } = useReadingStep("input");
  if (!ready) return <div className="min-h-svh" />;
  return (
    <InputScreen
      initialRaw={script?.raw ?? ""}
      onParsed={(s) => {
        storage.saveScript(s);
        // 배역이 바뀌었으면 이전 설정·결과는 버린다
        if (!(setup && s.roles.includes(setup.myRole))) storage.saveSetup(null);
        storage.saveStats(null);
        router.push(afterInput(desktop));
      }}
    />
  );
}
