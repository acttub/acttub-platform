package com.acttub.actingapi.community.adapter.db;

import java.util.Map;
import java.util.UUID;

/** 커뮤니티 글·댓글 조회가 공유하는 차단 가시성 조건. */
final class CommunityVisibilitySpecification {
    private CommunityVisibilitySpecification() {
    }

    static Fragment notBlocked(String contentAlias, UUID viewerId) {
        if (viewerId == null) {
            return new Fragment("TRUE", Map.of());
        }
        return new Fragment("""
                (%1$s.anonymous = TRUE OR NOT EXISTS (
                    SELECT 1
                    FROM community_blocks community_visibility_block
                    WHERE community_visibility_block.blocker_id = :viewerId
                      AND community_visibility_block.blocked_id = %1$s.author_id
                ))
                """.formatted(contentAlias).strip(), Map.of("viewerId", viewerId));
    }

    record Fragment(String sql, Map<String, ?> parameters) {
    }
}
