// useResource 를 실제로 돌려 보기 위한 최소 컴포넌트. 이 훅이 순수 함수로 잴 수 없는
// 것을 셋 갖는다 — 답이 **돌아온 뒤에** 아직 이 화면의 것인지 묻는 시점, 키가 바뀌는
// 순간의 한 프레임, 그리고 매 렌더 새로 서는 `load` 가 무해한지.
import { useState } from "react";

import { useResource, type Resource } from "@/lib/react/use-resource";

/** 테스트가 답을 쥐고 있는 조회 한 건. */
export type PendingLoad = {
  key: string;
  signal: AbortSignal;
  resolve: (data: string) => void;
  reject: (cause: unknown) => void;
};

const loads: PendingLoad[] = [];

export function pendingLoads(): PendingLoad[] {
  return loads;
}

export function resetLoads(): void {
  loads.length = 0;
}

export type ResourceProbeValue = {
  resource: Resource<string>;
  setKey: (key: string | null) => void;
  /** 답과 무관하게 렌더를 한 번 더 일으킨다. */
  rerender: () => void;
};

function useProbe(initialKey: string | null): ResourceProbeValue {
  const [key, setKey] = useState(initialKey);
  const [, setTick] = useState(0);

  const resource = useResource(
    key,
    // 인라인 화살표인 것이 일부러다 — 부르는 자리 아홉이 전부 이렇게 적는다. 매 렌더
    // 새 함수가 되고, 이 훅이 그것을 의존성에 싣지 않는다는 것이 여기서 검사된다.
    (asked, signal) =>
      new Promise<string>((resolve, reject) => {
        loads.push({ key: asked, signal, resolve, reject });
      }),
    "불러오지 못했어요.",
  );

  return { resource, setKey, rerender: () => setTick((count) => count + 1) };
}

/** 아직 묻지 않는 자리에서 시작한다 — 게이트가 닫힌 화면(로그인 대기). */
export function ResourceProbe({
  onRender,
}: {
  onRender: (value: ResourceProbeValue) => void;
}) {
  const value = useProbe(null);
  onRender(value);
  return <output>{value.resource.state}</output>;
}

/** 첫 렌더부터 묻는 자리에서 시작한다 — 게이트가 없는 화면(입시 정보). */
export function EagerResourceProbe({
  onRender,
}: {
  onRender: (value: ResourceProbeValue) => void;
}) {
  const value = useProbe("a");
  onRender(value);
  return <output>{value.resource.state}</output>;
}
