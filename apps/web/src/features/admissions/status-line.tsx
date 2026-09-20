import type { ReactNode } from "react";

/**
 * 답을 기다리거나 못 받았을 때 본문 자리에 뜨는 한 줄. 두 화면(목록·대학 상세)이 다섯
 * 자리에서 같은 클래스 문자열을 그대로 적고 있었다.
 *
 * 이름이 `Notice` 가 아닌 까닭은, 이 feature 에서 `notice` 가 이미 **입시 공고**를
 * 뜻하기 때문이다(`AdmissionNotice`·`NoticeCard`·`notice.stages`). 한 feature 안에서
 * 도메인 용어가 두 뜻을 갖지 않게 했다.
 *
 * ⚠ 이 파일 자체가 apps/web/CLAUDE.md 의 "프레젠테이션 컴포넌트는 같은 파일의 로컬
 * 함수로" 밖에 있다. 두 화면이 나눠 써야 해서다 (SOMA-411).
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
