import { getReport } from "@/lib/api/v2/reports";
import { getPracticeSession } from "@/lib/api/v2/sessions";
import type { PracticeReport, PracticeSessionDetail } from "@/lib/api/v2/types";

// 이미 있는 연습 하나를 열어 화면에 실을 것까지 받아 오는 길. 목록에서 누르는 길과
// 주소 ?session= 으로 들어오는 길이 이 하나를 쓴다 — 옛 코드는 같은 순서를 두 번
// 적어 두고 있었고, 그러면서 그 사이 취소 가드만 서로 다르게 자랐다.
//
// 티켓이 센 사본은 셋인데 여기 모인 것은 둘이다. 나머지 하나(`begin` 후반)는 방금
// **만든** 세션을 화면에 세우는 자리라 이 조회 파이프라인을 타지 않는다 — 거기서
// 부르는 상세 조회는 장면 정보만 채우는 뒷북이고, 무엇을 더 할지 가르지 않는다.
//
// 화면을 무엇으로 바꾸는지는 여기서 정하지 않는다(호출부의 몫) — practice-start.ts 와
// 같은 모양이고, 그래서 두 진입 경로가 저마다 다르게 하는 일(로딩 표시·오류 문구·
// 올리던 영상 버리기)은 그대로 호출부에 남는다.

/**
 * 열어 본 결과. 무엇을 더 해야 하는지가 이 하나로 갈린다 — 폴링을 걸지, 그 자리에
 * 멈출지, 노트를 실을지, 코치를 부를지, 오류를 띄울지.
 */
export type SessionLoadOutcome =
  /**
   * 기다리는 사이 다른 연습이 화면을 차지했다. 호출부는 아무것도 하지 않는다 —
   * 오류도 남의 화면에 띄우면 안 된다.
   */
  | { kind: "superseded" }
  /**
   * 아직 훑어보는 중이다. 폴링을 건다. 서버가 "시작 전"이라 답한 것도 여기로 온다 —
   * 그 둘은 사람에게 같은 화면이다(CONTEXT.md 의 Analysis Status).
   */
  | { kind: "analyzing" }
  /** 훑어보기가 실패한 연습. 그 자리에서 멈춘다 — 노트도 코치도 부르지 않는다. */
  | { kind: "analysisFailed" }
  /** 훑어보기가 끝났고 노트도 있다. */
  | { kind: "note"; report: PracticeReport }
  /** 훑어보기는 끝났는데 노트가 없다. 코치를 부를 자리다. */
  | { kind: "noNote" }
  /** 연습 자체를 못 불러왔다. 무슨 문구를 띄울지는 진입 경로가 정한다. */
  | { kind: "loadFailed"; cause: unknown };

export type LoadPracticeSessionInput = {
  sessionId: string;
  /**
   * 이 요청이 아직 지금 화면인가. 기다림마다 다시 묻는다 — 목록에서 다른 연습을
   * 열었으면 그쪽이 지금 화면이고 이 응답은 거기 닿으면 안 된다.
   */
  isCurrent: () => boolean;
  /**
   * 연습을 받아 왔다. 무엇을 더 할지 갈리기 **전에** 부른다 — 화면은 받아 온 상태로
   * 먼저 옮기고, 폴링·노트 조회는 그다음이다.
   */
  onLoaded: (detail: PracticeSessionDetail) => void;
};

export async function loadPracticeSession({
  sessionId,
  isCurrent,
  onLoaded,
}: LoadPracticeSessionInput): Promise<SessionLoadOutcome> {
  try {
    const loaded = await getPracticeSession(sessionId);
    if (!isCurrent()) return { kind: "superseded" };
    onLoaded(loaded);
    if (loaded.status === "analyzing") {
      return { kind: "analyzing" };
    }
    if (loaded.status === "failed") return { kind: "analysisFailed" };
    try {
      const found = await getReport(sessionId);
      if (!isCurrent()) return { kind: "superseded" };
      return { kind: "note", report: found.report };
    } catch {
      if (!isCurrent()) return { kind: "superseded" };
      return { kind: "noNote" };
    }
  } catch (cause) {
    // 화면을 옮기다 터진 것도 여기로 온다 — 옛 코드에서 onLoaded 자리가 조회와 같은
    // try 안에 있었고, 그 경계를 그대로 옮겼다.
    return isCurrent() ? { kind: "loadFailed", cause } : { kind: "superseded" };
  }
}
