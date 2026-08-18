import type { ReactNode } from "react";

/**
 * 답을 기다리거나 못 받았을 때 본문 자리에 뜨는 한 줄. 두 화면(목록·대학 상세)이 다섯
 * 자리에서 같은 클래스 문자열을 그대로 적고 있었다.
 *
 * `features/community/shell.tsx` 의 `Notice` 와 같은 것인데 이름을 달리한 까닭은, 이
 * feature 에서 `notice` 가 이미 **입시 공고**를 뜻하기 때문이다(`AdmissionNotice`·
 * `NoticeCard`·`notice.stages`). 한 feature 안에서 도메인 용어가 두 뜻을 갖느니 같은
 * 것에 두 이름이 붙는 편이 낫다고 보았다.
 *
 * ⚠ 이 파일 자체가 apps/web/CLAUDE.md 의 "프레젠테이션 컴포넌트는 같은 파일의 로컬
 * 함수로" 밖에 있다. 두 화면이 나눠 써야 해서인데, community/shell.tsx 가 같은 형태의
 * 선례다. 그리고 그 결과로 세 줄이 커뮤니티 쪽과 여전히 겹친다 — 정의가 1 에서 2 로
 * 늘었고 인라인 다섯이 사라졌다. 둘까지 합치려면 feature 를 가로지르는 프레젠테이션
 * 자리가 필요한데(`src/lib` 에는 tsx 가 하나도 없다) 그것은 구조를 정하는 일이라 이
 * 티켓에서 하지 않는다 (SOMA-411).
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
