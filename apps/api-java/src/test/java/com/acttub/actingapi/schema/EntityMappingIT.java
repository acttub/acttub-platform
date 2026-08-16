package com.acttub.actingapi.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.acttub.actingapi.community.schema.CommunityAnonymousAliasEntity;
import com.acttub.actingapi.community.schema.CommunityBlockEntity;
import com.acttub.actingapi.community.schema.CommunityCategoryEntity;
import com.acttub.actingapi.community.schema.CommunityCommentEntity;
import com.acttub.actingapi.community.schema.CommunityPostEntity;
import com.acttub.actingapi.community.schema.CommunityPostLikeEntity;
import com.acttub.actingapi.community.schema.CommunityReportEntity;
import com.acttub.actingapi.practice.schema.PracticeSessionEntity;
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
import org.springframework.data.jpa.repository.support.JpaEntityInformationSupport;
import org.springframework.data.jpa.repository.support.SimpleJpaRepository;
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
@SpringBootTest(properties = {"spring.jpa.properties.hibernate.session_factory.statement_inspector="
        + "com.acttub.actingapi.schema.EntityMappingIT$RecordingInspector", "JWT_SECRET=test-secret"})
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
    @DisplayName("JPA metamodel은 관계 매핑 없이 정확히 24개 엔티티를 포함한다")
    void mapsExactlyTwentyFourEntities() {
        Set<Class<?>> entities = entityManager.getMetamodel().getEntities().stream()
                .map(jakarta.persistence.metamodel.Type::getJavaType)
                .collect(java.util.stream.Collectors.toSet());
        assertThat(entities).hasSize(24);
        assertThat(entities).allMatch(type -> type.getSimpleName().endsWith("Entity"));
        assertThat(entities).allMatch(type -> java.util.Arrays.stream(type.getDeclaredFields())
                .noneMatch(field -> java.util.Arrays.stream(field.getAnnotations())
                        .anyMatch(annotation -> Set.of("ManyToOne", "OneToMany", "OneToOne", "ManyToMany", "Enumerated")
                                .contains(annotation.annotationType().getSimpleName()))));
        // 19 = 원본 17 + 배우 기억 2(field·author). 엔티티는 아직 없어 24개 그대로다.
        assertThat(PgEnumCatalogVerifier.typeCount()).isEqualTo(19);
        long jsonNodes = entities.stream().flatMap(type -> java.util.Arrays.stream(type.getDeclaredFields()))
                .filter(field -> field.getType().equals(com.fasterxml.jackson.databind.JsonNode.class))
                .count();
        assertThat(jsonNodes).isEqualTo(8);
    }

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
        // blockage_kind/sub_branch 는 ck_practice_sessions_blockage_branch 가 묶는 조합만 받는다.
        entityManager.persist(new PracticeSessionEntity(id, userId, uploadIntentId,
                PracticeStatus.ANALYZING, "상황", "인물", "서브텍스트",
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

    @Test
    @Transactional
    @DisplayName("앱 생성 UUID 엔티티 20종의 실제 Spring Data save()가 INSERT 전 SELECT를 내지 않는다")
    void allTwentyAppGeneratedIdsUsePersistOnSave() {
        RecordingInspector.STATEMENTS.clear();
        UUID userId=UUID.randomUUID(), otherUserId=UUID.randomUUID(), documentId=UUID.randomUUID();
        UUID uploadId=UUID.randomUUID(), practiceId=UUID.randomUUID(), summaryId=UUID.randomUUID();
        UUID coachId=UUID.randomUUID(), handoffId=UUID.randomUUID(), categoryId=UUID.randomUUID(), postId=UUID.randomUUID();
        var object=JsonNodeFactory.instance.objectNode().put("k","v");
        var array=JsonNodeFactory.instance.arrayNode().add("v");

        save(UserEntity.class,new UserEntity(userId,"all-"+userId+"@example.test",UserStatus.ACTIVE,"n"));
        save(UserEntity.class,new UserEntity(otherUserId,"other-"+userId+"@example.test",UserStatus.ACTIVE,"n"));
        save(UserIdentityEntity.class,new UserIdentityEntity(UUID.randomUUID(),userId,IdentityProvider.GOOGLE,"uid-"+userId));
        save(RefreshTokenEntity.class,new RefreshTokenEntity(UUID.randomUUID(),userId,"a".repeat(64),null,java.time.Instant.now().plusSeconds(60)));
        save(ConsentDocumentEntity.class,new ConsentDocumentEntity(documentId,ConsentType.TERMS,"v-"+userId,"t","b",true));
        save(UserConsentEntity.class,new UserConsentEntity(UUID.randomUUID(),userId,documentId,ConsentAction.GRANTED));
        save(UploadIntentEntity.class,new UploadIntentEntity(uploadId,userId,UploadStatus.PENDING,"s3","key-"+userId,"video/mp4",1,java.time.Instant.now().plusSeconds(60)));
        save(PracticeSessionEntity.class,new PracticeSessionEntity(practiceId,userId,uploadId,PracticeStatus.ANALYZING,"s","c",null,"분석","캐릭터 분석","g"));
        save(TranscriptEntity.class,new TranscriptEntity(UUID.randomUUID(),practiceId,0,"text"));
        save(SummaryEntity.class,new SummaryEntity(summaryId,practiceId,"model",object,array,array));
        entityManager.flush();

        CoachSessionEntity coach=new CoachSessionEntity(coachId,practiceId,SessionStatus.OPEN); coach.close(CloseReason.USER_ENDED);
        entityManager.persist(coach); entityManager.persist(new CoachTurnEntity(coachId,0,TurnRole.AI,"text")); entityManager.flush();
        save(CoachingHandoffEntity.class,new CoachingHandoffEntity(handoffId,coachId,practiceId,"analysis",object));
        entityManager.flush();
        entityManager.persist(new HandoffConfirmationEntity(handoffId,true,null));
        save(PracticeReportEntity.class,new PracticeReportEntity(UUID.randomUUID(),practiceId,"analysis",object,handoffId));
        save(ReportEntity.class,new ReportEntity(UUID.randomUUID(),coachId,"h",object,"e","s","c","n"));
        save(ExternalOperationEntity.class,new ExternalOperationEntity(UUID.randomUUID(),practiceId,userId,UUID.randomUUID(),OperationKind.ANALYZE,OperationStatus.PENDING,"b".repeat(64)));
        save(CommunityCategoryEntity.class,new CommunityCategoryEntity(categoryId,"slug-"+userId,"name",null,100));
        save(CommunityPostEntity.class,new CommunityPostEntity(postId,categoryId,userId,"t","b",ContentStatus.VISIBLE));
        save(CommunityCommentEntity.class,new CommunityCommentEntity(UUID.randomUUID(),postId,userId,"b",ContentStatus.VISIBLE));
        save(CommunityAnonymousAliasEntity.class,new CommunityAnonymousAliasEntity(UUID.randomUUID(),postId,userId,1));
        save(CommunityPostLikeEntity.class,new CommunityPostLikeEntity(UUID.randomUUID(),postId,userId));
        save(CommunityReportEntity.class,new CommunityReportEntity(UUID.randomUUID(),userId,ReportTargetType.POST,postId,ReportReason.SPAM,ReportStatus.PENDING));
        save(CommunityBlockEntity.class,new CommunityBlockEntity(UUID.randomUUID(),userId,otherUserId));
        entityManager.persist(new AnomalyEntity(summaryId,IntentImpact.REVERSAL,Severity.HIGH));
        entityManager.flush();

        List<String> statements=List.copyOf(RecordingInspector.STATEMENTS);
        assertThat(statements.stream().filter(sql->sql.startsWith("insert into "))
                .map(sql->sql.substring("insert into ".length()).split(" ")[0]).distinct()).hasSize(24);
        assertThat(statements).noneMatch(sql->sql.stripLeading().toLowerCase().startsWith("select"));
        assertThat(jdbc.queryForObject("SELECT intent_impact::text FROM anomalies WHERE summary_id=?",String.class,summaryId)).isEqualTo("반전");
    }

    @Test
    @Transactional
    @DisplayName("JsonNode는 객체·배열·SQL NULL·JSON null을 실제 jsonb 왕복에서 구분한다")
    void jsonbPreservesFourCases() {
        UUID user=UUID.randomUUID(),sqlNullUpload=UUID.randomUUID(),jsonNullUpload=UUID.randomUUID();
        UUID sqlNullPractice=UUID.randomUUID(),jsonNullPractice=UUID.randomUUID();
        entityManager.persist(new UserEntity(user,"json-"+user+"@example.test",UserStatus.ACTIVE,null)); entityManager.flush();
        jdbc.update("INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at) VALUES (?,?, 'pending'::upload_status_t,'s3',?,'video/mp4',1,now()), (?,?, 'pending'::upload_status_t,'s3',?,'video/mp4',1,now())",sqlNullUpload,user,"json-sql-null-"+user,jsonNullUpload,user,"json-null-"+user);
        entityManager.persist(new PracticeSessionEntity(sqlNullPractice,user,sqlNullUpload,PracticeStatus.CREATED,"s","c",null,"분석","캐릭터 분석","g"));
        entityManager.persist(new PracticeSessionEntity(jsonNullPractice,user,jsonNullUpload,PracticeStatus.CREATED,"s","c",null,"분석","캐릭터 분석","g")); entityManager.flush();
        UUID sqlNull=UUID.randomUUID(),jsonNull=UUID.randomUUID();
        SummaryEntity first=new SummaryEntity(sqlNull,sqlNullPractice,"m",JsonNodeFactory.instance.objectNode(),JsonNodeFactory.instance.arrayNode(),JsonNodeFactory.instance.arrayNode());
        first.setObservation(null); entityManager.persist(first);
        SummaryEntity second=new SummaryEntity(jsonNull,jsonNullPractice,"m",JsonNodeFactory.instance.objectNode(),JsonNodeFactory.instance.arrayNode(),JsonNodeFactory.instance.arrayNode());
        second.setObservation(JsonNodeFactory.instance.nullNode()); entityManager.persist(second); entityManager.flush(); entityManager.clear();
        assertThat(jdbc.queryForObject("SELECT observation IS NULL FROM summaries WHERE id=?",Boolean.class,sqlNull)).isTrue();
        assertThat(jdbc.queryForObject("SELECT observation='null'::jsonb FROM summaries WHERE id=?",Boolean.class,jsonNull)).isTrue();
        assertThat(entityManager.find(SummaryEntity.class,sqlNull).getObservation()).isNull();
        assertThat(entityManager.find(SummaryEntity.class,jsonNull).getObservation().isNull()).isTrue();
        assertThat(entityManager.find(SummaryEntity.class,jsonNull).getRaw().isObject()).isTrue();
        assertThat(entityManager.find(SummaryEntity.class,jsonNull).getObservationsJson().isArray()).isTrue();
    }

    private <T> T save(Class<T> type,T entity){
        var information=JpaEntityInformationSupport.getEntityInformation(type,entityManager);
        return new SimpleJpaRepository<T,UUID>(information,entityManager).save(entity);
    }
}
