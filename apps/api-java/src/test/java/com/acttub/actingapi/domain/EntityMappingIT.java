package com.acttub.actingapi.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.hibernate.SessionFactory;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * 매핑 2종에 대한 검증 (M0-spike.md D-4·D-5).
 *
 * <p>여기서 확인하는 것:
 * <ul>
 *   <li>{@code ddl-auto: validate} 가 통과한다 — 컨텍스트가 뜨는 것 자체가 증거다.
 *       (부분 인덱스 3개와 CHECK 제약이 붙은 스키마에서도 validate 는 깨지지 않는다.
 *        Hibernate 는 인덱스·CHECK 를 검증 대상으로 보지 않는다.)</li>
 *   <li>네이티브 Postgres enum 컬럼이 {@link jakarta.persistence.AttributeConverter} +
 *       {@link PgEnumJdbcType} 조합으로 읽고 쓰인다</li>
 *   <li>{@code Persistable} 덕분에 신규 저장에 <b>SELECT 가 앞서지 않는다</b> (/SPEC.md §5-3-2)</li>
 * </ul>
 */
@SpringBootTest(properties = "spring.jpa.properties.hibernate.session_factory.statement_inspector="
        + "com.acttub.actingapi.domain.EntityMappingIT$RecordingInspector")
class EntityMappingIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("entity_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    /** 실행된 SQL 을 모은다. "INSERT 앞에 SELECT 가 없다"를 주장하려면 실제 SQL 을 봐야 한다. */
    public static class RecordingInspector implements StatementInspector {
        static final List<String> STATEMENTS = java.util.Collections.synchronizedList(
                new java.util.ArrayList<>());

        @Override
        public String inspect(String sql) {
            STATEMENTS.add(sql);
            return sql;
        }
    }

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    SessionFactory sessionFactory;
    @PersistenceContext
    EntityManager entityManager;

    @Test
    @Transactional
    @DisplayName("users: 네이티브 enum 컬럼을 컨버터로 읽고 쓴다")
    void userRoundTrip() {
        UUID id = UUID.randomUUID();
        entityManager.persist(new UserEntity(id, "a@example.test", UserStatus.ACTIVE, "닉네임"));
        entityManager.flush();
        entityManager.clear();

        UserEntity loaded = entityManager.find(UserEntity.class, id);
        assertThat(loaded.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(loaded.getNickname()).isEqualTo("닉네임");
        // server_default 가 발동했다 — 필드 초기화값을 주지 않은 결과다 (/SPEC.md §5-3-3).
        assertThat(loaded.getCreatedAt()).isNotNull();

        // DB 에 실제로 들어간 값은 Python enum 의 .value 다.
        assertThat(jdbc.queryForObject("SELECT status::text FROM users WHERE id = ?", String.class, id))
                .isEqualTo("active");
    }

    @Test
    @Transactional
    @DisplayName("practice_sessions: 부분 인덱스가 걸린 테이블도 정상 매핑된다")
    void practiceSessionRoundTrip() {
        UUID userId = UUID.randomUUID();
        entityManager.persist(new UserEntity(userId, null, UserStatus.ACTIVE, null));

        UUID uploadIntentId = UUID.randomUUID();
        entityManager.flush();
        jdbc.update("INSERT INTO upload_intents "
                + "(id, user_id, status, storage_provider, object_key, mime_type, size_bytes, expires_at) "
                + "VALUES (?, ?, 'pending'::upload_status_t, 's3', 'k', 'video/mp4', 1, now())",
                uploadIntentId, userId);

        UUID id = UUID.randomUUID();
        entityManager.persist(new PracticeSessionEntity(id, userId, uploadIntentId,
                PracticeStatus.ANALYZING, "상황", "인물", "서브텍스트"));
        entityManager.flush();
        entityManager.clear();

        PracticeSessionEntity loaded = entityManager.find(PracticeSessionEntity.class, id);
        assertThat(loaded.getStatus()).isEqualTo(PracticeStatus.ANALYZING);
        assertThat(loaded.getHiddenAt()).isNull();
        assertThat(jdbc.queryForObject("SELECT status::text FROM practice_sessions WHERE id = ?",
                String.class, id)).isEqualTo("analyzing");
    }

    @Test
    @Transactional
    @DisplayName("Persistable 구현 덕분에 신규 INSERT 앞에 SELECT 가 붙지 않는다 (/SPEC.md §5-3-2)")
    void newEntityDoesNotSelectBeforeInsert() {
        RecordingInspector.STATEMENTS.clear();

        UUID id = UUID.randomUUID();
        // Spring Data 의 save() 경로를 흉내낸다: isNew()==true 면 persist, 아니면 merge.
        UserEntity entity = new UserEntity(id, "b@example.test", UserStatus.SUSPENDED, null);
        assertThat(entity.isNew()).isTrue();
        entityManager.persist(entity);
        entityManager.flush();

        List<String> statements = List.copyOf(RecordingInspector.STATEMENTS);
        assertThat(statements).anyMatch(sql -> sql.startsWith("insert into users"));
        assertThat(statements)
                .as("신규 저장에 SELECT 가 섞이면 merge() 경로로 샌 것이다: " + statements)
                .noneMatch(sql -> sql.toLowerCase().startsWith("select"));

        // 영속화 뒤에는 더 이상 신규가 아니다 → 재저장 시 merge 로 간다.
        assertThat(entity.isNew()).isFalse();
    }
}
