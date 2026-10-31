import { ACTTUB_CLIENT } from "../../config/env";
import {
  findBuiltinPost,
  mergeSummaries,
  parseApiPost,
  parseApiSummary,
} from "../../../features/blog/posts";
import type { BlogCategory, BlogPost, BlogPostSummary } from "../../../features/blog/types";
import { SERVER_API_ORIGIN } from "./public-entry";

// 블로그는 공개 읽기 전용이다. 웹 서버가 렌더 때 API 에 직접 묻고(ISR 300초), 실패하면 내장 글만 쓴다.
// ⚠ 서버에서만 import 한다(SERVER_API_ORIGIN 이 내부 주소).

export const BLOG_REVALIDATE_SECONDS = 300;

type Fetcher = typeof fetch;

async function getJson(
  path: string,
  fetcher: Fetcher,
  origin: string,
): Promise<{ status: number; json: unknown } | null> {
  try {
    const response = await fetcher(`${origin}${path}`, {
      headers: { "X-Acttub-Client": ACTTUB_CLIENT, "Accept-Language": "ko" },
      next: { revalidate: BLOG_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { status: response.status, json: null };
    return { status: response.status, json: await response.json() };
  } catch {
    return null;
  }
}

/** API 글 요약. 실패(네트워크·4xx·5xx·모양 오류)는 빈 배열이다. */
export async function fetchApiPostSummaries(
  options: { category?: BlogCategory | null; fetcher?: Fetcher; origin?: string } = {},
): Promise<BlogPostSummary[]> {
  const query = new URLSearchParams({ limit: "50" });
  if (options.category) query.set("category", options.category);
  const result = await getJson(
    `/v2/blog/posts?${query}`,
    options.fetcher ?? fetch,
    options.origin ?? SERVER_API_ORIGIN,
  );
  const items = (result?.json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => parseApiSummary(item) ?? []);
}

/** 목록 화면용: API + 내장 글, 최신순. category 가 없으면 전체다. */
export async function loadBlogSummaries(
  options: { fetcher?: Fetcher; origin?: string } = {},
): Promise<BlogPostSummary[]> {
  return mergeSummaries(await fetchApiPostSummaries(options));
}

/** 상세: API 글이 먼저고, 없으면(404·실패 포함) 같은 slug 의 내장 글이다. */
export async function loadBlogPost(
  slug: string,
  options: { fetcher?: Fetcher; origin?: string } = {},
): Promise<BlogPost | null> {
  const result = await getJson(
    `/v2/blog/posts/${encodeURIComponent(slug)}`,
    options.fetcher ?? fetch,
    options.origin ?? SERVER_API_ORIGIN,
  );
  const fromApi = result?.status === 200 ? parseApiPost(result.json) : null;
  return fromApi ?? findBuiltinPost(slug);
}
