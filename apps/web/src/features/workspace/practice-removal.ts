import { deletePracticeSession } from "@/lib/api/v2/sessions";

// 연습 하나를 지우는 길. 헤더의 삭제 버튼 하나가 이것을 부른다.
//
// 지우기 자체는 요청 한 번이라 여기 모을 것이 없어 보이지만, 그 답이 돌아왔을 때
// **그 연습이 아직 지금 화면인가**가 무엇을 할지를 통째로 가른다 — 지우는 사이
// 목록에서 다른 연습을 여는 길에는 잠금이 없다(`use-workspace-busy.ts` 가 잠그는
// 것은 지우기 버튼 쪽이다). 옛 코드는 그것을 묻지 않아, 지우기가 끝나면 방금 연
// 연습을 준비 화면으로 되돌려 통째로 날렸고 실패 문구도 남의 화면에 띄웠다.
//
// 화면을 무엇으로 바꾸는지는 여기서 정하지 않는다(호출부의 몫) — session-loading.ts ·
// practice-start.ts 와 같은 모양이고, 그래서 이 파일은 함수 호출만으로 테스트된다.
// 그 둘과 갈리는 것은 하나다: 실패한 까닭을 들려 보내지 않는다(`cause` 가 없다).
// 지우기가 왜 실패했든 배우에게 하는 말이 하나뿐이라 부르는 쪽이 그것을 가를 일이
// 없다 — 갈라야 할 날이 오면 그때 얹는다.

/**
 * 지워 본 결과. 무엇을 더 해야 하는지가 이 하나로 갈린다 — 화면을 되돌릴지,
 * 목록만 갱신할지, 문구를 띄울지.
 */
export type PracticeRemovalOutcome =
  /** 지웠고 그 연습이 아직 지금 화면이다. 화면을 되돌릴 자리다. */
  | { kind: "removed" }
  /**
   * 지웠지만 기다리는 사이 다른 연습이 화면을 차지했다. 목록에서는 사라져야 하고,
   * 화면은 건드리면 안 된다 — 되돌리면 방금 연 그 연습을 날린다.
   */
  | { kind: "removedSuperseded" }
  /** 못 지웠고 아직 그 화면이다. 문구를 띄울 자리다. */
  | { kind: "failed" }
  /** 못 지웠고 화면은 이미 남의 것이다. 오류도 남의 화면에 띄우면 안 된다. */
  | { kind: "failedSuperseded" };

export type RemovePracticeInput = {
  sessionId: string;
  /**
   * 이 연습이 아직 지금 화면인가. 요청을 띄우기 전이 아니라 **답이 온 뒤에** 묻는다 —
   * 그 사이에 자리가 넘어가는 것이 바로 이 가드가 막는 것이다.
   */
  isCurrent: () => boolean;
};

export async function removePractice({
  sessionId,
  isCurrent,
}: RemovePracticeInput): Promise<PracticeRemovalOutcome> {
  try {
    await deletePracticeSession(sessionId);
    return isCurrent() ? { kind: "removed" } : { kind: "removedSuperseded" };
  } catch {
    return isCurrent() ? { kind: "failed" } : { kind: "failedSuperseded" };
  }
}
