// 화면 뒤에서 도는 일과, 그 일이 무엇을 못 하게 막는가.
//
// 옛 코드는 이것을 `busy` 불린 하나로 들었고 서로 다른 세 사건이 그 하나를 나눠 썼다 —
// 지난 연습을 여는 중 · 지금 연습을 지우는 중 · 막힌 대화를 처음부터 다시 여는 중.
// 하나뿐이라 **누가 켰는지 모른 채 아무나 껐다**: 막힌 대화를 다시 여는 중에 목록에서
// 다른 연습을 누르면(그 목록에는 잠금이 없다) 그 조회의 끝이 아직 도는 재시작의 표시까지
// 함께 껐다. 켠 쪽이 자기 것을 알아볼 방법이 없어 `if (isCurrentSession(id))` 가드를
// 해제 자리마다 손으로 세웠고(셋 중 둘에만 세웠다 — 지우기 쪽은 그냥 껐다), 그 가드에
// 걸린 해제는 표시를 두고 갔다 — 그것을 푸는 자리(새 연습으로 되돌아가기)를 따로
// 두어야 했다.
//
// 여기서는 셋이 저마다 **어느 연습의 일인지**를 든다. 그러면 자기가 켠 것만 자기가 끄고,
// 두고 가는 일도 없다. 밖에 남는 것은 "무엇이 잠기는가" 뿐이다 — 부르는 자리가
// 세 사건을 다시 조합하지 않게, 그 조합은 여기 한 번만 적는다.

import { useCallback, useMemo, useState } from "react";

/** 화면 뒤에서 도는 일 셋. 저마다 한 연습에 붙는다. */
export type WorkspaceWork =
  /**
   * 목록에서 지난 연습을 여는 중(조회). 주소 `?session=` 으로 여는 길은 여기 들지
   * 않는다 — 그 길은 첫 진입 한 번뿐이고 그때는 잠글 것이 화면에 없다(옛 코드에도
   * 그 자리에는 표시가 없었다).
   */
  | "sessionLoading"
  /** 지금 연습을 지우는 중. */
  | "deleting"
  /** 막힌 대화를 처음부터 다시 여는 중. */
  | "restartingChat";

/** 그 일들이 무엇을 못 하게 막는가. */
export type WorkspaceDisabled = {
  /** 헤더의 지우기. 무엇이 돌든 그 사이에 연습을 지울 수는 없다. */
  remove: boolean;
  /**
   * 노트에서 대화로 돌아가는 길. 대화를 다시 여는 중은 여기 닿지 않는다 — 그 길은
   * 자기가 시작하는 순간 노트 화면을 떠난다(`coachStarting` 이 화면을 대화로 옮긴다).
   */
  backToChat: boolean;
};

export type WorkspaceBusy = {
  disabled: WorkspaceDisabled;
  /**
   * 이 연습의 일이 시작됐다. 돌려주는 것은 그 일의 **끝맺음**이고, 그것은 자기가 켠
   * 것이 아직 주인일 때만 끈다 — 기다리는 사이 다른 연습이 같은 일을 시작했으면
   * 그쪽 표시를 꺼서는 안 된다.
   *
   * 끝맺음을 여기서 돌려주는 이유는 부르는 자리가 무엇을 끄는지 **다시 적지 않게**
   * 하기 위해서다. 종류와 연습을 두 번 적으면 그 둘이 어긋난 코드도 타입을 통과한다.
   *
   * 가르는 것이 연습이라, **같은 연습의 같은 일**을 다시 시작하면 앞엣것의 끝맺음이
   * 뒤엣것을 끈다(같은 연습을 목록에서 두 번 누르는 길). 뒤엣것도 곧 자기 끝맺음에
   * 닿으므로 잠금이 잠깐 일찍 풀릴 뿐이고, 불린 하나를 쓰던 옛 코드도 여기서는
   * 같았다.
   */
  start: (work: WorkspaceWork, sessionId: string) => () => void;
  /** 새 연습 준비 화면으로 되돌아간다. 어느 연습의 일도 이제 이 화면의 것이 아니다. */
  clear: () => void;
};

type WorkOwners = Record<WorkspaceWork, string | null>;

const NOBODY: WorkOwners = {
  sessionLoading: null,
  deleting: null,
  restartingChat: null,
};

export function useWorkspaceBusy(): WorkspaceBusy {
  const [owners, setOwners] = useState<WorkOwners>(NOBODY);

  const start = useCallback((work: WorkspaceWork, sessionId: string) => {
    setOwners((current) =>
      current[work] === sessionId ? current : { ...current, [work]: sessionId },
    );
    return () => {
      setOwners((current) =>
        current[work] === sessionId ? { ...current, [work]: null } : current,
      );
    };
  }, []);

  const clear = useCallback(() => {
    setOwners((current) => (current === NOBODY ? current : NOBODY));
  }, []);

  const disabled = useMemo<WorkspaceDisabled>(
    () => ({
      remove: Boolean(
        owners.sessionLoading || owners.deleting || owners.restartingChat,
      ),
      backToChat: Boolean(owners.sessionLoading || owners.deleting),
    }),
    [owners],
  );

  // 🔒 손잡이 둘은 **늘 같은 함수여야 하고**, 잠금은 도는 일이 그대로면 같은 객체여야
  // 한다. 부르는 쪽이 이것을 useCallback 의존성에 싣기 때문이다 — 하나라도 매 렌더
  // 새로 서면 그것을 담은 콜백이 줄줄이 새로 서고, 그 끝에 이펙트가 있다
  // (use-active-session.ts 가 같은 이유로 같은 것을 지킨다). start 가 돌려주는
  // 끝맺음은 이 규칙 밖이다 — 그것은 부르는 자리의 지역 값으로만 산다.
  return { disabled, start, clear };
}
