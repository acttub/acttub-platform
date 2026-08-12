package com.acttub.actingapi.domain;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 기동할 때 Java의 17개 enum과 실제 {@code pg_enum} 라벨/순서를 대조한다. */
@Component
public class PgEnumCatalogVerifier implements ApplicationRunner {
    private static final Map<String, Class<? extends PgEnum>> TYPES = new LinkedHashMap<>();
    static {
        TYPES.put("user_status_t", UserStatus.class);
        TYPES.put("identity_provider_t", IdentityProvider.class);
        TYPES.put("consent_type_t", ConsentType.class);
        TYPES.put("consent_action_t", ConsentAction.class);
        TYPES.put("upload_status_t", UploadStatus.class);
        TYPES.put("practice_status_t", PracticeStatus.class);
        TYPES.put("intent_impact_t", IntentImpact.class);
        TYPES.put("severity_t", Severity.class);
        TYPES.put("session_status_t", SessionStatus.class);
        TYPES.put("close_reason_t", CloseReason.class);
        TYPES.put("turn_role_t", TurnRole.class);
        TYPES.put("operation_kind_t", OperationKind.class);
        TYPES.put("operation_status_t", OperationStatus.class);
        TYPES.put("content_status_t", ContentStatus.class);
        TYPES.put("report_target_type_t", ReportTargetType.class);
        TYPES.put("report_reason_t", ReportReason.class);
        TYPES.put("report_status_t", ReportStatus.class);
    }

    private final JdbcTemplate jdbc;
    public PgEnumCatalogVerifier(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override
    public void run(ApplicationArguments args) {
        Map<String, List<String>> actual = new LinkedHashMap<>();
        // 스키마를 'public' 으로 박으면 contract 프로파일(harness_target)에서 **엉뚱한
        // 스키마를 검증한다.** 운영에서는 둘이 같아 눈에 띄지 않다가, 하네스 DB 처럼
        // public 만 낡은 환경에서 기동이 죽는다(실제로 그렇게 죽었다).
        // current_schema() 는 Hikari 가 설정한 스키마를 그대로 돌려준다.
        jdbc.query("""
                SELECT t.typname, e.enumlabel
                FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
                JOIN pg_namespace n ON n.oid=t.typnamespace
                WHERE n.nspname=current_schema()
                ORDER BY t.typname,e.enumsortorder
                """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> actual.computeIfAbsent(rs.getString(1), ignored -> new java.util.ArrayList<>())
                        .add(rs.getString(2)));
        verify(actual);
    }

    static void verify(Map<String, List<String>> actual) {
        Map<String, List<String>> expected = new LinkedHashMap<>();
        TYPES.forEach((name, type) -> expected.put(name,
                Arrays.stream(type.getEnumConstants()).map(PgEnum::dbValue).toList()));
        if (!expected.equals(actual)) {
            throw new IllegalStateException("Postgres enum drift: expected=" + expected + ", actual=" + actual);
        }
    }

    public static int typeCount() { return TYPES.size(); }
}
