import type { ReactNode } from "react";

/**
 * 답을 기다리거나 못 받았을 때 본문 자리에 뜨는 한 줄. 두 화면(목록·대학 상세)이 다섯
 * 자리에서 같은 클래스 문자열을 그대로 적고 있었다.
 *
 * `features/community/shell.tsx` 의 `Notice` 와 같은 것인데 이름을 달리한 까닭은, 이
 * feature 에서 `notice` 가 이미 **입시 공고**를 뜻하기 때문이다(`AdmissionNotice`·
 * `NoticeCard`·`notice.stages`). 도메인 용어가 두 뜻을 갖는 것보다 같은 것에 두 이름이
 * 붙는 편이 낫다.
 *
 * ⚠ 그래서 이 세 줄은 커뮤니티 쪽과 여전히 겹쳐 있다. 둘을 하나로 합치려면 feature 를
 * 가로지르는 프레젠테이션 자리를 새로 만들어야 하는데 — `src/lib` 에는 tsx 가 하나도
 * 없고 apps/web/CLAUDE.md 는 프레젠테이션을 같은 파일의 로컬 함수로 두라고 한다 —
 * 그것은 구조를 정하는 일이라 이 티켓에서 하지 않는다 (SOMA-411).
 */
export function StatusLine({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: ReactNode;
}) {
  const color = tone === "error" ? "text-[#e5484d]" : "text-[#8b95a1]";
  return <p className={`mt-8 text-sm font-semibold ${color}`}>{children}</p>;
}
