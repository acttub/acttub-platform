import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const posts = await import("../src/features/blog/posts.ts");
const { parseMarkdown, parseInline, safeUrl } = await import("../src/features/blog/markdown.ts");
const { fetchApiPostSummaries, loadBlogPost, loadBlogSummaries } = await import("../src/lib/api/v2/blog.ts");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { MarkdownView } = await import("../src/features/blog/markdown-view.tsx");

const apiItem = (over = {}) => ({
  slug: "hello", title: "안녕", summary: "요약", category: "news",
  cover_image_url: null, published_at: "2099-10-30T01:00:00Z", reading_minutes: 3, ...over,
});
const json = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("내장 글: 가이드 8편이 slug·분류·날짜를 갖고 입시 글만 admissions 다", () => {
  assert.equal(posts.BUILTIN_POSTS.length, 8);
  for (const post of posts.BUILTIN_POSTS) {
    assert.match(post.slug, /^[a-z0-9-]+$/);
    assert.match(post.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["practice", "admissions"].includes(post.category));
    assert.equal(post.body.kind, "guide");
  }
});

test("API 요약 변환: 필수값이 틀리면 버린다", () => {
  assert.equal(posts.parseApiSummary(apiItem()).coverImageUrl, null);
  assert.equal(posts.parseApiSummary(apiItem({ category: "x" })), null);
  assert.equal(posts.parseApiSummary(apiItem({ published_at: "bad" })), null);
  assert.equal(posts.parseApiSummary(null), null);
});

test("병합: slug 충돌이면 API 가 이기고 최신순이다", () => {
  const dup = posts.BUILTIN_POSTS[0].slug;
  const merged = posts.mergeSummaries([
    posts.parseApiSummary(apiItem({ slug: dup, title: "API 판", published_at: "2020-01-01T00:00:00Z" })),
    posts.parseApiSummary(apiItem()),
  ]);
  assert.equal(merged.length, posts.BUILTIN_POSTS.length + 1);
  assert.equal(merged.find((p) => p.slug === dup).title, "API 판");
  assert.equal(merged[0].slug, "hello");
});

test("분류 필터와 관련 글", () => {
  const all = posts.mergeSummaries([]);
  const admissions = posts.filterByCategory(all, "admissions");
  assert.ok(admissions.length > 0 && admissions.every((p) => p.category === "admissions"));
  const rel = posts.relatedPosts(all[0], all);
  assert.ok(rel.length <= 3 && rel.every((p) => p.slug !== all[0].slug && p.category === all[0].category));
});

test("목록 API 실패(네트워크·404·500·모양 오류)는 내장 글만 남긴다", async () => {
  const origin = "http://x";
  for (const fetcher of [
    async () => { throw new Error("down"); },
    json(404, { detail: "nope" }),
    json(500, {}),
    json(200, { items: "bad" }),
  ]) {
    const result = await loadBlogSummaries({ fetcher, origin });
    assert.equal(result.length, posts.BUILTIN_POSTS.length);
  }
  const ok = await fetchApiPostSummaries({ fetcher: json(200, { items: [apiItem(), { bad: 1 }] }), origin });
  assert.equal(ok.length, 1);
});

test("상세: API 우선, 404/실패면 내장 글, 둘 다 없으면 null", async () => {
  const origin = "http://x";
  const full = { ...apiItem(), author_name: "우영", body_markdown: "본문", app_cta: "reading" };
  const fromApi = await loadBlogPost("hello", { fetcher: json(200, full), origin });
  assert.equal(fromApi.appCta, "reading");
  assert.equal(fromApi.body.kind, "markdown");
  const builtin = posts.BUILTIN_POSTS[0].slug;
  assert.equal((await loadBlogPost(builtin, { fetcher: json(404, {}), origin })).body.kind, "guide");
  assert.equal(await loadBlogPost("nothing", { fetcher: json(404, {}), origin }), null);
  assert.equal(await loadBlogPost("nothing", { fetcher: async () => { throw new Error("x"); }, origin }), null);
  const badCta = await loadBlogPost("hello", { fetcher: json(200, { ...full, app_cta: "zzz" }), origin });
  assert.equal(badCta.appCta, "none");
});

test("마크다운: 기본 블록", () => {
  const blocks = parseMarkdown("# 제목\n\n문단 **굵게** 와 *기울임*\n이어짐\n\n- a\n- b\n\n1. x\n2. y\n\n> 인용\n\n---");
  assert.deepEqual(blocks.map((b) => b.t), ["heading", "p", "ul", "ol", "quote", "hr"]);
  assert.equal(blocks[0].depth, 2);
});

test("마크다운 안전: 원문 HTML·위험 주소는 실행되지 않는다", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("//evil.com"), null);
  assert.equal(safeUrl("https://acttub.com/a"), "https://acttub.com/a");
  assert.equal(safeUrl("/blog/x"), "/blog/x");
  const html = renderToStaticMarkup(createElement(MarkdownView, {
    markdown: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[나쁨](javascript:alert(1)) ![x](javascript:alert(2)) [좋음](https://a.com)',
  }));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img src=\"x\""));
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(!/src="javascript/i.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/a\.com"[^>]*rel="noopener noreferrer nofollow"/);
  assert.deepEqual(parseInline("[x](javascript:1)").map((n) => n.t), ["text"]);
});
