package com.acttub.actingapi.report.adapter.db;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.report.app.ReportDetail;
import com.acttub.actingapi.report.app.ReportRepository;
import com.acttub.actingapi.report.app.ReportSummary;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 성적표 조회 포트를 손으로 쓴 SQL 로 구현한다. */
@Repository
public class PostgresReportRepository implements ReportRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    PostgresReportRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public List<ReportSummary> listSummaries(UUID userId) {
        return jdbc.query("""
                SELECT
                    report.practice_session_id,
                    report.report_type::text AS report_type,
                    COALESCE(report.report_json ->> 'title', '') AS title,
                    report.created_at
                FROM practice_reports AS report
                JOIN practice_sessions AS practice
                  ON practice.id = report.practice_session_id
                WHERE practice.user_id = ?
                  AND practice.hidden_at IS NULL
                ORDER BY report.created_at, report.id
                """, (result, rowNumber) -> new ReportSummary(
                result.getObject("practice_session_id", UUID.class),
                result.getString("report_type"),
                result.getString("title"),
                result.getObject("created_at", OffsetDateTime.class)), userId);
    }

    @Override
    public ReportDetail findDetail(UUID userId, UUID practiceSessionId) {
        List<ReportDetail> rows = jdbc.query("""
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
                WHERE practice.user_id = ?
                  AND practice.id = ?
                  AND practice.hidden_at IS NULL
                ORDER BY report.created_at DESC, report.id DESC
                LIMIT 1
                """, (result, rowNumber) -> new ReportDetail(
                result.getObject("practice_session_id", UUID.class),
                result.getObject("created_at", OffsetDateTime.class),
                parseJson(result.getString("report_json")),
                result.getString("object_key")), userId, practiceSessionId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private JsonNode parseJson(String value) {
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("practice report contains invalid JSON", exception);
        }
    }
}
