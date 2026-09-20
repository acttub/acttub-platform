package com.acttub.actingapi.platform.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.acttub.actingapi.feature.analysis.schema.AnomalyEntity;
import com.acttub.actingapi.feature.analysis.schema.SummaryEntity;
import com.acttub.actingapi.feature.analysis.schema.TranscriptEntity;
import com.acttub.actingapi.feature.coach.schema.CoachSessionEntity;
import com.acttub.actingapi.feature.coach.schema.CoachTurnEntity;
import com.acttub.actingapi.feature.coach.schema.CoachingHandoffEntity;
import com.acttub.actingapi.feature.coach.schema.HandoffConfirmationEntity;
import com.acttub.actingapi.feature.report.schema.PracticeReportEntity;
import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.feature.auth.schema.UserIdentityEntity;
import com.acttub.actingapi.feature.auth.schema.RefreshTokenEntity;
import com.acttub.actingapi.feature.consent.schema.ConsentDocumentEntity;
import com.acttub.actingapi.feature.consent.schema.UserConsentEntity;
import com.acttub.actingapi.feature.memory.schema.ActorMemoryEntryEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioCreditEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioEntity;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioPhotoEntity;
import com.acttub.actingapi.feature.practice.schema.PracticeSessionEntity;
import com.acttub.actingapi.feature.profile.schema.UserProfileDirectionEntity;
import com.acttub.actingapi.feature.profile.schema.UserProfileEntity;
import com.acttub.actingapi.feature.push.schema.PushTokenEntity;
import com.acttub.actingapi.feature.profile.schema.AccountCleanupOperationEntity;
import com.acttub.actingapi.feature.reading.schema.LineMemorizationEntity;
import com.acttub.actingapi.feature.reading.schema.ReadingRecordingEntity;
import com.acttub.actingapi.feature.reading.schema.ReadingSessionEntity;
import com.acttub.actingapi.feature.reading.schema.ScriptCharacterEntity;
import com.acttub.actingapi.feature.reading.schema.ScriptEntity;
import com.acttub.actingapi.feature.reading.schema.ScriptLineEntity;
import com.acttub.actingapi.feature.transfer.schema.GuestTransferCodeEntity;
import com.acttub.actingapi.feature.upload.schema.UploadIntentEntity;
import com.acttub.actingapi.support.PostgresContainerSupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Table;
import org.hibernate.SessionFactory;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.jpa.repository.support.JpaEntityInformationSupport;
import org.springframework.data.jpa.repository.support.SimpleJpaRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * 전체 Schema Entity 매핑과 Spring Data 신규 판정에 대한 검증.
 *
 * <p>여기서 확인하는 것:
 * <ul>
 *   <li>{@code ddl-auto: validate} 가 통과한다 — 컨텍스트가 뜨는 것 자체가 증거다.
 *       (부분 인덱스 3개와 CHECK 제약이 붙은 스키마에서도 validate 는 깨지지 않는다.
 *        Hibernate 는 인덱스·CHECK 를 검증 대상으로 보지 않는다.)</li>
 *   <li>값 목록이 CHECK 로 걸린 text 컬럼이 {@link jakarta.persistence.AttributeConverter} 로
 *       읽고 쓰인다 (SOMA-462 이전에는 네이티브 Postgres enum 컬럼이었다)</li>
 *   <li>{@code Persistable} 덕분에 신규 저장에 <b>SELECT 가 앞서지 않는다</b> (apps/api/CONTRACT.md §5-3-2)</li>
 * </ul>
 */
