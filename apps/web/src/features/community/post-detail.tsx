"use client";

// 글 하나와 그 댓글들.
//
// 정적 export라 `/community/[id]` 같은 동적 경로를 만들 수 없다. 글 id는 쿼리로
// 받는다(`/community/post?id=…`) — 공유 링크도 이 모양이 된다.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import {
  authorName,
  canBlock,
  createComment,
  deleteComment,
  deletePost,
  getComments,
  getPost,
  likePost,
  unlikePost,
  updateComment,
  type CommunityComment,
  type CommunityPost,
} from "@/lib/api/v2/community";
import { errorMessage } from "@/lib/api/v2/errors";
import { useOptionalAuth } from "@/features/auth/use-optional-auth";
import { ItemMenu, ModerationDialog, type ModerationTarget } from "./moderation";
import {
  AnonymousToggle,
  CommunityShell,
  Notice,
  PrimaryButton,
  QuietButton,
  relativeTime,
} from "./shell";

const COMMENT_MAX = 1000;

/** 라우트 파일은 metadata를 내보내야 해서 서버 컴포넌트다. 경계를 여기서 친다. */
export function PostDetailRoute() {
  return (
    <Suspense fallback={null}>
      <DetailWithParams />
    </Suspense>
  );
}

function DetailWithParams() {
  const id = useSearchParams().get("id");
  return <PostDetail postId={id} />;
}

