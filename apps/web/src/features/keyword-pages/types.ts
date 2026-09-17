// 검색 유입용 공개 페이지의 본문 모델. 본문은 `content/*.ts`에 데이터로 두고
// 화면(`keyword-page-view.tsx`)과 FAQ 구조화 데이터가 같은 값을 읽는다 —
// 화면에 없는 문답이 JSON-LD에만 있으면 검색엔진이 스팸으로 본다.

export type KeywordBlock =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: readonly string[] }
  | { kind: "ol"; items: readonly string[] }
  | { kind: "example"; label: string; lines: readonly string[] };

export type KeywordSection = {
  /** 페이지 안 앵커. 영문 소문자와 하이픈만 쓴다. */
  id: string;
  heading: string;
  blocks: readonly KeywordBlock[];
};

export type KeywordFaq = {
  question: string;
  answer: string;
};

export type KeywordLink = {
  href: string;
  label: string;
};

export type KeywordPageContent = {
  /** 슬래시로 시작하는 공개 경로. sitemap·canonical·JSON-LD가 같이 읽는다. */
  path: string;
  /** `<title>`. 루트 템플릿이 뒤에 " | Acttub"을 붙인다. */
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lead: readonly string[];
  /** 본문을 마지막으로 손본 날(YYYY-MM-DD). 화면과 Article JSON-LD에 쓴다. */
  updatedAt: string;
  sections: readonly KeywordSection[];
  faq: readonly KeywordFaq[];
  related: readonly KeywordLink[];
};
