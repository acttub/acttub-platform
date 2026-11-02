package com.acttub.actingapi.feature.community.domain;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 커뮤니티 글 하나. CONTEXT.md 가 말하는 Domain Model 이며 {@code community_posts} 행에 글쓴이·
 * 분류를 함께 실어 옮겨 담는다.
 *
 * <p>{@code authorNickname} 은 {@code user_profiles.name}(챌린지와 같은 공개 이름, 없으면 '배우')이다 —
 * 탈퇴한 사용자면 SQL 이 '탈퇴한 사용자' 로 바꿔 싣는다. {@code users.nickname} 은 보지 않는다. 그 판정을 여기로 올리지 않은 이유는 계정 상태가 이 도메인의 것이
 * 아니어서다.
 *
 * <p>{@code mine} 도 행의 값이 아니라 <b>보는 사람에 따라 달라지는 값</b>이다. 같은 글이라도
 * 조회자가 없으면 거짓이다.
 */
public record CommunityPost(
        UUID id,
        UUID authorId,
        boolean anonymous,
        String categorySlug,
        String categoryName,
        String authorNickname,
        String title,
        String body,
        int likeCount,
        int commentCount,
        int viewCount,
        boolean likedByMe,
        boolean mine,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        String status,
        List<PostImage> images) {

    public CommunityPost {
        images = images == null ? List.of() : List.copyOf(images);
    }

    /** 붙은 사진(보여 줄 순서)을 채운 같은 글. 사진은 글 행과 따로 한 번에 읽어 붙인다. */
    public CommunityPost withImages(List<PostImage> value) {
        return new CommunityPost(id, authorId, anonymous, categorySlug, categoryName, authorNickname, title, body,
                likeCount, commentCount, viewCount, likedByMe, mine, createdAt, updatedAt, status, value);
    }

    /** 본인 글이 신고·운영으로 가려진 상태. 남에게는 이 글이 아예 보이지 않는다. */
    public boolean hidden() {
        return "hidden".equals(status);
    }

    /**
     * 화면에 적을 작성자 이름. 익명 글은 "익명", 아니면 프로필의 공개 이름이다(탈퇴했으면 SQL 이
     * "탈퇴한 사용자"로 바꿔 싣는다).
     */
    public String authorName() {
        return anonymous ? "익명" : authorNickname;
    }

    /**
     * 이 조회가 조회수로 세어지는지. 자기 글을 여는 것은 세지 않는다.
     *
     * <p>세어지더라도 <b>지금 이 응답에는 반영되지 않는다</b> — 증가는 응답을 만든 뒤에 일어난다.
     * 순서가 계약이다(자세한 것은 {@code app/CommunityService.view}).
     */
    public boolean countsAsView() {
        return !mine;
    }

    /** 익명 글을 쓴 사람이 그 글에 다는 댓글인지. 그 사람만 '글쓴이' 로 표시된다. */
    public boolean writtenAnonymouslyBy(UUID userId) {
        return anonymous && authorId.equals(userId);
    }
}
