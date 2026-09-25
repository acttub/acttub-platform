package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.LegacyPracticeReader;
import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.JobView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PreviousConversation;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 옛 연습 테이블을 새 응답 모양으로 읽는 <b>호환 경로</b> (02-practice ②).
 *
 * <p>같은 포트를 두 번 구현하는 대신 <b>따로 선 어댑터</b>다 — 두 구현이 같은 타입이면 주입이 모호해지고,
 * "새 표를 먼저 보고 없으면 옛 표" 라는 순서를 어디선가 한 번은 적어야 한다. 그 순서는
 * {@code PracticeService} 가 갖는다.
 *
 * <p><b>읽기 전용이다.</b> 여기서 옛 테이블을 고치거나 지우지 않는다. 전환 명령이 옮기지 않기로 한 자료도 이
 * 경로로 계속 보인다.
 *
 * <p>차수는 {@code continued_from} 체인을 그때그때 펴서 만든다 — 옛 표에는 묶음도 차수도 없다. 전환 명령과
 * <b>같은 규칙</b>이고, 그래서 옮기기 전과 옮긴 뒤의 응답이 같다.
 */
@Repository
class PostgresLegacyPracticeReader implements LegacyPracticeReader {

    /** 전환 명령의 {@code CHAIN} 과 같은 규칙이다 — 옮기기 전후의 차수·진행이 갈리면 안 된다. */
    private static final String CHAIN = """
            WITH RECURSIVE chain(id, root_id, ordinal) AS (
                SELECT ps.id, ps.id, 1
                FROM practice_sessions ps
                WHERE ps.continued_from IS NULL
                UNION ALL
                SELECT child.id, chain.root_id, chain.ordinal + 1
                FROM practice_sessions child
                JOIN chain ON child.continued_from = chain.id
                WHERE chain.ordinal < 100
            ),
            legacy AS (
                SELECT c.id, c.root_id, c.ordinal, ps.user_id, ps.hidden_at, ps.created_at,
                       ps.situation, ps.character_context, ps.goal,
                       ps.blockage_kind, ps.sub_branch, ps.blockage_detail, ps.experience_version,
                       ui.video_id,
                       CASE
                         WHEN ps.status::text = 'failed' THEN 'closed'
                         WHEN ps.status::text IN ('created','analyzing') THEN 'analyzing'
                         WHEN EXISTS (SELECT 1 FROM practice_sessions nxt WHERE nxt.continued_from = ps.id)
                              THEN 'closed'
                         WHEN EXISTS (SELECT 1 FROM coach_sessions cs
                                      WHERE cs.practice_session_id = ps.id AND cs.status::text = 'open')
                              THEN 'conversing'
                         WHEN EXISTS (SELECT 1 FROM coach_sessions cs
                                      WHERE cs.practice_session_id = ps.id AND cs.status::text = 'closed')
                              THEN 'closed'
                         ELSE 'conversing'
                       END AS stage,
                       CASE WHEN ps.status::text = 'failed' THEN 'analysis_failed' END AS close_reason
                FROM chain c
                JOIN practice_sessions ps ON ps.id = c.id
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                -- 이미 옮긴 회차는 새 표가 답한다. 두 번 보이지 않게 여기서 뺀다.
                WHERE NOT EXISTS (SELECT 1 FROM practices p WHERE p.id = ps.id)
            )
            """;

    /**
     * 옛 자료에서 읽어 오는 칸들.
     *
     * <p><b>구형 관찰은 요약만이다</b> — 기록의 상태(못 본 구간이 있으면 {@code partial})까지가 새 모양에 담기는
     * 전부다. 대화는 가장 최근 것이 "대화" 이고 나머지는 이전 대화 목록으로 간다.
     */
    private static final String COLUMNS = """
            SELECT l.id,l.root_id,l.ordinal,l.video_id,l.stage,l.close_reason,l.experience_version,
                   l.situation,l.character_context,l.goal,
                   l.blockage_kind,l.sub_branch,l.blockage_detail,l.created_at,
                   (SELECT CASE WHEN jsonb_array_length(COALESCE(
                                     CASE WHEN jsonb_typeof(s.uncertainties_json)='array'
                                          THEN s.uncertainties_json END,'[]'::jsonb)) > 0
                                THEN 'partial' ELSE 'ready' END
                    FROM summaries s WHERE s.session_id=l.id
                    ORDER BY s.created_at DESC LIMIT 1) AS analysis_status,
                   cs.id AS conversation_id,cs.status AS conversation_status,
                   (SELECT count(*) FROM coach_turns t WHERE t.session_id=cs.id) AS conversation_count,
                   r.id AS note_id,r.title AS note_title,r.report_type AS note_kind,
                   j.id AS job_id,j.status AS job_status,j.error_code AS failure_reason,j.attempt_count
            FROM legacy l
            LEFT JOIN LATERAL (SELECT id,status::text AS status
                               FROM coach_sessions
                               WHERE practice_session_id=l.id
                               ORDER BY created_at DESC,id DESC
                               LIMIT 1) cs ON true
            LEFT JOIN LATERAL (SELECT id,
                                      CASE WHEN report_type='practice_note'
                                           THEN NULLIF(report_json->'copy'->>'title','')
                                           ELSE NULLIF(report_json->>'title','') END AS title,
                                      CASE WHEN report_type='practice_note'
                                           THEN COALESCE(NULLIF(report_json->>'mode',''),'record_only')
                                           ELSE report_type END AS report_type
                               FROM practice_reports
                               WHERE practice_session_id=l.id
                               ORDER BY created_at DESC,id DESC
                               LIMIT 1) r ON true
            LEFT JOIN LATERAL (SELECT id,status::text AS status,error_code,attempt_count
                               FROM external_operations
                               WHERE session_id=l.id AND kind::text='analyze'
                               ORDER BY (status::text IN ('pending','running')) DESC,created_at DESC,id DESC
                               LIMIT 1) j ON true
            """;