export function PostDetail({ postId }: { postId: string | null }) {
  const router = useRouter();
  // 읽기는 누구나. 좋아요·댓글·신고는 로그인 화면으로 보낸다.
  const { loggedIn } = useOptionalAuth();

  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moderating, setModerating] = useState<ModerationTarget | null>(null);
  // 글이 도착한 순간의 시각. 줄마다 Date.now()를 부르면 프리렌더와 어긋난다.
  const [now, setNow] = useState<number | null>(null);

  const loadComments = useCallback(
    async (signal?: AbortSignal) => {
      if (!postId) return;
      const page = await getComments(postId, { signal });
      setComments(page.comments);
      setCursor(page.next_cursor);
    },
    [postId],
  );

  useEffect(() => {
    if (!postId) return;
    const controller = new AbortController();
    getPost(postId, { signal: controller.signal })
      .then((data) => {
        setNow(Date.now());
        setPost(data);
        // 익명으로 올린 내 글이면 댓글도 익명이 기본이다. 여기서 이름을 걸면
        // 위의 익명 글이 곧 나라는 걸 스스로 알리는 셈이 된다.
        if (data.anonymous && data.mine) setCommentAnonymous(true);
        return loadComments(controller.signal);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "글을 찾을 수 없어요."));
      });
    return () => controller.abort();
  }, [postId, loadComments]);

  /** 로그인이 필요한 동작을 눌렀을 때. 돌아올 자리를 들고 로그인으로 보낸다. */
  function askToLogIn(): boolean {
    if (loggedIn) return false;
    const back = `/community/post?id=${postId ?? ""}`;
    router.push(`/login?next=${encodeURIComponent(back)}`);
    return true;
  }

  async function toggleLike() {
    if (askToLogIn()) return;
    if (!post || busy) return;
    setBusy(true);
    try {
      const result = post.liked_by_me
        ? await unlikePost(post.id)
        : await likePost(post.id);
      setPost({
        ...post,
        like_count: result.like_count,
        liked_by_me: result.liked_by_me,
      });
    } catch (cause) {
      setError(errorMessage(cause, "잠시 뒤에 다시 눌러주세요."));
    } finally {
      setBusy(false);
    }
  }

  async function removePost() {
    if (!post) return;
    setBusy(true);
    try {
      await deletePost(post.id);
      router.replace("/community");
    } catch (cause) {
      setError(errorMessage(cause, "글을 지우지 못했어요."));
      setBusy(false);
    }
  }

  async function submitComment() {
    if (askToLogIn()) return;
    if (!post || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const created = await createComment(post.id, draft.trim(), commentAnonymous);
      setComments((previous) => [...previous, created]);
      setPost({ ...post, comment_count: post.comment_count + 1 });
      setDraft("");
    } catch (cause) {
      setError(errorMessage(cause, "댓글을 남기지 못했어요."));
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    setBusy(true);
    try {
      await deleteComment(commentId);
      setComments((previous) => previous.filter((item) => item.id !== commentId));
      if (post) setPost({ ...post, comment_count: Math.max(0, post.comment_count - 1) });
    } catch (cause) {
      setError(errorMessage(cause, "댓글을 지우지 못했어요."));
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreComments() {
    if (!postId || !cursor) return;
    const page = await getComments(postId, { cursor });
    setComments((previous) => [...previous, ...page.comments]);
    setCursor(page.next_cursor);
  }

  if (!postId) {
    return (
      <CommunityShell title="커뮤니티" back={{ href: "/community", label: "커뮤니티" }}>
        <Notice tone="error">어떤 글인지 알 수 없어요.</Notice>
      </CommunityShell>
    );
  }

  return (
    <CommunityShell title="" back={{ href: "/community", label: "커뮤니티" }}>
      {error && <Notice tone="error">{error}</Notice>}
      {!post && !error && <Notice tone="muted">불러오는 중이에요…</Notice>}

      {post && (
        <>
          <article className="mt-2 rounded-3xl bg-white px-6 py-6">
            <p className="text-[12px] font-black text-[#3182f6]">
              {post.category_name}
            </p>
            <div className="mt-2 flex items-start justify-between gap-3">
              <h2 className="text-[22px] font-black leading-8 tracking-[-0.02em] text-[#191f28]">
                {post.title}
              </h2>
              <ItemMenu
                mine={post.mine}
                onEdit={() => router.push(`/community/new?id=${post.id}`)}
                onDelete={removePost}
                onReport={() =>
                  !askToLogIn() &&
                  setModerating({
                    type: "post",
                    id: post.id,
                    authorId: canBlock(post.author) ? post.author.id : null,
                    authorName: authorName(post.author),
                  })
                }
              />
            </div>
            <PostMeta post={post} now={now} />
            <p className="mt-5 whitespace-pre-wrap text-[15px] font-semibold leading-7 text-[#191f28]">
              {post.body}
            </p>
            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLike}
                disabled={busy}
                className={`rounded-2xl px-4 py-2 text-[13px] font-black transition ${
                  post.liked_by_me
                    ? "bg-[#3182f6] text-white"
                    : "bg-[#f2f4f6] text-[#4e5968]"
                }`}
              >
                좋아요 {post.like_count}
              </button>
              <span className="text-[13px] font-bold text-[#8b95a1]">
                댓글 {post.comment_count}
              </span>
            </div>
          </article>

          <section className="mt-4 rounded-3xl bg-white px-6 py-5">
            <h3 className="text-[13px] font-black text-[#8b95a1]">댓글</h3>
            {comments.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#8b95a1]">
                첫 댓글을 남겨보세요.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[#f2f4f6]">
                {comments.map((comment) => (
                  <li key={comment.id} className="py-4">
                    <CommentRow
                      comment={comment}
                      now={now}
                      onDelete={() => removeComment(comment.id)}
                      onEdit={async (body) => {
                        const updated = await updateComment(comment.id, body);
                        setComments((previous) =>
                          previous.map((item) =>
                            item.id === updated.id ? updated : item,
                          ),
                        );
                      }}
                      onReport={() =>
                        !askToLogIn() &&
                        setModerating({
                          type: "comment",
                          id: comment.id,
                          authorId: canBlock(comment.author)
                            ? comment.author.id
                            : null,
                          authorName: authorName(comment.author),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            {cursor && (
              <div className="mt-3">
                <QuietButton onClick={loadMoreComments}>댓글 더 보기</QuietButton>
              </div>
            )}

            <div className="mt-5">
              {loggedIn && (
                <div className="mb-2">
                  <AnonymousToggle
                    checked={commentAnonymous}
                    onChange={setCommentAnonymous}
                  />
                </div>
              )}
              <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={COMMENT_MAX}
                rows={2}
                placeholder={loggedIn ? "댓글을 남겨주세요" : "로그인하면 댓글을 남길 수 있어요"}
                className="min-w-0 flex-1 resize-none rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm font-semibold text-[#191f28] outline-none placeholder:text-[#8b95a1]"
              />
              <PrimaryButton onClick={submitComment} disabled={busy || !draft.trim()}>
                남기기
              </PrimaryButton>
              </div>
            </div>
          </section>
        </>
      )}

      {moderating && (
        <ModerationDialog
          target={moderating}
          onClose={() => setModerating(null)}
          onBlocked={() => {
            setModerating(null);
            router.replace("/community");
          }}
        />
      )}
    </CommunityShell>
  );
}

function PostMeta({ post, now }: { post: CommunityPost; now: number | null }) {
  const when = relativeTime(post.created_at, now);
  return (
    <p className="mt-2 text-[12px] font-bold text-[#8b95a1]">
      {authorName(post.author)} · {when} · 조회 {post.view_count}
    </p>
  );
}

function CommentRow({
  comment,
  now,
  onDelete,
  onEdit,
  onReport,
}: {
  comment: CommunityComment;
  now: number | null;
  onDelete: () => void;
  onEdit: (body: string) => Promise<void>;
  onReport: () => void;
}) {
  const when = relativeTime(comment.created_at, now);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await onEdit(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-bold text-[#8b95a1]">
          {authorName(comment.author)} · {when}
        </p>
        <ItemMenu
          mine={comment.mine}
          onEdit={() => setEditing(true)}
          onDelete={onDelete}
          onReport={onReport}
        />
      </div>
      {editing ? (
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={COMMENT_MAX}
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm font-semibold text-[#191f28] outline-none"
          />
          <PrimaryButton onClick={save} disabled={saving}>
            고쳤어요
          </PrimaryButton>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#191f28]">
          {comment.body}
        </p>
      )}
    </div>
  );
}
