package com.acttub.actingapi.feature.report.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.report.app.ReportDetail;
import com.acttub.actingapi.feature.report.app.ReportRepository;
import com.acttub.actingapi.feature.report.app.ReportSummary;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/** 성적표 조회 포트를 별칭 기반 native projection으로 구현한다. */
@Repository
public class PostgresReportRepository implements ReportRepository {
    private final EntityManager entityManager;
    private final ObjectMapper mapper;

    PostgresReportRepository(EntityManager entityManager, ObjectMapper mapper) {
        this.entityManager = entityManager;
        this.mapper = mapper;
    }

    @Override
    public List<ReportSummary> listSummaries(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT
                    report.practice_session_id,
                    report.report_type AS report_type,
                    COALESCE(report.report_json ->> 'title', '') AS title,
                    report.created_at
                FROM practice_reports AS report
                JOIN practice_sessions AS practice
                  ON practice.id = report.practice_session_id
                WHERE practice.user_id = :userId
                  AND practice.hidden_at IS NULL
                ORDER BY report.created_at, report.id
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> new ReportSummary(
                        row.get("practice_session_id", UUID.class),
                        row.get("report_type", String.class),
                        row.get("title", String.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC)))
                .toList();
    }

    @Override
    public ReportDetail findDetail(UUID userId, UUID practiceSessionId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT
                    report.practice_session_id,
                    report.created_at,
                    report.report_json::text AS report_json,
                    upload.object_key
                FROM practice_reports AS report
                JOIN practice_sessions AS practice
                  ON practice.id = report.practice_session_id
                JOIN upload_intents AS upload
                  ON upload.id = practice.upload_intent_id
                WHERE practice.user_id = :userId
                  AND practice.id = :practiceSessionId
                  AND practice.hidden_at IS NULL
                ORDER BY report.created_at DESC, report.id DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("practiceSessionId", practiceSessionId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new ReportDetail(
                row.get("practice_session_id", UUID.class),
                row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                parseJson(row.get("report_json", String.class)),
                row.get("object_key", String.class));
    }

    private JsonNode parseJson(String value) {
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("practice report contains invalid JSON", exception);
        }
    }
}
