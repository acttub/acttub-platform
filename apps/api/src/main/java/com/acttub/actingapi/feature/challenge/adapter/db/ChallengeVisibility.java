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
    static final String UNBLOCKED = unblocked("e.user_id");

    /** 보는 사람과 그 사람 사이에 어느 쪽으로도 차단이 없다. */
    static String unblocked(String person) {
        return """
            NOT EXISTS (SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id=CAST(:viewer AS uuid) AND b.blocked_id=%1$s)
                 OR (b.blocked_id=CAST(:viewer AS uuid) AND b.blocker_id=%1$s))
            """.formatted(person);
    }

    /** 댓글의 개인 노출 조건 중 댓글 쪽(부모 참여작이 보이는지는 따로 본다). 본인 숨김 댓글은 본인에게만 보인다. */
    static final String VISIBLE_COMMENT = """
            cm.deleted_at IS NULL AND (cm.status='visible' OR cm.user_id=CAST(:viewer AS uuid)) AND %s
            """.formatted(unblocked("cm.user_id"));
}
