"use client";

// 글쓰기와 글 고치기. 두 화면이 거의 같아서 하나로 둔다.
// `postId`가 있으면 고치기 — 카테고리는 못 바꾼다(옮기기는 별개 기능이다).

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  createPost,
  getCategories,
  getPost,
  updatePost,
  type CommunityCategory,
} from "@/lib/api/v2/community";
import { useRequireAuth } from "@/features/auth/use-require-auth";
import { CommunityShell, Notice, PrimaryButton, errorMessage } from "./shell";

const TITLE_MAX = 100;
const BODY_MAX = 5000;

/**
 * `?id=`가 있으면 고치기, 없으면 새 글.
 *
 * 정적 export에서 useSearchParams는 Suspense 안에서만 쓸 수 있다. 라우트 파일은
 * metadata를 내보내야 해서 서버 컴포넌트로 두고, 경계를 여기서 친다.
 */
export function PostComposerRoute() {
  return (
    <Suspense fallback={null}>
      <ComposerWithParams />
    </Suspense>
  );
}

function ComposerWithParams() {
  const id = useSearchParams().get("id");
  return <PostComposer postId={id ?? undefined} />;
}

export function PostComposer({ postId }: { postId?: string }) {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const editing = Boolean(postId);

  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || editing) return;
    const controller = new AbortController();
    getCategories({ signal: controller.signal })
      .then((items) => {
        setCategories(items);
        setSlug((current) => current || items[0]?.slug || "");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "게시판을 불러오지 못했어요."));
      });
    return () => controller.abort();
  }, [ready, editing]);

  useEffect(() => {
    if (!ready || !postId) return;
    const controller = new AbortController();
    getPost(postId, { signal: controller.signal })
      .then((post) => {
        setTitle(post.title);
        setBody(post.body);
        setSlug(post.category_slug);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "글을 찾을 수 없어요."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ready, postId]);

  const canSubmit =
    !saving && title.trim().length > 0 && body.trim().length > 0 && (editing || slug);

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const post = postId
        ? await updatePost(postId, { title: title.trim(), body: body.trim() })
        : await createPost({
            categorySlug: slug,
            title: title.trim(),
            body: body.trim(),
          });
      router.replace(`/community/post?id=${post.id}`);
    } catch (cause) {
      setError(errorMessage(cause, "글을 저장하지 못했어요."));
      setSaving(false);
    }
  }

  if (!ready) return null;

  return (
    <CommunityShell
      title={editing ? "글 고치기" : "글쓰기"}
      back={{
        href: postId ? `/community/post?id=${postId}` : "/community",
        label: editing ? "글로 돌아가기" : "커뮤니티",
      }}
    >
      {loading ? (
        <Notice tone="muted">불러오는 중이에요…</Notice>
      ) : (
        <div className="mt-6 space-y-3">
          {!editing && categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  onClick={() => setSlug(category.slug)}
                  className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-black transition ${
                    slug === category.slug
                      ? "bg-[#191f28] text-white"
                      : "bg-white text-[#8b95a1]"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={TITLE_MAX}
            placeholder="제목"
            className="w-full rounded-2xl bg-white px-5 py-4 text-[17px] font-black text-[#191f28] outline-none placeholder:text-[#c6d3e3]"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={BODY_MAX}
            rows={14}
            placeholder="무슨 이야기인가요?"
            className="w-full resize-none rounded-2xl bg-white px-5 py-4 text-[15px] font-semibold leading-7 text-[#191f28] outline-none placeholder:text-[#c6d3e3]"
          />
          <p className="text-right text-[12px] font-bold text-[#8b95a1]">
            {body.length} / {BODY_MAX}
          </p>

          {error && <p className="text-sm font-bold text-[#e5484d]">{error}</p>}

          <div className="flex justify-end">
            <PrimaryButton onClick={submit} disabled={!canSubmit}>
              {saving ? "올리는 중이에요…" : editing ? "고쳤어요" : "올리기"}
            </PrimaryButton>
          </div>
        </div>
      )}
    </CommunityShell>
  );
}
