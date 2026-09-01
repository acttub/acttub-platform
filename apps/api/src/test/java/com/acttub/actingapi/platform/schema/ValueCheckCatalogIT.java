package com.acttub.actingapi.platform.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * <b>Java enum 의 값 목록과 DB CHECK 의 값 목록이 정확히 같은지 본다.</b>
 *
 * <p>컬럼이 네이티브 Postgres enum 이던 시절에는 {@code PgEnumCatalogVerifier} 가 기동할 때
 * {@code pg_enum} 카탈로그와 Java 쪽 맵을 통째로 {@code equals} 로 대조했고, 어긋나면 앱이 아예
 * 뜨지 못했다. SOMA-462 에서 enum 타입이 사라지면서 그 검증기도 은퇴했는데, <b>검증기가 막던
 * 드리프트는 남는다</b> — 값 목록이 이제 CHECK 제약과 Java enum 두 곳에 따로 있기 때문이다.
 *
 * <p>🔥 <b>드리프트는 기동도 컴파일도 잡지 못한다.</b> Java 에만 값을 더하면 그 값을 처음 쓰는
 * 요청이 CHECK 위반으로 500 이 되고, CHECK 에만 더하면 그 행을 읽을 때
 * {@link PgEnumConverter#convertToEntityAttribute} 가 던진다. 둘 다 <b>운영에서</b> 터진다.
 * 이 테스트가 그 자리를 대신한다.
 *
 * <p>대조는 양방향이다 — 표에 적힌 제약이 DB 에 있고 값이 같은지, 그리고 DB 의 값 CHECK 중
 * 표에도 {@link #WITHOUT_JAVA_ENUM} 에도 없는 것이 생기지 않았는지. 뒤쪽이 없으면 새 CHECK 를
 * 표에 안 적어도 조용히 통과한다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class ValueCheckCatalogIT {

    /** 제약 이름 → 그 값 목록을 들고 있는 Java enum. */
    private static final Map<String, Class<? extends PgEnum>> BY_CONSTRAINT = new LinkedHashMap<>();

    static {
        BY_CONSTRAINT.put("ck_actor_memory_entries_field", ActorMemoryField.class);
        BY_CONSTRAINT.put("ck_actor_memory_entries_written_by", ActorMemoryAuthor.class);
        BY_CONSTRAINT.put("ck_anomalies_intent_impact", IntentImpact.class);
        BY_CONSTRAINT.put("ck_anomalies_severity", Severity.class);
        BY_CONSTRAINT.put("ck_coach_sessions_status", SessionStatus.class);
        BY_CONSTRAINT.put("ck_coach_sessions_close_reason", CloseReason.class);
        BY_CONSTRAINT.put("ck_coach_turns_role", TurnRole.class);
        BY_CONSTRAINT.put("ck_community_comments_status", ContentStatus.class);
        BY_CONSTRAINT.put("ck_community_posts_status", ContentStatus.class);
        BY_CONSTRAINT.put("ck_community_reports_target_type", ReportTargetType.class);
        BY_CONSTRAINT.put("ck_community_reports_reason", ReportReason.class);
        BY_CONSTRAINT.put("ck_community_reports_status", ReportStatus.class);
        BY_CONSTRAINT.put("ck_consent_documents_type", ConsentType.class);
        BY_CONSTRAINT.put("ck_external_operations_kind", OperationKind.class);
        BY_CONSTRAINT.put("ck_external_operations_status", OperationStatus.class);
        BY_CONSTRAINT.put("ck_practice_sessions_status", PracticeStatus.class);
        BY_CONSTRAINT.put("ck_upload_intents_status", UploadStatus.class);
        BY_CONSTRAINT.put("ck_user_consents_action", ConsentAction.class);
        BY_CONSTRAINT.put("ck_user_identities_provider", IdentityProvider.class);
        BY_CONSTRAINT.put("ck_users_status", UserStatus.class);
    }

    /**
     * 값 CHECK 이지만 대응하는 Java enum 이 <b>없는</b> 것들. 여기 적힌 것만 표 밖에 있을 수 있다.
     *
     * <p>{@code ck_users_role} 은 읽는 코드가 아직 없어서(SOMA-462), 나머지 셋은 enum 을 쓴 적이
     * 없이 처음부터 text + CHECK 였다.
     */
    private static final Set<String> WITHOUT_JAVA_ENUM = Set.of(
            "ck_users_role",
            "ck_practice_reports_report_type",
            "ck_coaching_handoffs_branch_kind",
            "ck_practice_sessions_blockage_branch");

    /** {@code CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))} 에서 값만 뽑는다. */
    private static final Pattern LITERAL = Pattern.compile("'((?:[^']|'')*)'::text");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("value_check");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("값 CHECK 스무 개가 각각 자기 Java enum 과 같은 값 목록을 갖는다")
    void everyValueCheckHasExactlyTheValuesOfItsJavaEnum() {
        Map<String, Set<String>> actual = valueChecks();

        BY_CONSTRAINT.forEach((constraint, type) -> {
            assertThat(actual)
                    .as("%s 가 DB 에 없다 — 마이그레이션이 빠졌거나 제약 이름이 바뀌었다", constraint)
                    .containsKey(constraint);
            Set<String> expected = new LinkedHashSet<>(Arrays.stream(type.getEnumConstants())
                    .map(PgEnum::dbValue).toList());
            assertThat(actual.get(constraint))
                    .as("%s ↔ %s — 한쪽만 고치면 운영에서만 터진다", constraint, type.getSimpleName())
                    .isEqualTo(expected);
        });
    }

    @Test
    @DisplayName("표에 없는 값 CHECK 가 새로 생기면 잡는다")
    void newValueChecksMustBeAddedToTheTable() {
        assertThat(valueChecks().keySet())
                .as("값 CHECK 를 더했으면 BY_CONSTRAINT 나 WITHOUT_JAVA_ENUM 에도 적으세요")
                .isSubsetOf(union(BY_CONSTRAINT.keySet(), WITHOUT_JAVA_ENUM));
    }

    /** {@code = ANY (ARRAY[…])} 형태의 CHECK 만. 길이·공백 검사 같은 다른 CHECK 는 대상이 아니다. */
    private Map<String, Set<String>> valueChecks() {
        Map<String, Set<String>> found = new LinkedHashMap<>();
        jdbc.query("""
                SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                WHERE ns.nspname = current_schema() AND con.contype = 'c'
                ORDER BY con.conname
                """, result -> {
            String definition = result.getString("definition");
            if (!definition.contains("= ANY (ARRAY[")) {
                return;
            }
            Set<String> values = new LinkedHashSet<>();
            Matcher matcher = LITERAL.matcher(definition);
            while (matcher.find()) {
                values.add(matcher.group(1).replace("''", "'"));
            }
            found.put(result.getString("conname"), values);
        });
        return found;
    }

    private static Set<String> union(Set<String> left, Set<String> right) {
        Set<String> both = new LinkedHashSet<>(left);
        both.addAll(right);
        return both;
    }

    /** 목록 두 개가 실물과 어긋나지 않게, 이 테스트 자신도 대상이 비지 않았는지 본다. */
    @Test
    @DisplayName("대조할 CHECK 가 실제로 있다 — 질의가 0건이면 위 둘이 조용히 통과한다")
    void theQueryActuallyFindsSomething() {
        List<String> names = List.copyOf(valueChecks().keySet());
        assertThat(names).hasSameSizeAs(union(BY_CONSTRAINT.keySet(), WITHOUT_JAVA_ENUM));
    }
}
