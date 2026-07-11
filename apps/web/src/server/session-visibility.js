const isQueryLike = (value) => value && typeof value.eq === "function" && typeof value.is === "function";

export const applyOwnerSessionScope = (query, { sessionId, userId, visibility }) => {
  if (!isQueryLike(query)) throw new Error("invalid_query");
  const scoped = query.eq("id", sessionId).eq("user_id", userId);
  if (visibility === "public") return scoped.is("hidden_at", null).eq("deletion_status", "active");
  return scoped;
};
