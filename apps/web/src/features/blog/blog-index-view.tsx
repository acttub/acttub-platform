import Link from "next/link";

import { KeywordShell } from "@/features/keyword-pages/keyword-shell";

import { formatPostDate } from "./posts";
import {
  BLOG_CATEGORIES,
  BLOG_CATEGORY_LABEL,
  type BlogCategory,
  type BlogPostSummary,
} from "./types";

function meta(post: BlogPostSummary): string {
  return `${BLOG_CATEGORY_LABEL[post.category]} · ${formatPostDate(post.publishedAt)} · ${post.readingMinutes}분`;
}

function CategoryTabs({ active }: { active: BlogCategory | null }) {
  const tabs: { key: BlogCategory | null; label: string; href: string }[] = [
    { key: null, label: "전체", href: "/blog" },
    ...BLOG_CATEGORIES.map((key) => ({
      key,
      label: BLOG_CATEGORY_LABEL[key],
      href: `/blog?category=${key}`,
    })),
  ];
  return (
    <nav aria-label="분류" className="-mx-5 mt-8 flex gap-6 overflow-x-auto border-b border-[#e5e8eb] px-5 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={selected ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 pb-3 text-base font-bold ${
              selected ? "border-[#191f28] text-[#191f28]" : "border-transparent text-[#8b95a1] hover:text-[#4e5968]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FeaturedCard({ post }: { post: BlogPostSummary }) {
  if (!post.coverImageUrl) {
    // 대표 이미지가 없는 글은 빈 회색 상자 대신 글 자체를 크게 보여 준다.
    return (
      <Link href={`/blog/${post.slug}`} className="group flex min-h-[260px] flex-col rounded-2xl bg-[#f2f4f6] p-7 sm:p-8">
        <p className="text-sm font-semibold text-[#8b95a1]">{meta(post)}</p>
        <h2 className="mt-3 break-keep text-2xl font-black leading-snug tracking-[-0.03em] text-[#191f28] group-hover:underline">
          {post.title}
        </h2>
        <p className="mt-auto break-keep pt-6 text-[15px] leading-6 text-[#4e5968]">{post.summary}</p>
      </Link>
    );
  }
  return (
    <Link href={`/blog/${post.slug}`} className="group block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={post.coverImageUrl} alt="" loading="lazy" className="aspect-[16/10] w-full rounded-2xl bg-[#f2f4f6] object-cover" />
      <p className="mt-4 text-sm font-semibold text-[#8b95a1]">{meta(post)}</p>
      <h2 className="mt-2 break-keep text-xl font-black leading-snug tracking-[-0.03em] text-[#191f28] group-hover:underline">
        {post.title}
      </h2>
    </Link>
  );
}

export function BlogIndexView({
  posts,
  category,
}: {
  posts: readonly BlogPostSummary[];
  category: BlogCategory | null;
}) {
  const featured = posts.slice(0, 2);
  const rest = posts.slice(2);

  return (
    <KeywordShell current="blog">
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:pt-20">
        <h1 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">블로그</h1>
        <p className="mt-4 break-keep text-base font-semibold leading-7 text-[#4e5968] sm:text-lg">
          연기 연습법, 입시, 오디션 이야기와 액터브 소식을 전해요.
        </p>
        <CategoryTabs active={category} />

        {posts.length === 0 ? (
          <p className="mt-12 text-base font-semibold text-[#8b95a1]">아직 올라온 글이 없어요.</p>
        ) : (
          <>
            <div className="mt-10 grid gap-8 sm:grid-cols-2">
              {featured.map((post) => <FeaturedCard key={post.slug} post={post} />)}
            </div>
            {rest.length > 0 && (
              <ul className="mt-10 divide-y divide-[#e5e8eb] border-y border-[#e5e8eb]">
                {rest.map((post) => (
                  <li key={post.slug}>
                    <Link href={`/blog/${post.slug}`} className="group block py-6">
                      <p className="text-sm font-semibold text-[#8b95a1]">{meta(post)}</p>
                      <h3 className="mt-2 break-keep text-lg font-black leading-snug text-[#191f28] group-hover:underline">
                        {post.title}
                      </h3>
                      {post.summary && (
                        <p className="mt-2 break-keep text-base leading-7 text-[#4e5968]">{post.summary}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </KeywordShell>
  );
}
