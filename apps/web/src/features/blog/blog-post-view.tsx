import Link from "next/link";

import { StoreBadges } from "@/features/app-download/store-badges";
import { KeywordShell } from "@/features/keyword-pages/keyword-shell";

import { GuideBody } from "./guide-body";
import { MarkdownView } from "./markdown-view";
import { formatPostDate } from "./posts";
import {
  BLOG_CATEGORY_LABEL,
  type BlogAppCta,
  type BlogPost,
  type BlogPostSummary,
} from "./types";

const CTA_COPY: Record<Exclude<BlogAppCta, "none">, { title: string; sub: string; action: string }> = {
  coaching: {
    title: "찍은 연기, 코치와 같이 봐요",
    sub: "연기 영상을 올리면 코치가 질문으로 장면을 같이 다시 봐요.",
    action: "앱에서 코칭 받기",
  },
  reading: {
    title: "대본 리딩, 앱에서 이어가요",
    sub: "대본을 올리고 상대역과 소리 내어 읽어 보세요.",
    action: "앱에서 대본 리딩하기",
  },
  challenge: {
    title: "이번 주 대사 챌린지",
    sub: "매주 열리는 대사 챌린지에 앱에서 참여해 보세요.",
    action: "앱에서 챌린지 참여하기",
  },
};

function AppCta({ cta }: { cta: BlogAppCta }) {
  if (cta === "none") return null;
  const copy = CTA_COPY[cta];
  return (
    <section className="mt-16 rounded-3xl bg-[#f2f4f6] p-7 sm:p-9">
      <div className="flex items-center gap-8">
        <div className="min-w-0 flex-1">
          <h2 className="break-keep text-2xl font-black tracking-[-0.03em] text-[#191f28]">{copy.title}</h2>
          <p className="mt-3 break-keep text-base leading-7 text-[#4e5968]">{copy.sub}</p>
          <p className="mt-6 text-sm font-bold text-[#8b95a1]">{copy.action}</p>
          <div className="mt-3">
            <StoreBadges surface="keyword_page" />
          </div>
        </div>
        {/* 데스크톱에서만 QR 을 보인다. 폰에서는 스토어 배지로 바로 간다. */}
        <div className="hidden shrink-0 text-center sm:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/app-qr.svg" alt="앱 설치 QR 코드" width={112} height={112} className="rounded-xl bg-white p-2" />
          <p className="mt-2 text-xs font-semibold text-[#8b95a1]">폰으로 스캔해요</p>
        </div>
      </div>
    </section>
  );
}

export function BlogPostView({
  post,
  related,
}: {
  post: BlogPost;
  related: readonly BlogPostSummary[];
}) {
  return (
    <KeywordShell current="blog">
      <article className="mx-auto max-w-2xl px-5 pb-24 pt-10 sm:pt-14">
        <Link href="/blog" className="text-sm font-bold text-[#8b95a1] hover:text-[#4e5968]">← 블로그</Link>
        <header className="mt-8">
          <p className="text-sm font-semibold text-[#8b95a1]">
            {BLOG_CATEGORY_LABEL[post.category]} · {formatPostDate(post.publishedAt)} · {post.readingMinutes}분
          </p>
          <h1 className="mt-3 break-keep text-3xl font-black leading-[1.25] tracking-[-0.04em] sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-sm font-semibold text-[#4e5968]">{post.authorName}</p>
        </header>

        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt="" className="mt-8 aspect-[16/10] w-full rounded-2xl bg-[#f2f4f6] object-cover" />
        )}

        <div className="mt-10 space-y-5 break-keep text-base leading-8 text-[#333d4b] sm:text-lg sm:leading-9">
          {post.body.kind === "markdown"
            ? <MarkdownView markdown={post.body.markdown} />
            : <GuideBody slug={post.body.slug} />}
        </div>

        <AppCta cta={post.appCta} />

        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="text-xl font-black">같은 분류의 글</h2>
            <ul className="mt-4 divide-y divide-[#e5e8eb] border-y border-[#e5e8eb]">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link href={`/blog/${item.slug}`} className="block py-5">
                    <p className="text-sm font-semibold text-[#8b95a1]">
                      {formatPostDate(item.publishedAt)} · {item.readingMinutes}분
                    </p>
                    <p className="mt-1 break-keep text-lg font-black leading-snug text-[#191f28]">{item.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </KeywordShell>
  );
}
