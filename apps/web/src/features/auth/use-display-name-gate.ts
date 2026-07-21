"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredDisplayName, saveDisplayName } from "./display-name";

// 앱으로 들여보내기 직전에 호칭을 한 번 묻는 관문.
//
// 로그인 성공만으로는 부족하다 — 신규 계정은 백엔드가 pending_consents를 주므로
// /terms를 먼저 거치고, 약관 화면이 목적지로 직접 이동한다. 그래서 정작 진짜
// 첫 사용자가 팝업을 못 보게 된다. 두 경로가 모두 이 관문을 통과하게 한다.
export function useDisplayNameGate() {
  const router = useRouter();
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);

  // 이름이 이미 있으면 그대로 이동하고, 없으면 팝업을 띄운 뒤 답을 받고 이동한다.
  function enterApp(destination: string) {
    if (getStoredDisplayName()) {
      router.replace(destination);
      return;
    }
    setPendingDestination(destination);
  }

  // name이 null이면 "나중에 정할게요" — 저장 없이 그대로 들여보낸다.
  function resolveName(name: string | null) {
    if (name) saveDisplayName(name);
    if (pendingDestination) router.replace(pendingDestination);
  }

  return { pendingDestination, enterApp, resolveName };
}
