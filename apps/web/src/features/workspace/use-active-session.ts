// 지금 화면인 연습이 무엇인가. 그 하나를 묻는 자리가 화면 곳곳에 있다 — 코치를 붙이는
// 중에도, 훑어보기를 3초마다 물어보는 중에도, 지난 연습을 불러오는 중에도, 답이 돌아온
// 순간 그 답이 아직 이 화면의 것인지 다시 물어야 한다.
//
// 옛 코드는 그 질문에 답할 값을 두 벌로 들고 있었다 — 렌더가 읽는 state 와 기다림
// 뒤에 읽는 ref. 넷이나 되는 자리에서 늘 같이 세웠고(한쪽만 세우면 그 자리는 조용히
// 어긋난다), 그러면서 묻는 모양은 저마다 다르게 자랐다. 여기서 그 두 벌을 이 훅 안으로
// 넣고, 밖에는 서로 다른 두 질문만 남긴다 — "화면에 무엇을 그리나"(id)와 "지금 이
// 순간 누가 그 자리에 있나"(나머지 넷).
//
// **무엇을 통과시킬지 정하는 것은 이 파일 하나다.** 부르는 자리는 여전히 많고, 주소
// `?session=` 이펙트는 그 위에 자기만의 사정(이펙트가 다시 도는 중인가)을 하나 더
// 얹는다 — 그것은 자리 다툼이 아니라 다른 사건이라 거기 남는다 (SOMA-414).

import { useCallback, useRef, useState } from "react";

export type ActiveSession = {
  /**
   * 화면이 그리는 연습. 렌더를 다시 일으켜야 하는 자리는 이것을 읽는다 —
   * 목록에서 어느 줄이 켜져 있는지, 지우기 버튼이 있는지.
   */
  id: string | null;
  /**
   * 지금 이 순간 자리에 있는 연습. 기다림 뒤의 코드가 읽는다 — 그 사이 화면이
   * 넘어갔으면 렌더 값은 아직 옛것일 수 있다.
   */
  current: () => string | null;
  /**
   * 이 연습이 아직 그 자리인가. 자리를 **먼저 잡고** 조회를 띄우는 길(목록에서 열기,
   * 새 연습 만들기, 폴링, 코치 붙이기)의 취소 가드다.
   */
  isCurrent: (sessionId: string) => boolean;
  /**
   * 이 연습이 그 자리를 쓸 수 있는가 — 비어 있거나 이미 이 연습의 것이거나.
   * 조회가 **끝나야** 자리를 잡는 길(주소 `?session=`)이 쓴다. 첫 진입은 아직 아무도
   * 자리에 없으므로 `isCurrent` 로 물으면 자기 자신이 걸러진다 (SOMA-414).
   *
   * 갈리는 까닭은 그 시점 하나뿐이다 — 주소 경로도 다른 길처럼 조회 전에 자리를
   * 잡게 되면 이것은 `isCurrent` 로 접힌다.
   */
  isCurrentOrFree: (sessionId: string) => boolean;
  /**
   * 이 연습이 지금 화면이라고 세운다. `null` 은 아무 연습도 아닌 자리(새 연습 준비)다.
   * 두 벌을 한 번에 세우므로 한쪽만 세워 어긋나는 일이 없다.
   */
  setCurrent: (sessionId: string | null) => void;
};

export function useActiveSession(): ActiveSession {
  const [id, setId] = useState<string | null>(null);
  // 렌더를 기다릴 수 없는 자리가 읽는 같은 값. setState 는 다음 렌더에나 보이는데,
  // 취소 가드는 답이 돌아온 그 자리에서 곧바로 물어야 한다.
  const currentRef = useRef<string | null>(null);

  const current = useCallback(() => currentRef.current, []);

  const isCurrent = useCallback(
    (sessionId: string) => currentRef.current === sessionId,
    [],
  );

  const isCurrentOrFree = useCallback(
    (sessionId: string) =>
      currentRef.current === null || currentRef.current === sessionId,
    [],
  );

  const setCurrent = useCallback((sessionId: string | null) => {
    currentRef.current = sessionId;
    setId(sessionId);
  }, []);

  // 🔒 넷은 **늘 같은 함수여야 한다.** 부르는 쪽이 이것을 이펙트 의존성에 싣기 때문에,
  // 하나라도 매 렌더 새로 서면 그 이펙트가 매 렌더 정리되고 다시 돈다 — 주소로 연
  // 연습은 그 정리가 세운 취소 표시에 걸려 **조용히 안 열린다.** 이 동일성은
  // tests/use-active-session.test.mjs 가 못박는다.
  return { id, current, isCurrent, isCurrentOrFree, setCurrent };
}
