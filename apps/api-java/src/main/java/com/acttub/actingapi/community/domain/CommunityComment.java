package com.acttub.actingapi.community.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 커뮤니티 댓글 하나.
 *
 * <p>{@code status} 를 열거형이 아니라 문자열로 들고 있는 이유는 {@code CommunityPost} 와 같다 —
 * 이 값은 {@code content_status_t} 의 이름 그대로이고, 열거형으로 바꾸면 이름을 다시 문자열로
 * 되돌리는 지점이 생긴다.
 *
 * <p>{@code alias} 는 <b>조회 직후에는 비어 있다.</b> 익명 댓글의 표시 이름은 그 댓글만 봐서는
 * 정해지지 않고 글쓴이가 누구인지·그 글에서 몇 번째 익명인지를 함께 알아야 하므로,
 * {@link #named} 로 나중에 채운다.
 */
public record CommunityComment(
        UUID id,
        UUID postId,
        UUID authorId,
        boolean anonymous,
        String authorNickname,
        String body,
        boolean mine,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        String status,
        String alias) {

    private static final String VISIBLE = "visible";
    private static final String DELETED = "deleted";

    /** 상태를 아직 읽지 않은 조회용. 보이는 것만 고른 질의가 쓴다. */
    public static CommunityComment visible(
            UUID id,
            UUID postId,
            UUID authorId,
            boolean anonymous,
            String authorNickname,
            String body,
            boolean mine,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
        return new CommunityComment(
                id, postId, authorId, anonymous, authorNickname, body, mine,
                createdAt, updatedAt, VISIBLE, null);
    }

    public boolean isVisible() {
        return VISIBLE.equals(status);
    }

    public boolean isDeleted() {
        return DELETED.equals(status);
    }

    public CommunityComment withStatus(String value) {
        return new CommunityComment(
                id, postId, authorId, anonymous, authorNickname, body, mine,
                createdAt, updatedAt, value, alias);
    }

    /**
     * 익명 댓글에 이 글 안에서의 표시 이름을 붙인다. 실명 댓글은 그대로 둔다 — 이름은 작성자
     * 닉네임이 지고, {@code alias} 는 비어야 응답에서 {@code null} 로 나간다.
     *
     * <p>익명 글의 글쓴이가 자기 글에 단 익명 댓글만 '글쓴이' 다. 나머지는 그 글에서 받은 번호를
     * 쓰고, 번호가 아직 없으면 번호 없는 '익명' 이다.
     *
     * @param ordinal 이 글에서 이 사람이 받은 익명 번호. 없으면 {@code null}
     */
    public CommunityComment named(CommunityPost post, Integer ordinal) {
        if (!anonymous) {
            return this;
        }
        if (post.writtenAnonymouslyBy(authorId)) {
            return withAlias("글쓴이");
        }
        return withAlias(ordinal == null ? "익명" : "익명" + ordinal);
    }

    private CommunityComment withAlias(String value) {
        return new CommunityComment(
                id, postId, authorId, anonymous, authorNickname, body, mine,
                createdAt, updatedAt, status, value);
    }
}
