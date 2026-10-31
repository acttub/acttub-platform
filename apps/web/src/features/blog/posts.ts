// 블로그 글 목록의 합본: API 글 + 내장 글(기존 연기 연습 가이드 8편).
// 같은 slug 면 API 글이 이긴다. API 가 실패하면 내장 글만 남는다(호출하는 쪽이 빈 배열을 넘긴다).

import { GUIDES, guideSlug } from "@/features/keyword-pages/content/guide/index";
import type { KeywordPageContent } from "@/features/keyword-pages/types";

import {
  BLOG_APP_CTAS,
  BLOG_CATEGORIES,
  type BlogAppCta,
  type BlogCategory,
  type BlogPost,
  type BlogPostSummary,
} from "./types";

export function isBlogCategory(value: unknown): value is BlogCategory {
  return typeof value === "string" && (BLOG_CATEGORIES as readonly string[]).includes(value);
}

export function readingMinutesOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 500));
}

function guideText(guide: KeywordPageContent): string {
  const parts: string[] = [...guide.lead];
  for (const section of guide.sections) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "p" || block.kind === "h3") parts.push(block.text);
      else if (block.kind === "ul" || block.kind === "ol") parts.push(...block.items);
      else parts.push(block.label, ...block.lines);
    }
  }
  return parts.join(" ");
}

export function guideToPost(guide: KeywordPageContent): BlogPost {
  const slug = guideSlug(guide);
  return {
    slug,
    title: guide.h1,
    summary: guide.description,
    category: guide.eyebrow.includes("입시") ? "admissions" : "practice",
    coverImageUrl: null,
    // 가이드의 마지막 손본 날을 발행일로 쓴다.
    publishedAt: guide.updatedAt,
    readingMinutes: readingMinutesOf(guideText(guide)),
    authorName: "Acttub 팀",
    appCta: "coaching",
    body: { kind: "guide", slug },
  };
}

export const BUILTIN_POSTS: readonly BlogPost[] = GUIDES.map(guideToPost);

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** API 목록 한 건 → 요약. 필수 값이 틀리면 그 글만 버린다. */
export function parseApiSummary(raw: unknown): BlogPostSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const slug = str(r.slug);
  const title = str(r.title);
  const publishedAt = str(r.published_at);
  if (!slug || !title || !publishedAt || !isBlogCategory(r.category)) return null;
  if (Number.isNaN(Date.parse(publishedAt))) return null;
  return {
    slug,
    title,
    summary: typeof r.summary === "string" ? r.summary : "",
    category: r.category,
    coverImageUrl: str(r.cover_image_url),
    publishedAt,
    readingMinutes: typeof r.reading_minutes === "number" && r.reading_minutes > 0 ? Math.round(r.reading_minutes) : 1,
  };
}

/** API 상세 → 글. */
export function parseApiPost(raw: unknown): BlogPost | null {
  const summary = parseApiSummary(raw);
  if (!summary) return null;
  const r = raw as Record<string, unknown>;
  const markdown = typeof r.body_markdown === "string" ? r.body_markdown : null;
  if (markdown === null) return null;
  const appCta: BlogAppCta = (BLOG_APP_CTAS as readonly string[]).includes(r.app_cta as string)
    ? (r.app_cta as BlogAppCta)
    : "none";
  return {
    ...summary,
    authorName: str(r.author_name) ?? "Acttub 팀",
    appCta,
    body: { kind: "markdown", markdown },
  };
}

export function sortNewestFirst<T extends { publishedAt: string }>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** API 요약 + 내장 글. slug 충돌이면 API 가 이기고, 최신순으로 돌려준다. */
export function mergeSummaries(
  apiPosts: readonly BlogPostSummary[],
  builtin: readonly BlogPostSummary[] = BUILTIN_POSTS,
): BlogPostSummary[] {
  const taken = new Set(apiPosts.map((post) => post.slug));
  return sortNewestFirst([...apiPosts, ...builtin.filter((post) => !taken.has(post.slug))]);
}

export function filterByCategory<T extends { category: BlogCategory }>(
  posts: readonly T[],
  category: BlogCategory | null,
): T[] {
  return category ? posts.filter((post) => post.category === category) : [...posts];
}

export function relatedPosts(
  current: Pick<BlogPostSummary, "slug" | "category">,
  all: readonly BlogPostSummary[],
  limit = 3,
): BlogPostSummary[] {
  return all.filter((p) => p.slug !== current.slug && p.category === current.category).slice(0, limit);
}

export function findBuiltinPost(slug: string): BlogPost | null {
  return BUILTIN_POSTS.find((post) => post.slug === slug) ?? null;
}

/** "연습법 · 2026.10.31 · 4분" 에서 쓰는 날짜. 한국 날짜로 맞춘다. */
export function formatPostDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replaceAll("-", ".");
  const kst = new Date(Date.parse(iso) + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}
