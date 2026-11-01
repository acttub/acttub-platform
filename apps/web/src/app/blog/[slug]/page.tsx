import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlogPostView } from "@/features/blog/blog-post-view";
import { BUILTIN_POSTS, relatedPosts } from "@/features/blog/posts";
import { loadBlogPost, loadBlogSummaries } from "@/lib/api/v2/blog";
import { buildBlogArticleJsonLd, buildOrganizationJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildBlogPostMetadata } from "@/lib/seo/site-metadata";

// Next 가 정적으로 읽어야 해서 숫자 그대로 둔다(lib/api/v2/blog.ts 의 BLOG_REVALIDATE_SECONDS 와 같은 값).
export const revalidate = 300;

type BlogPostPageProps = { params: Promise<{ slug: string }> };

// 내장 글만 미리 만든다. API 글은 첫 요청 때 만들어 300초마다 갱신한다.
export function generateStaticParams() {
  return BUILTIN_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const post = await loadBlogPost((await params).slug);
  if (!post) notFound();
  return buildBlogPostMetadata(post);
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const post = await loadBlogPost((await params).slug);
  if (!post) notFound();
  const related = relatedPosts(post, await loadBlogSummaries());

  return (
    <>
      <JsonLd values={[buildBlogArticleJsonLd(post), buildOrganizationJsonLd()]} />
      <BlogPostView post={post} related={related} />
    </>
  );
}
