package com.acttub.actingapi.feature.community.adapter.db;

import java.util.Map;
import java.util.UUID;

/**
 * 커뮤니티 글·댓글 조회가 공유하는 차단 가시성 조건.
 *
 * <p>차단은 사람 단위 {@code user_blocks} 를 챌린지와 함께 쓴다(docs/specs/community). 챌린지와 같이 <b>어느 쪽으로든</b>
 * 차단이 있으면 서로의 글·댓글이 보이지 않는다. 0.1.0 전에 쌓인 {@code community_blocks} 는 옮기지 않고 그대로 읽어
 * 차단한 사람 쪽에서만 가린다(그때의 뜻이 그랬다).
 *
 * <p>익명 글·댓글은 차단으로 가리지 않는다(내리기 전 규칙). 차단하고 나서 사라지는 익명 글을 보면 누가 썼는지
 * 알 수 있기 때문이다. 앱은 지금 익명으로 쓰지 않으므로 옛 익명 행에만 해당한다.
 */
final class CommunityVisibilitySpecification {
    private CommunityVisibilitySpecification() {
    }

    static Fragment notBlocked(String contentAlias, UUID viewerId) {
        if (viewerId == null) {
            return new Fragment("TRUE", Map.of());
        }
        return new Fragment("""
                (%1$s.anonymous = TRUE OR (NOT EXISTS (
                    SELECT 1
                    FROM user_blocks community_visibility_block
                    WHERE (community_visibility_block.blocker_id = CAST(:viewerId AS uuid)
                           AND community_visibility_block.blocked_id = %1$s.author_id)
                       OR (community_visibility_block.blocked_id = CAST(:viewerId AS uuid)
                           AND community_visibility_block.blocker_id = %1$s.author_id)
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM community_blocks community_legacy_block
                    WHERE community_legacy_block.blocker_id = CAST(:viewerId AS uuid)
                      AND community_legacy_block.blocked_id = %1$s.author_id
                )))
                """.formatted(contentAlias).strip(), Map.of("viewerId", viewerId));
    }

    record Fragment(String sql, Map<String, ?> parameters) {
    }
}
