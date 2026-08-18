// 서버에서 하나를 읽어 화면에 그리는 일. 화면 아홉이 같은 마흔 줄을 저마다 다시 썼다 —
// `useState` 셋(데이터·로딩·오류) + `useEffect` 안의 `AbortController` + `.catch` 로
// 메시지 뽑기 + `finally` 로 로딩 끄기 + 정리에서 abort. 다시 쓰는 동안 갈라진 것이
// 넷이고, 그중 하나는 조용한 버그였다 — 취소를 걸러내지 않아 화면을 떠나며 오류를
// 그렸다(`memory-panel`). 오류 내용을 세워 두고 렌더에서 버리는 자리도 있는데
// (`university-detail`), 그쪽은 목록 화면과 갈린 문구 정책이라 이 연작이 일부러 보존했다.
//
// 여기 담긴 것은 그 아홉이 **공유하는 것만**이다. 접히지 않는 것은 부르는 자리에 남는다 —
// 목록 누적(cursor), 폼 초기값 시딩, 응답을 여러 상태로 흩어 담기. 그 셋을 억지로
// 들이면 인자가 늘어 얕은 module 이 하나 늘 뿐이다 (SOMA-411).

import { useEffect, useState } from "react";

import { errorMessage } from "../api/v2/errors";

/**
 * 조회 하나의 상태.
 *
 * 판별 유니온인 까닭은 잘못된 조합을 **타입으로 없애기** 위해서다. `data`·`error`·`loading`
 * 셋을 따로 들면 "데이터도 있고 오류도 있는" 자리와 "다 끝났는데 아직 로딩인" 자리가
 * 표현되고, 실제로 아홉 곳이 그 조합을 저마다 다르게 읽었다(`!payload && !error` 로
 * 로딩을 유추한 곳이 셋이다).
 */
export type Resource<T> =
  /** 아직 묻지 않았다. 게이트(로그인 대기 등)가 닫혀 있는 동안이다. */
  | { state: "idle" }
  | { state: "loading" }
  /**
   * 응답이 왔다. `receivedAt` 은 그 순간의 시각이다 — 페이지를 전부 빌드 시점에
   * 프리렌더하므로 서버 시각이 없고, 화면이 "3시간 전"·"마감 D-2" 를 재려면 응답이 온
   * 뒤에 한 번 읽은 시각이 필요하다. 그 시각을 답과 따로 든 자리가 넷인데 모양이 둘로
   * 갈렸다 — `setNow(Date.now())` 둘(커뮤니티 목록·글 상세)과 `setToday(localDate())`
   * 둘(입시 두 화면). 이것이 흡수한 것은 뒤엣 둘뿐이다. 앞엣 둘은 답을 그 뒤 사용자
   * 행동이 바꾸는 자리라 이 훅으로 접히지 않았다.
   */
  | { state: "ready"; data: T; receivedAt: number }
  | { state: "failed"; message: string };

const IDLE: Resource<never> = { state: "idle" };
const LOADING: Resource<never> = { state: "loading" };

function beforeAnswer<T>(key: string | null): Resource<T> {
  return key === null ? IDLE : LOADING;
}

/**
 * @param key 무엇을 묻는가. **이것이 바뀌면 다시 묻는다.** `null` 은 아직 묻지 않는다는
 *   뜻이라 게이트를 겸한다(`ready ? "memory" : null`). 재조회 조건을 원시값 하나로
 *   좁힌 것은 아홉 곳의 조건이 전부 원시값 두 개 이하였기 때문이다.
 * @param load 실제로 묻는 일. **`key` 와 `signal` 밖의 것을 보지 않아야 한다** — 아래 🔒.
 * @param fallbackMessage 오류에 읽을 문구가 없을 때 화면에 보일 말.
 */
export function useResource<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T>,
  fallbackMessage: string,
): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>(() => beforeAnswer(key));
  const [askedKey, setAskedKey] = useState(key);

  // 키가 바뀐 **그 렌더에서** 되돌린다. 이펙트에서 하면 두 가지가 어긋난다 — 옛 답이 한
  // 프레임 그려지고(그것이 "남의 것을 든 화면"이다), 렌더가 한 번 더 돈다.
  //
  // 아래 `return` 이 옛 `resource` 를 그대로 주는데도 괜찮은 까닭: 렌더 중 setState 는
  // React 가 이 렌더의 출력을 **통째로 버리고** 다시 부르게 하고, `setAskedKey` 가 늘 다른
  // 값이라 그 재호출이 반드시 일어난다. 그래서 여기서 돌려주는 것은 화면에 닿지 않는다.
  // 돌려줄 값을 따로 골라 보았지만 관측되는 차이가 없어 걷었다(반증 R10).
  //
  // ⚠ 여기서 곧바로 return 하지 않는다 — 그러면 아래 `useEffect` 가 조건부 호출이 되어
  // 훅 순서가 깨진다(`react-hooks/rules-of-hooks` 가 막는다).
  if (key !== askedKey) {
    setAskedKey(key);
    setResource(beforeAnswer(key));
  }

  useEffect(() => {
    if (key === null) return;

    const controller = new AbortController();
    load(key, controller.signal).then(
      (data) => {
        // 취소를 걸러내는 자리가 여기 하나다. 성공 쪽에도 있어야 한다 — 화면을 떠난
        // 뒤에 도착한 답은 이미 남의 것이다.
        if (controller.signal.aborted) return;
        setResource({ state: "ready", data, receivedAt: Date.now() });
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setResource({
          state: "failed",
          message: errorMessage(cause, fallbackMessage),
        });
      },
    );
    return () => controller.abort();

    // 🔒 `load` 와 `fallbackMessage` 를 일부러 뺀다. 부르는 자리는 `load` 를 인라인
    // 화살표로 적으므로 매 렌더 새 함수이고, 그것을 의존성에 실으면 **렌더마다 조회를
    // 다시 띄우고 자기 앞의 조회를 취소한다.** 그래서 `load` 는 `key` 를 인자로 받는다 —
    // 클로저로 무엇을 가둘 이유가 없으니 어느 렌더의 것이든 같은 일을 하고, 다시 도는
    // 순간 쓰이는 것은 그 렌더의 최신 클로저다. 이 동일성 무관함은
    // tests/use-resource.test.mjs 가 못박는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return resource;
}
