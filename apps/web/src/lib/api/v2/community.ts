import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type CommunityCategory = components["schemas"]["CategoryPayload"];
export type CommunityPost = components["schemas"]["PostPayload"];
export type CommunityComment = components["schemas"]["CommentPayload"];
export type CommunityAuthor = components["schemas"]["AuthorPayload"];
export type CommunityBlock = components["schemas"]["BlockPayload"];
export type ReportReason = components["schemas"]["ReportRequest"]["reason"];
export type ReportTargetType =
  components["schemas"]["ReportRequest"]["target_type"];

type PostListResponse = components["schemas"]["PostListResponse"];
type CommentListResponse = components["schemas"]["CommentListResponse"];
type CategoryListResponse = components["schemas"]["CategoryListResponse"];
type BlockListResponse = components["schemas"]["BlockListResponse"];
type LikeResponse = components["schemas"]["LikeResponse"];

/** 신고 사유. 값은 서버 enum과 같아야 한다. */
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "광고·도배" },
  { value: "abuse", label: "욕설·비방" },
  { value: "sexual", label: "선정적인 내용" },
  { value: "privacy", label: "개인정보 노출" },
  { value: "other", label: "그 밖의 문제" },
];

/** 닉네임을 아직 안 정한 계정이 있다. 빈 자리로 두지 않는다. */
export function authorName(author: CommunityAuthor): string {
  return author.nickname?.trim() || "이름 없는 배우";
}

type ListOptions = {
  category?: string | null;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

function listQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getCategories(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<CategoryListResponse>(
    "/v2/community/categories",
    { signal: options.signal },
  );
  return data.categories;
}

export async function getPosts(options: ListOptions = {}) {
  const { data } = await apiFetch<PostListResponse>(
    `/v2/community/posts${listQuery(options)}`,
    { signal: options.signal },
  );
  return data;
}

export async function getPost(postId: string, options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<CommunityPost>(
    `/v2/community/posts/${postId}`,
    { signal: options.signal },
  );
  return data;
}

export async function createPost(input: {
  categorySlug: string;
  title: string;
  body: string;
}) {
  const { data } = await apiFetch<CommunityPost>("/v2/community/posts", {
    method: "POST",
    body: {
      category_slug: input.categorySlug,
      title: input.title,
      body: input.body,
    },
  });
  return data;
}

export async function updatePost(
  postId: string,
  input: { title: string; body: string },
) {
  const { data } = await apiFetch<CommunityPost>(
    `/v2/community/posts/${postId}`,
    { method: "PATCH", body: input },
  );
  return data;
}

export async function deletePost(postId: string) {
  await apiFetch<void>(`/v2/community/posts/${postId}`, { method: "DELETE" });
}

export async function likePost(postId: string) {
  const { data } = await apiFetch<LikeResponse>(
    `/v2/community/posts/${postId}/likes`,
    { method: "POST" },
  );
  return data;
}

export async function unlikePost(postId: string) {
  const { data } = await apiFetch<LikeResponse>(
    `/v2/community/posts/${postId}/likes`,
    { method: "DELETE" },
  );
  return data;
}

export async function getComments(
  postId: string,
  options: { cursor?: string | null; signal?: AbortSignal } = {},
) {
  const { data } = await apiFetch<CommentListResponse>(
    `/v2/community/posts/${postId}/comments${listQuery({ cursor: options.cursor })}`,
    { signal: options.signal },
  );
  return data;
}

export async function createComment(postId: string, body: string) {
  const { data } = await apiFetch<CommunityComment>(
    `/v2/community/posts/${postId}/comments`,
    { method: "POST", body: { body } },
  );
  return data;
}

export async function updateComment(commentId: string, body: string) {
  const { data } = await apiFetch<CommunityComment>(
    `/v2/community/comments/${commentId}`,
    { method: "PATCH", body: { body } },
  );
  return data;
}

export async function deleteComment(commentId: string) {
  await apiFetch<void>(`/v2/community/comments/${commentId}`, {
    method: "DELETE",
  });
}

export async function reportContent(input: {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail?: string | null;
}) {
  await apiFetch<void>("/v2/community/reports", {
    method: "POST",
    body: {
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      detail: input.detail ?? null,
    },
  });
}

export async function getBlocks(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<BlockListResponse>("/v2/community/blocks", {
    signal: options.signal,
  });
  return data.blocks;
}

export async function blockUser(userId: string) {
  await apiFetch<void>("/v2/community/blocks", {
    method: "POST",
    body: { user_id: userId },
  });
}

export async function unblockUser(userId: string) {
  await apiFetch<void>(`/v2/community/blocks/${userId}`, { method: "DELETE" });
}
