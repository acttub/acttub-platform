import { BlogIndexView } from "@/features/blog/blog-index-view";
import { filterByCategory, isBlogCategory } from "@/features/blog/posts";
import { loadBlogSummaries } from "@/lib/api/v2/blog";
import { buildBlogItemListJsonLd, buildOrganizationJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildBlogIndexMetadata } from "@/lib/seo/site-metadata";

// Next 가 정적으로 읽어야 해서 숫자 그대로 둔다(lib/api/v2/blog.ts 의 BLOG_REVALIDATE_SECONDS 와 같은 값).
export const revalidate = 300;
export const metadata = buildBlogIndexMetadata();

type BlogIndexProps = { searchParams: Promise<{ category?: string | string[] }> };

export default async function BlogIndexPage({ searchParams }: BlogIndexProps) {
  const raw = (await searchParams).category;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const category = isBlogCategory(value) ? value : null;
  const all = await loadBlogSummaries();
  const posts = filterByCategory(all, category);

  return (
    <>
      <JsonLd values={[buildBlogItemListJsonLd(all), buildOrganizationJsonLd()]} />
      <BlogIndexView posts={posts} category={category} />
    </>
  );
}
