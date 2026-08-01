"use client";

// 커뮤니티 글 목록. 카테고리 탭 + 최신순 + 더 보기.
//
// 정적 export라 목록을 서버에서 그려 줄 수 없다. 첫 화면은 빈 껍데기로 나가고
// 마운트한 뒤 불러온다.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  authorName,
  getCategories,
  getPosts,
  type CommunityCategory,
  type CommunityPost,
} from "@/lib/api/v2/community";
import { useOptionalAuth } from "@/features/auth/use-optional-auth";
import { CommunityShell, Notice, PrimaryButton, errorMessage, relativeTime } from "./shell";

const ALL = "all";

export function CommunityBoard() {
  // 가입 전에도 읽을 수 있다. 글쓰기 버튼만 로그인으로 보낸다.
  const { loggedIn } = useOptionalAuth();
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [active, setActive] = useState<string>(ALL);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 정적 export라 서버 시각이 없다. 목록이 온 뒤에 한 번 읽어 프리렌더와 어긋나지 않게 한다.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCategories({ signal: controller.signal })
      .then(setCategories)
      .catch(() => {
        // 탭이 없어도 전체 목록은 볼 수 있다. 굳이 화면을 막지 않는다.
      });
    return () => controller.abort();
  }, []);

  // 탭을 바꾸는 순간 목록을 비우고 다시 부른다. setState 는 effect 안이 아니라
  // 이 이벤트 핸들러에서 한다 — effect 안에서 부르면 렌더가 한 번 더 돈다.
  function selectCategory(slug: string) {
    if (slug === active) return;
    setActive(slug);
    setPosts([]);
    setCursor(null);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    getPosts({
      category: active === ALL ? null : active,
      signal: controller.signal,
    })
      .then((page) => {
        setNow(Date.now());
        setPosts(page.posts);
        setCursor(page.next_cursor);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "글을 불러오지 못했어요."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getPosts({
        category: active === ALL ? null : active,
        cursor,
      });
      setPosts((previous) => [...previous, ...page.posts]);
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(errorMessage(cause, "글을 더 불러오지 못했어요."));
    } finally {
      setLoadingMore(false);
    }
  }, [active, cursor, loadingMore]);

  return (
    <CommunityShell
      title="커뮤니티"
      subtitle="연습하다 든 생각, 입시에서 막힌 것, 알아두면 좋은 것을 나누는 곳이에요."
      action={
        <Link href={loggedIn ? "/community/new" : "/login?next=%2Fcommunity%2Fnew"}>
          <PrimaryButton>글쓰기</PrimaryButton>
        </Link>
      }
    >
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        <CategoryTab
          label="전체"
          active={active === ALL}
          onClick={() => selectCategory(ALL)}
        />
        {categories.map((category) => (
          <CategoryTab
            key={category.slug}
            label={category.name}
            active={active === category.slug}
            onClick={() => selectCategory(category.slug)}
          />
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !error && <Notice tone="muted">불러오는 중이에요…</Notice>}

      {!loading && !error && posts.length === 0 && (
        <div className="mt-10 rounded-3xl bg-white px-6 py-12 text-center">
          <p className="text-sm font-bold text-[#4e5968]">아직 글이 없어요.</p>
          <p className="mt-1 text-[13px] font-semibold text-[#8b95a1]">
            첫 글을 남기면 다음 사람이 답을 답니다.
          </p>
        </div>
      )}

      {posts.length > 0 && (
        <ul className="mt-4 space-y-2">
          {posts.map((post) => (
            <li key={post.id}>
              <PostRow post={post} now={now} />
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-[#4e5968] disabled:text-[#c6d3e3]"
          >
            {loadingMore ? "불러오는 중이에요…" : "더 보기"}
          </button>
        </div>
      )}
    </CommunityShell>
  );
}

function CategoryTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-black transition ${
        active ? "bg-[#191f28] text-white" : "bg-white text-[#8b95a1]"
      }`}
    >
      {label}
    </button>
  );
}

function PostRow({ post, now }: { post: CommunityPost; now: number | null }) {
  const when = relativeTime(post.created_at, now);
  return (
    <Link
      href={`/community/post?id=${post.id}`}
      className="block rounded-2xl bg-white px-5 py-4 transition hover:bg-[#f2f7ff]"
    >
      <p className="text-[12px] font-black text-[#3182f6]">{post.category_name}</p>
      <p className="mt-1 truncate text-[15px] font-black text-[#191f28]">
        {post.title}
      </p>
      <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-[#8b95a1]">
        {post.body}
      </p>
      <p className="mt-3 text-[12px] font-bold text-[#8b95a1]">
        {authorName(post.author)} · {when} · 좋아요 {post.like_count} · 댓글{" "}
        {post.comment_count}
      </p>
    </Link>
  );
}
