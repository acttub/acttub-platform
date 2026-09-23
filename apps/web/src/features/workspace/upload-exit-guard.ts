/**
 * 마무리 전 영상이 떠 있는 동안 탭을 닫으려 하면 경고를 띄운다(practice.record 웹 항목).
 * 웹에는 앱의 업로드 큐가 없어서, 탭이 닫히면 올리던 바이트가 그대로 사라지고 보관함에는
 * 아무것도 남지 않는다. 브라우저는 문구를 우리에게 맡기지 않으므로 값을 채워 "무언가 남아
 * 있다"만 알린다.
 *
 * window 를 받아서 테스트가 가짜 창으로 부른다 — jsdom 없이도 등록·해제와 경고 여부를 본다.
 */
export interface ExitGuardWindow {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

/**
 * `active` 가 참인 동안에만 경고를 건다. 돌려받은 함수를 부르면 걷는다.
 * 참이 아닐 때는 아예 걸지 않는다 — 걸어 두고 안에서 빠져나오면, 다른 이유로 뜬 경고까지
 * 이 자리가 책임지게 된다.
 */
export function guardUnfinishedUpload(win: ExitGuardWindow | null | undefined, active: boolean): () => void {
  if (!win || !active) return () => {};
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // 옛 브라우저는 returnValue 가 비어 있으면 묻지 않고 그냥 닫는다.
    event.returnValue = "";
  };
  win.addEventListener("beforeunload", onBeforeUnload);
  return () => win.removeEventListener("beforeunload", onBeforeUnload);
}
