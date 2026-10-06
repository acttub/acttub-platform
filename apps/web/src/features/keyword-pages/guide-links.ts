// 가이드 본문(content/guide)을 불러오지 않는 바로가기 목록 — 랜딩은 클라이언트 번들이라
// 본문 43k자를 끌어오면 안 된다. 경로는 tests/guide-registry.test.mjs가 레지스트리와 맞춘다.
export type GuideLink = { href: string; label: string };

export const LANDING_GUIDE_LINKS: readonly GuideLink[] = [
  { href: "/guide/monologue-practice", label: "독백 연습 혼자 하는 법" },
  { href: "/guide/choosing-free-acting-piece", label: "자유연기 작품 고르는 법" },
  { href: "/guide/acting-exam-prep-timeline", label: "연극영화과 입시 준비 순서" },
  { href: "/guide/self-tape", label: "셀프테이프 찍는 법" },
];

export const ADMISSIONS_GUIDE_LINKS: readonly GuideLink[] = [
  { href: "/guide/acting-exam-prep-timeline", label: "연극영화과 입시 준비 순서" },
  { href: "/guide/choosing-free-acting-piece", label: "자유연기 작품 고르는 법" },
  { href: "/guide/monologue-practice", label: "독백 연습 혼자 하는 법" },
  { href: "/guide/scene-analysis-basics", label: "대본 장면 분석 기본" },
];
