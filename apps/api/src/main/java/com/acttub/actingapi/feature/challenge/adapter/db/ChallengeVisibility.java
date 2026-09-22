package com.acttub.actingapi.feature.challenge.adapter.db;

/** 집계는 공개 조건, 이름·검색·피드는 여기에 양방향 차단 조건을 더한다. */
final class ChallengeVisibility {
    private ChallengeVisibility() { }
    static final String ENTRY_FROM = """
            FROM challenge_entries e
            JOIN challenges ec ON ec.id=e.challenge_id
            JOIN users eu ON eu.id=e.user_id
            JOIN videos v ON v.id=e.video_id AND v.user_id=e.user_id
            LEFT JOIN user_profiles ep ON ep.user_id=e.user_id
            """;
    static final String PUBLIC_ENTRY = """
            e.visibility='public' AND e.status='visible' AND eu.status='active' AND v.purged_at IS NULL
            AND ec.moderation='visible' AND ec.deleted_at IS NULL
            """;
    static final String UNBLOCKED = """
            NOT EXISTS (SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id=CAST(:viewer AS uuid) AND b.blocked_id=e.user_id)
                 OR (b.blocked_id=CAST(:viewer AS uuid) AND b.blocker_id=e.user_id))
            """;
}