    private final EntityManager entityManager;

    PostgresLegacyPracticeReader(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public PracticeView find(UUID userId, UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(query(CHAIN + COLUMNS + """
                WHERE l.id=:practiceId AND l.user_id=:userId
                """)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : view(rows.getFirst(), previousConversations(userId, practiceId));
    }

    /**
     * 옛 개별 숨김은 그 회차만 뺀다 — 묶음을 숨기지 않는다(02-practice). 다 빠지면 묶음도 보이지 않는다.
     *
     * <p>옛 묶음에는 제목·태그·즐겨찾기가 없다. 그래서 {@code favorite} 필터에는 하나도 걸리지 않고 제목은
     * 비어 온다 — 화면이 상황 문장으로 채우는 그 자리다(practice.library).
     */
    @Override
    public List<GroupView> groups(UUID userId, String filter) {
        if ("favorite".equals(filter)) {
            return List.of();
        }
        String where = "WHERE l.user_id=:userId AND l.hidden_at IS NULL"
                + ("recent30".equals(filter) ? " AND l.created_at >= now() - interval '30 days'" : "");
        List<Tuple> rows = NativeTuples.list(query(CHAIN + COLUMNS + where + """
                 ORDER BY l.root_id, l.ordinal
                """)
                .setParameter("userId", userId));
        Map<UUID, List<PracticeView>> byRoot = new LinkedHashMap<>();
        for (Tuple row : rows) {
            byRoot.computeIfAbsent(row.get("root_id", UUID.class), key -> new ArrayList<>())
                    .add(view(row, List.of()));
        }
        List<GroupView> groups = new ArrayList<>();
        byRoot.forEach((rootId, practices) -> groups.add(new GroupView(
                rootId,
                null,
                practices.size(),
                practices.getLast().createdAt(),
                List.of(),
                false,
                null,
                practices.stream()
                        .filter(practice -> !"closed".equals(practice.stage()))
                        .map(PracticeView::id)
                        .findFirst()
                        .orElse(null),
                List.copyOf(practices))));
        return List.copyOf(groups);
    }

    @Override
    public List<PreviousConversation> previousConversations(UUID userId, UUID practiceId) {
        return NativeTuples.list(query("""
                SELECT cs.id,cs.status::text AS status,cs.created_at
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id=cs.practice_session_id
                WHERE cs.practice_session_id=:practiceId
                  AND ps.user_id=:userId
                  AND cs.id <> (SELECT newest.id FROM coach_sessions newest
                                WHERE newest.practice_session_id=:practiceId
                                ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1)
                ORDER BY cs.created_at DESC,cs.id DESC
                """)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)).stream()
                .map(row -> new PreviousConversation(
                        row.get("id", UUID.class),
                        row.get("status", String.class),
                        row.get("created_at", Instant.class)))
                .toList();
    }

    private Query query(String sql) {
        return entityManager.createNativeQuery(sql, Tuple.class);
    }

    private static PracticeView view(Tuple row, List<PreviousConversation> previous) {
        UUID jobId = row.get("job_id", UUID.class);
        return new PracticeView(
                row.get("id", UUID.class),
                row.get("root_id", UUID.class),
                ((Number) row.get("ordinal")).intValue(),
                row.get("video_id", UUID.class),
                row.get("stage", String.class),
                row.get("close_reason", String.class),
                row.get("experience_version", String.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("created_at", Instant.class),
                row.get("analysis_status", String.class),
                row.get("conversation_id", UUID.class),
                row.get("conversation_status", String.class),
                ((Number) row.get("conversation_count")).intValue(),
                row.get("note_id", UUID.class),
                row.get("note_title", String.class),
                row.get("note_kind", String.class),
                jobId == null
                        ? null
                        : new JobView(
                                jobId,
                                row.get("job_status", String.class),
                                row.get("failure_reason", String.class),
                                ((Number) row.get("attempt_count")).intValue()),
                previous);
    }
}
