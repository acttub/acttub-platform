// 블로그 글 모델. API(/v2/blog/posts)의 응답과 내장 글(기존 가이드)이 같은 모양으로 합쳐진다.

export const BLOG_CATEGORIES = ["practice", "admissions", "audition", "news"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export const BLOG_CATEGORY_LABEL: Record<BlogCategory, string> = {
  practice: "연습법",
  admissions: "입시",
  audition: "오디션",
  news: "액터브 소식",
};

export const BLOG_APP_CTAS = ["coaching", "reading", "challenge", "none"] as const;
export type BlogAppCta = (typeof BLOG_APP_CTAS)[number];

export type BlogPostSummary = {
  slug: string;
  title: string;
  summary: string;
  category: BlogCategory;
  coverImageUrl: string | null;
  /** ISO 8601 또는 YYYY-MM-DD */
  publishedAt: string;
  readingMinutes: number;
};

export type BlogPostBody =
  | { kind: "markdown"; markdown: string }
  | { kind: "guide"; slug: string };

export type BlogPost = BlogPostSummary & {
  authorName: string;
  appCta: BlogAppCta;
  body: BlogPostBody;
};