@SpringBootTest(properties = {"spring.jpa.properties.hibernate.session_factory.statement_inspector="
        + "com.acttub.actingapi.platform.schema.EntityMappingIT$RecordingInspector", "JWT_SECRET=test-secret"})
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

    /**
     * 매핑을 은퇴시키고 DB 에는 남긴 테이블 (apps/api/CONTRACT.md §5-1). 구형 {@code reports} 와,
     * 1.0.0 에서 API·코드를 내린 커뮤니티 일곱이다({@code docs/requirements/05-community.md}).
     */
    private static final Set<String> RETIRED_TABLES = Set.of(
            "reports",
            "community_anonymous_aliases", "community_blocks", "community_categories",
            "community_comments", "community_post_likes", "community_posts", "community_reports");

    @Test
    @DisplayName("JPA metamodel은 관계 매핑 없이 정확히 31개 활성 엔티티를 포함한다")
    void mapsExactlyThirtyOneActiveEntities() {
        Set<Class<?>> entities = entityManager.getMetamodel().getEntities().stream()
                .map(jakarta.persistence.metamodel.Type::getJavaType)
                .collect(java.util.stream.Collectors.toSet());
        assertThat(entities).hasSize(31);
        assertThat(entities).contains(ActorMemoryEntryEntity.class, PushTokenEntity.class);
        assertThat(entities).allMatch(type -> type.getSimpleName().endsWith("Entity"));
        assertThat(entities).allMatch(type -> java.util.Arrays.stream(type.getDeclaredFields())
                .noneMatch(field -> java.util.Arrays.stream(field.getAnnotations())
                        .anyMatch(annotation -> Set.of("ManyToOne", "OneToMany", "OneToOne", "ManyToMany", "Enumerated")
                                .contains(annotation.annotationType().getSimpleName()))));
        long jsonNodes = entities.stream().flatMap(type -> java.util.Arrays.stream(type.getDeclaredFields()))
                .filter(field -> field.getType().equals(com.fasterxml.jackson.databind.JsonNode.class))
                .count();
        // 리딩 회차의 line_results 가 여덟 번째다(V13).
        assertThat(jsonNodes).isEqualTo(8);
    }

    @Test
    @DisplayName("활성 Schema Entity는 명시적으로 은퇴한 컬럼 외 전체를 매핑한다")
    void mapsEveryActiveColumnOfEveryActiveTable() {
        Set<Class<?>> entities = entityManager.getMetamodel().getEntities().stream()
                .map(jakarta.persistence.metamodel.Type::getJavaType)
                .collect(java.util.stream.Collectors.toSet());

        Set<String> activeTables = new java.util.HashSet<>(jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'
                  AND table_name <> 'flyway_schema_history'
                """, String.class));
        assertThat(activeTables)
                .as("은퇴한 매핑의 테이블은 DB 에 그대로 있다 — 코드만 내리고 자료는 보존한다")
                .containsAll(RETIRED_TABLES);
        activeTables.removeAll(RETIRED_TABLES);
        assertThat(entities.stream().map(type -> type.getAnnotation(Table.class).name())
                .collect(java.util.stream.Collectors.toSet())).isEqualTo(activeTables);
        var retiredColumns = java.util.Map.of(
                "summaries", Set.of("observation", "summary", "intent_alignment", "key_moment", "key_dimension"),
                "practice_sessions", Set.of("subtext"),
                // nickname: 이름은 `user_profiles.name` 이 정본이다. 컬럼은 직전 릴리스의 서버를
                // 위해 남아 있고, 새 코드가 건드리는 곳은 탈퇴의 파기 하나다(결정 I-3).
                "users", Set.of("role", "nickname"));
        for (Class<?> entity : entities) {
            String table = entity.getAnnotation(Table.class).name();
            Set<String> databaseColumns = new java.util.HashSet<>(jdbc.queryForList("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ?
                    """, String.class, table));
            databaseColumns.removeAll(retiredColumns.getOrDefault(table, Set.of()));
            Set<String> mappedColumns = hierarchy(entity)
                    .flatMap(type -> java.util.Arrays.stream(type.getDeclaredFields()))
                    .map(field -> field.getAnnotation(jakarta.persistence.Column.class))
                    .filter(java.util.Objects::nonNull)
                    .map(jakarta.persistence.Column::name)
                    .collect(java.util.stream.Collectors.toSet());

            assertThat(mappedColumns)
                    .as("%s가 %s의 전체 컬럼을 나타내야 한다", entity.getSimpleName(), table)
                    .isEqualTo(databaseColumns);
        }
    }

    @Test
    @Transactional
    @DisplayName("users: 값 CHECK 가 걸린 text 컬럼을 컨버터로 읽고 쓴다")
    void userRoundTrip() {
        UUID id = UUID.randomUUID();
        entityManager.persist(new UserEntity(id, "a@example.test", UserStatus.ACTIVE));
        entityManager.flush();
        entityManager.clear();

        UserEntity loaded = entityManager.find(UserEntity.class, id);
        assertThat(loaded.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(loaded.getEmail()).isEqualTo("a@example.test");
        assertThat(loaded.getAgeConfirmedAt()).isNull();
        assertThat(jdbc.queryForObject("SELECT role FROM users WHERE id = ?", String.class, id))
                .isEqualTo("user");
        assertThat(loaded.getDeactivatedAt()).isNull();
        // server_default 가 발동했다 — 필드 초기화값을 주지 않은 결과다 (apps/api/CONTRACT.md §5-3-3).
        assertThat(loaded.getCreatedAt()).isNotNull();

        // DB 에 실제로 들어간 값은 Python enum 의 .value 다.
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id = ?", String.class, id))
                .isEqualTo("active");
    }

    @Test
    @Transactional
    @DisplayName("user_profiles: 값 CHECK 컬럼과 생년월일을 읽고 쓰며 알림 토글은 켜진 채로 시작한다")
    void userProfileRoundTrip() {
        UUID userId = UUID.randomUUID();
        entityManager.persist(new UserEntity(userId, null, UserStatus.ACTIVE));
        entityManager.persist(new UserProfileEntity(userId, "김배우", ProfileGender.FEMALE,
                java.time.LocalDate.of(2001, 3, 14), ActingExperience.EXAM_PREP, ActingGoal.PROFESSIONAL));
        entityManager.flush();
        entityManager.persist(new UserProfileDirectionEntity(UUID.randomUUID(), userId, ActingDirection.MEDIA));
        entityManager.flush();
        entityManager.clear();

        UserProfileEntity loaded = entityManager.find(UserProfileEntity.class, userId);
        assertThat(loaded.getName()).isEqualTo("김배우");
        assertThat(loaded.getGender()).isEqualTo(ProfileGender.FEMALE);
        assertThat(loaded.getBirthDate()).isEqualTo(java.time.LocalDate.of(2001, 3, 14));
        assertThat(loaded.getExperience()).isEqualTo(ActingExperience.EXAM_PREP);
        assertThat(loaded.getGoal()).isEqualTo(ActingGoal.PROFESSIONAL);
        assertThat(loaded.getPhotoKey()).isNull();
        assertThat(loaded.getBio()).isNull();
        assertThat(loaded.getAgeBand()).isNull();
        // 토글 셋의 기본값은 모두 켜짐이다 (account.notification).
        assertThat(loaded.isNotifyAnalysisDone()).isTrue();
        assertThat(loaded.isNotifyChallenge()).isTrue();
        assertThat(loaded.isNotifyEveningReminder()).isTrue();
        assertThat(loaded.getCreatedAt()).isNotNull();

        // DB 에 실제로 들어간 값은 결정 12 의 값 이름이다.
        assertThat(jdbc.queryForMap(
                "SELECT gender, experience, goal FROM user_profiles WHERE user_id = ?", userId))
                .containsEntry("gender", "female")
                .containsEntry("experience", "exam_prep")
                .containsEntry("goal", "professional");
        assertThat(jdbc.queryForList(
                "SELECT direction FROM user_profile_directions WHERE user_id = ?", String.class, userId))
                .containsExactly("media");
    }

    @Test
    @Transactional
    @DisplayName("actor_memory_entries: 앱 생성 UUID·text converter·server default를 함께 보존한다")
    void actorMemoryRoundTrip() {
        UUID userId = UUID.randomUUID();
        entityManager.persist(new UserEntity(userId, "memory@example.test", UserStatus.ACTIVE));

        UUID id = UUID.randomUUID();
        entityManager.persist(new ActorMemoryEntryEntity(
                id, userId, ActorMemoryField.GOAL, "오디션 합격",
                ActorMemoryAuthor.ACTOR, null));
        entityManager.flush();
        entityManager.clear();

        ActorMemoryEntryEntity loaded = entityManager.find(ActorMemoryEntryEntity.class, id);
        assertThat(loaded.getUserId()).isEqualTo(userId);
        assertThat(loaded.getField()).isEqualTo(ActorMemoryField.GOAL);
        assertThat(loaded.getWrittenBy()).isEqualTo(ActorMemoryAuthor.ACTOR);
        assertThat(loaded.getValue()).isEqualTo("오디션 합격");
        assertThat(loaded.getCreatedAt()).isNotNull();
        assertThat(loaded.getUpdatedAt()).isNotNull();
        assertThat(jdbc.queryForMap(
                "SELECT field, written_by FROM actor_memory_entries WHERE id = ?", id))
                .containsEntry("field", "goal")
                .containsEntry("written_by", "actor");
    }

    @Test
    @Transactional
    @DisplayName("practice_sessions: 부분 인덱스가 걸린 테이블도 정상 매핑된다")
    void practiceSessionRoundTrip() {
        UUID userId = UUID.randomUUID();
        entityManager.persist(new UserEntity(userId, null, UserStatus.ACTIVE));

        UUID uploadIntentId = UUID.randomUUID();
        entityManager.flush();
        jdbc.update("INSERT INTO upload_intents "
                + "(id, user_id, status, storage_provider, object_key, mime_type, size_bytes, expires_at) "
                + "VALUES (?, ?, 'pending', 's3', 'k', 'video/mp4', 1, now())",
                uploadIntentId, userId);

        UUID id = UUID.randomUUID();
        // blockage_kind/sub_branch 는 ck_practice_sessions_blockage_branch 가 묶는 조합만 받는다.
        entityManager.persist(new PracticeSessionEntity(id, userId, uploadIntentId,
                PracticeStatus.ANALYZING, "상황", "인물",
                "분석", "캐릭터 분석", "목표"));
        entityManager.flush();
        entityManager.clear();

        PracticeSessionEntity loaded = entityManager.find(PracticeSessionEntity.class, id);
        assertThat(loaded.getStatus()).isEqualTo(PracticeStatus.ANALYZING);
        assertThat(loaded.getHiddenAt()).isNull();
        assertThat(loaded.getBlockageKind()).isEqualTo("분석");
        assertThat(loaded.getSubBranch()).isEqualTo("캐릭터 분석");
        assertThat(loaded.getGoal()).isEqualTo("목표");
        assertThat(loaded.getBlockageDetail()).isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM practice_sessions WHERE id = ?",
                String.class, id)).isEqualTo("analyzing");
    }

    @Test
    @Transactional
    @DisplayName("Persistable 구현 덕분에 신규 INSERT 앞에 SELECT 가 붙지 않는다 (apps/api/CONTRACT.md §5-3-2)")
    void newEntityDoesNotSelectBeforeInsert() {
        RecordingInspector.STATEMENTS.clear();

        UUID id = UUID.randomUUID();
        // Spring Data 의 save() 경로를 흉내낸다: isNew()==true 면 persist, 아니면 merge.
        UserEntity entity = new UserEntity(id, "b@example.test", UserStatus.DEACTIVATED);
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

    @Test
    @Transactional
    @DisplayName("앱 생성 UUID 활성 엔티티 23종의 실제 Spring Data save()가 INSERT 전 SELECT를 내지 않는다")
    void allActiveAppGeneratedIdsUsePersistOnSave() {
        RecordingInspector.STATEMENTS.clear();
        UUID userId=UUID.randomUUID(), documentId=UUID.randomUUID();
        UUID uploadId=UUID.randomUUID(), practiceId=UUID.randomUUID(), summaryId=UUID.randomUUID();
        UUID coachId=UUID.randomUUID(), handoffId=UUID.randomUUID();
        var object=JsonNodeFactory.instance.objectNode().put("k","v");
        var array=JsonNodeFactory.instance.arrayNode().add("v");

        save(UserEntity.class,new UserEntity(userId,"all-"+userId+"@example.test",UserStatus.ACTIVE));
        save(UserIdentityEntity.class,new UserIdentityEntity(UUID.randomUUID(),userId,IdentityProvider.GOOGLE,"uid-"+userId));
        save(RefreshTokenEntity.class,new RefreshTokenEntity(UUID.randomUUID(),userId,"a".repeat(64),null,
                java.time.Instant.now(),java.time.Instant.now().plusSeconds(60)));
        save(ConsentDocumentEntity.class,new ConsentDocumentEntity(documentId,ConsentType.TERMS,"v-"+userId,"t","b",true));
        save(UserConsentEntity.class,new UserConsentEntity(UUID.randomUUID(),userId,documentId,ConsentAction.GRANTED,java.time.Instant.now()));
        save(ActorMemoryEntryEntity.class,new ActorMemoryEntryEntity(UUID.randomUUID(),userId,
                ActorMemoryField.GOAL,"목표",ActorMemoryAuthor.ACTOR,null));
        save(UploadIntentEntity.class,new UploadIntentEntity(uploadId,userId,UploadStatus.PENDING,"s3","key-"+userId,"video/mp4",1,java.time.Instant.now().plusSeconds(60)));
        save(PracticeSessionEntity.class,new PracticeSessionEntity(practiceId,userId,uploadId,PracticeStatus.ANALYZING,"s","c","분석","캐릭터 분석","g"));
        save(TranscriptEntity.class,new TranscriptEntity(UUID.randomUUID(),practiceId,0,"text"));
        save(SummaryEntity.class,new SummaryEntity(summaryId,practiceId,"model",object,array,array));
        entityManager.flush();

        CoachSessionEntity coach=new CoachSessionEntity(coachId,practiceId,SessionStatus.OPEN); coach.close(CloseReason.USER_ENDED);
        entityManager.persist(coach); entityManager.persist(new CoachTurnEntity(coachId,0,TurnRole.AI,"text")); entityManager.flush();
        save(CoachingHandoffEntity.class,new CoachingHandoffEntity(handoffId,coachId,practiceId,"analysis",object));
        entityManager.flush();
        entityManager.persist(new HandoffConfirmationEntity(handoffId,true,null));
        save(PracticeReportEntity.class,new PracticeReportEntity(UUID.randomUUID(),practiceId,"analysis",object,handoffId));
        save(ExternalOperationEntity.class,new ExternalOperationEntity(UUID.randomUUID(),practiceId,userId,UUID.randomUUID(),OperationKind.ANALYZE,OperationStatus.PENDING,"b".repeat(64)));
        entityManager.persist(new UserProfileEntity(userId,"이름",ProfileGender.UNSPECIFIED,
                java.time.LocalDate.of(2001,3,14),ActingExperience.Y1_TO_3,ActingGoal.AUDITION));
        entityManager.persist(new PortfolioEntity(userId,"소개글")); entityManager.flush();
        save(UserProfileDirectionEntity.class,new UserProfileDirectionEntity(UUID.randomUUID(),userId,ActingDirection.STAGE));
        save(PortfolioCreditEntity.class,new PortfolioCreditEntity(UUID.randomUUID(),userId,"작품","역할",2025,PortfolioCreditKind.MUSICAL,0));
        save(PortfolioPhotoEntity.class,new PortfolioPhotoEntity(UUID.randomUUID(),userId,"portfolio/"+userId+".jpg","image/jpeg",1,
                java.time.Instant.now().plusSeconds(60)));
        save(GuestTransferCodeEntity.class,new GuestTransferCodeEntity(UUID.randomUUID(),userId,"c".repeat(64),
                java.time.Instant.now().plusSeconds(600)));
        save(AccountCleanupOperationEntity.class,new AccountCleanupOperationEntity(UUID.randomUUID(),userId,
                AccountCleanupKind.KAKAO_UNLINK,"d1:payload",java.time.Instant.now(),java.time.Instant.now().plusSeconds(600)));
        entityManager.persist(new AnomalyEntity(summaryId,IntentImpact.REVERSAL,Severity.HIGH));
        entityManager.flush();
        // 리딩(V13): 대본 → 배역 → 줄 → 회차 → 녹음·암기 상태 순으로 FK 를 따른다.
        UUID scriptId=UUID.randomUUID(), characterId=UUID.randomUUID(), lineId=UUID.randomUUID(), readingId=UUID.randomUUID();
        save(ScriptEntity.class,new ScriptEntity(scriptId,userId,"대본","원문",ScriptSource.PASTE,UUID.randomUUID(),"c".repeat(64)));
        entityManager.flush();
        save(ScriptCharacterEntity.class,new ScriptCharacterEntity(characterId,scriptId,"니나",0,null));
        entityManager.flush();
        save(ScriptLineEntity.class,new ScriptLineEntity(lineId,scriptId,1,ScriptLineKind.DIALOGUE,characterId,"안녕"));
        entityManager.flush();
        save(ReadingSessionEntity.class,new ReadingSessionEntity(readingId,scriptId,userId,UUID.randomUUID(),new UUID[]{characterId},
                ReadingMode.READ,lineId,lineId,ReadingAdvance.SILENCE,true,ReadingSessionStatus.IN_PROGRESS,lineId,array));
        entityManager.flush();
        save(ReadingRecordingEntity.class,new ReadingRecordingEntity(UUID.randomUUID(),userId,readingId,lineId,UUID.randomUUID(),1,
                "reading/"+userId+".m4a","audio/mp4",1,1,null,TranscriptSource.NONE,null));
        save(LineMemorizationEntity.class,new LineMemorizationEntity(UUID.randomUUID(),userId,lineId,MemorizationStatus.MEMORIZED));
        entityManager.flush();

        List<String> statements=List.copyOf(RecordingInspector.STATEMENTS);
        assertThat(statements.stream().filter(sql->sql.startsWith("insert into "))
                .map(sql->sql.substring("insert into ".length()).split(" ")[0]).distinct()).hasSize(30);
        assertThat(statements).noneMatch(sql->sql.stripLeading().toLowerCase().startsWith("select"));
        assertThat(jdbc.queryForObject("SELECT intent_impact FROM anomalies WHERE summary_id=?",String.class,summaryId)).isEqualTo("반전");
    }

    @Test
    @Transactional
    @DisplayName("JsonNode는 객체·배열·SQL NULL·JSON null을 실제 jsonb 왕복에서 구분한다")
    void jsonbPreservesFourCases() {
        UUID user=UUID.randomUUID(),sqlNullUpload=UUID.randomUUID(),jsonNullUpload=UUID.randomUUID();
        UUID sqlNullPractice=UUID.randomUUID(),jsonNullPractice=UUID.randomUUID();
        entityManager.persist(new UserEntity(user,"json-"+user+"@example.test",UserStatus.ACTIVE)); entityManager.flush();
        jdbc.update("INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at) VALUES (?,?, 'pending','s3',?,'video/mp4',1,now()), (?,?, 'pending','s3',?,'video/mp4',1,now())",sqlNullUpload,user,"json-sql-null-"+user,jsonNullUpload,user,"json-null-"+user);
        entityManager.persist(new PracticeSessionEntity(sqlNullPractice,user,sqlNullUpload,PracticeStatus.ANALYZING,"s","c","분석","캐릭터 분석","g"));
        entityManager.persist(new PracticeSessionEntity(jsonNullPractice,user,jsonNullUpload,PracticeStatus.ANALYZING,"s","c","분석","캐릭터 분석","g")); entityManager.flush();
        UUID sqlNull=UUID.randomUUID(),jsonNull=UUID.randomUUID();
        ExternalOperationEntity first = new ExternalOperationEntity(sqlNull, sqlNullPractice, user,
                UUID.randomUUID(), OperationKind.ANALYZE, OperationStatus.PENDING, "a".repeat(64));
        ExternalOperationEntity second = new ExternalOperationEntity(jsonNull, jsonNullPractice, user,
                UUID.randomUUID(), OperationKind.ANALYZE, OperationStatus.PENDING, "b".repeat(64));
        second.responsePayload = JsonNodeFactory.instance.nullNode();
        entityManager.persist(first);
        entityManager.persist(second);
        UUID summaryId = UUID.randomUUID();
        entityManager.persist(new SummaryEntity(summaryId, jsonNullPractice, "m",
                JsonNodeFactory.instance.objectNode().put("scene_summary", "장면"),
                JsonNodeFactory.instance.arrayNode().add("관찰"), JsonNodeFactory.instance.arrayNode()));
        entityManager.flush();
        entityManager.clear();
        assertThat(jdbc.queryForObject("SELECT response_payload IS NULL FROM external_operations WHERE id=?",
                Boolean.class, sqlNull)).isTrue();
        assertThat(jdbc.queryForObject("SELECT response_payload='null'::jsonb FROM external_operations WHERE id=?",
                Boolean.class, jsonNull)).isTrue();
        assertThat(entityManager.find(ExternalOperationEntity.class, sqlNull).responsePayload).isNull();
        assertThat(entityManager.find(ExternalOperationEntity.class, jsonNull).responsePayload.isNull()).isTrue();
        assertThat(entityManager.find(SummaryEntity.class, summaryId).getRaw())
                .isEqualTo(JsonNodeFactory.instance.objectNode().put("scene_summary", "장면"));
        assertThat(entityManager.find(SummaryEntity.class, summaryId).getObservationsJson())
                .isEqualTo(JsonNodeFactory.instance.arrayNode().add("관찰"));
    }

    private <T> T save(Class<T> type,T entity){
        var information=JpaEntityInformationSupport.getEntityInformation(type,entityManager);
        return new SimpleJpaRepository<T,UUID>(information,entityManager).save(entity);
    }

    private static Stream<Class<?>> hierarchy(Class<?> type) {
        Stream.Builder<Class<?>> classes = Stream.builder();
        for (Class<?> current = type; current != null && current != Object.class;
                current = current.getSuperclass()) {
            classes.add(current);
        }
        return classes.build();
    }
}
