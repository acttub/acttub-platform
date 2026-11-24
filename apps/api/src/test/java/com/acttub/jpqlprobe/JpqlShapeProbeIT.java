package com.acttub.jpqlprobe;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.jpqlprobe.ProbeEntities.ProbeAiJob;
import com.acttub.jpqlprobe.ProbeEntities.ProbeReadingSession;
import com.acttub.jpqlprobe.ProbeEntities.ProbeUploadIntent;
import com.acttub.jpqlprobe.ProbeEntities.ProbeUser;
import com.acttub.jpqlprobe.ProbeEntities.ProbeVideo;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Tuple;
import org.hibernate.LockMode;
import org.hibernate.Session;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import tools.jackson.databind.json.JsonMapper;

/**
 * SOMA-1112: apps/api 의 네이티브 SQL 에 나오는 PostgreSQL 모양마다 실제 대표 쿼리 하나를 HQL(JPQL 확장)로 다시 써서
 * 저장소의 Hibernate(7.4.15) 와 테스트용 PostgreSQL 18 에서 돌려 본다.
 *
 * <p>시도마다 된다·안 된다를 관찰한 대로 못박는다({@link #check}). 된 시도는 Hibernate 가 만든 SQL 을, 안 된 시도는
 * 오류 문구를 {@code build/jpql-probe/shape-probe.md} 에 남긴다. 같은 데이터에서 원본 네이티브 SQL 과 결과를 견줄 수
 * 있는 것은 견준다({@code 결과 같음}).
 *
 * <p>조사용 테스트다. 운영 코드를 바꾸지 않고 브랜치에만 둔다.
 */
@TestMethodOrder(MethodOrderer.MethodName.class)
class JpqlShapeProbeIT {
    static ProbeLab lab;
    static final List<String> MISMATCH = new ArrayList<>();
    static final JsonMapper JSON = JsonMapper.builder().build();

    static final UUID U1 = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    static final UUID U2 = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
    static final UUID U3 = UUID.fromString("00000000-0000-0000-0000-0000000000a3");
    static final UUID D1 = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
    static final UUID D2 = UUID.fromString("00000000-0000-0000-0000-0000000000d2");
    static final UUID D3 = UUID.fromString("00000000-0000-0000-0000-0000000000d3");
    static final UUID AD = UUID.fromString("00000000-0000-0000-0000-0000000000ad");
    static final UUID POST = UUID.fromString("00000000-0000-0000-0000-0000000000b1");
    static final UUID REC = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    static final UUID LEASE = UUID.fromString("00000000-0000-0000-0000-0000000000c2");
    static final UUID CH = UUID.fromString("00000000-0000-0000-0000-0000000000e0");
    static final UUID E1 = UUID.fromString("00000000-0000-0000-0000-0000000000e1");
    static final UUID E2 = UUID.fromString("00000000-0000-0000-0000-0000000000e2");
    static final UUID E3 = UUID.fromString("00000000-0000-0000-0000-0000000000e3");
    static final UUID E4 = UUID.fromString("00000000-0000-0000-0000-0000000000e4");
    static final UUID LINE = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
    static final UUID LINE2 = UUID.fromString("00000000-0000-0000-0000-0000000000f2");
    static final UUID SCRIPT = UUID.fromString("00000000-0000-0000-0000-0000000000f0");
    static final UUID SESSION = UUID.fromString("00000000-0000-0000-0000-0000000000f5");
    static final UUID CHAR1 = UUID.fromString("00000000-0000-0000-0000-0000000000f6");
    static final UUID CHAR2 = UUID.fromString("00000000-0000-0000-0000-0000000000f7");
    static final UUID SC = UUID.fromString("00000000-0000-0000-0000-0000000000f8");
    static final UUID UPLOAD = UUID.fromString("00000000-0000-0000-0000-000000000011");
    static final UUID IMPORT = UUID.fromString("00000000-0000-0000-0000-000000000012");
    static final UUID VIDEO = UUID.fromString("00000000-0000-0000-0000-000000000021");
    static final UUID CONV = UUID.fromString("00000000-0000-0000-0000-000000000031");
    static final UUID PRACTICE = UUID.fromString("00000000-0000-0000-0000-000000000032");
    static final UUID JOB1 = UUID.fromString("00000000-0000-0000-0000-000000000041");
    static final UUID JOB2 = UUID.fromString("00000000-0000-0000-0000-000000000042");
    static final UUID PS1 = UUID.fromString("00000000-0000-0000-0000-000000000051");
    static final UUID PS2 = UUID.fromString("00000000-0000-0000-0000-000000000052");
    static final UUID PS3 = UUID.fromString("00000000-0000-0000-0000-000000000053");
    static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");

    @BeforeAll
    static void setUp() {
        lab = new ProbeLab("jpql_probe");
        lab.seed(
                "INSERT INTO users(id,email,status,created_at) VALUES ('" + U1 + "','a@acttub.test','active','2026-01-01Z'),"
                        + "('" + U2 + "','team@acttub.test','active','2026-01-02Z'),('" + U3 + "','c@acttub.test','deactivated','2026-01-03Z')",
                "UPDATE users SET deactivated_at='2026-02-01Z' WHERE id='" + U3 + "'",
                "INSERT INTO consent_documents(id,type,locale,version,title,body,published_at) VALUES "
                        + "('" + D1 + "','cloud_voice','ko','v1','t','b','2026-01-01Z'),"
                        + "('" + D2 + "','cloud_voice','ko','v2','t','b','2026-03-01Z'),"
                        + "('" + D3 + "','privacy','ko','v10','t','b','2026-01-01Z')",
                "INSERT INTO user_consents(user_id,document_id,action,occurred_at) VALUES "
                        + "('" + U1 + "','" + D1 + "','granted','2026-01-02Z'),('" + U1 + "','" + D1 + "','revoked','2026-02-02Z'),"
                        + "('" + U1 + "','" + D2 + "','granted','2026-03-02Z'),('" + U1 + "','" + D3 + "','granted','2026-01-02Z'),"
                        + "('" + U2 + "','" + D2 + "','declined','2026-03-03Z')",
                "INSERT INTO ad_events(id,ad_id,day,event,slot,user_id) VALUES "
                        + "(gen_random_uuid(),'" + AD + "','2026-11-01','impression','home','" + U1 + "'),"
                        + "(gen_random_uuid(),'" + AD + "','2026-11-01','impression','home','" + U2 + "'),"
                        + "(gen_random_uuid(),'" + AD + "','2026-11-01','click','home','" + U1 + "'),"
                        + "(gen_random_uuid(),'" + AD + "','2026-11-02','impression','home','" + U1 + "')",
                "INSERT INTO community_categories(id,name,slug) VALUES ('" + POST + "','probe','probe-" + POST + "')",
                "INSERT INTO community_posts(id,author_id,category_id,title,body,comment_count,like_count) VALUES "
                        + "('" + POST + "','" + U1 + "','" + POST + "','t','b',0,0)",
                "INSERT INTO community_post_likes(post_id,user_id) VALUES ('" + POST + "','" + U1 + "'),('" + POST + "','" + U2 + "')",
                "INSERT INTO community_post_images(id,post_id,object_key,sort_order,mime_type,size_bytes,expires_at,uploader_id,uploaded_at) VALUES "
                        + "(gen_random_uuid(),'" + POST + "','img/2',2,'image/jpeg',1,'2027-01-01Z','" + U1 + "',now()),"
                        + "(gen_random_uuid(),'" + POST + "','img/1',1,'image/jpeg',1,'2027-01-01Z','" + U1 + "',now())",
                "INSERT INTO reading_recording_retranscripts(recording_id,status,attempt_count,lease_token,object_key) VALUES "
                        + "('" + REC + "','running',1,'" + LEASE + "','rec/1')",
                "INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,final_like_count,final_eligible,request_fingerprint,request_id) VALUES "
                        + "('" + E1 + "','" + CH + "','" + U1 + "',gen_random_uuid(),'private','visible',5,true,'f',gen_random_uuid()),"
                        + "('" + E2 + "','" + CH + "','" + U2 + "',gen_random_uuid(),'private','visible',3,true,'f',gen_random_uuid()),"
                        + "('" + E3 + "','" + CH + "','" + U3 + "',gen_random_uuid(),'private','visible',5,true,'f',gen_random_uuid()),"
                        + "('" + E4 + "','" + CH + "','" + U1 + "',gen_random_uuid(),'private','visible',1,false,'f',gen_random_uuid())",
                "UPDATE challenge_entries SET mosaic_key='m/1' WHERE id='" + E1 + "'",
                "INSERT INTO entry_likes(id,entry_id,user_id) VALUES (gen_random_uuid(),'" + E1 + "','" + U2 + "'),(gen_random_uuid(),'" + E1 + "','" + U3 + "')",
                "INSERT INTO reading_recordings(id,line_id,user_id,object_key,attempt_no,byte_size,content_type,duration_ms,request_id,transcript_source,reading_session_id) VALUES "
                        + "(gen_random_uuid(),'" + LINE + "','" + U1 + "','rec/a',1,1,'audio/m4a',1,gen_random_uuid(),'none','" + SESSION + "'),"
                        + "(gen_random_uuid(),'" + LINE + "','" + U1 + "','rec/b',2,1,'audio/m4a',1,gen_random_uuid(),'none',NULL)",
                "INSERT INTO upload_intents(id,user_id,object_key,status,expires_at,mime_type,size_bytes,storage_provider) VALUES "
                        + "(gen_random_uuid(),'" + U1 + "','up/1','pending','2026-11-01Z','video/mp4',1,'s3'),"
                        + "(gen_random_uuid(),'" + U1 + "','up/2','pending','2026-11-02Z','video/mp4',1,'s3')",
                "INSERT INTO ai_jobs(id,kind,status,attempt_count,user_id,target_id,request_fingerprint,request_id,created_at) VALUES "
                        + "('" + JOB1 + "','memory_update','pending',0,'" + U1 + "',gen_random_uuid(),'f',gen_random_uuid(),'2026-11-01Z'),"
                        + "('" + JOB2 + "','memory_update','pending',0,'" + U2 + "',gen_random_uuid(),'f',gen_random_uuid(),'2026-11-02Z')",
                "INSERT INTO practices(id,user_id,root_id,blockage_kind,sub_branch,experience_version,ordinal,stage,created_at) VALUES "
                        + "('" + PRACTICE + "','" + U1 + "','" + PRACTICE + "','분석','캐릭터 분석','legacy',1,'conversing','2026-11-23T16:30:00Z')",
                "INSERT INTO coach_conversations(id,practice_id,start_request_id,status,state,closed_at) VALUES "
                        + "('" + CONV + "','" + PRACTICE + "',gen_random_uuid(),'closed','{\"practice_loop\":{\"flow\":\"b\"}}','2026-11-20Z')",
                "INSERT INTO reading_sessions(id,user_id,script_id,my_character_ids,line_results,line_said,advance,mode,record,status,start_line_id,end_line_id,started_at) VALUES "
                        + "('" + SESSION + "','" + U1 + "','" + SCRIPT + "',ARRAY['" + CHAR1 + "','" + CHAR2 + "']::uuid[],"
                        + "'[{\"line_id\":\"" + LINE + "\",\"ok\":true},{\"line_id\":\"" + LINE2 + "\",\"ok\":false}]',"
                        + "'{\"" + LINE + "\":\"a\",\"" + LINE2 + "\":\"b\"}','manual','read',false,'completed','" + LINE + "','" + LINE2 + "','2026-11-01Z'),"
                        + "(gen_random_uuid(),'" + U1 + "','" + SCRIPT + "',ARRAY['" + CHAR1 + "']::uuid[],'[]','{}','manual','read',false,'in_progress','" + LINE + "','" + LINE2 + "','2026-11-02Z')",
                "INSERT INTO script_characters(id,script_id,name,sort_order,member_ids) VALUES "
                        + "('" + SC + "','" + SCRIPT + "','둘',1,ARRAY['" + CHAR1 + "','" + CHAR2 + "']::uuid[])",
                "INSERT INTO script_characters(id,script_id,name,sort_order) VALUES "
                        + "('" + CHAR1 + "','" + SCRIPT + "','햄릿',2),('" + CHAR2 + "','" + SCRIPT + "','오필리어',3)",
                "INSERT INTO scripts(id,user_id,title,raw_text,request_fingerprint,source,updated_at) VALUES "
                        + "('" + SCRIPT + "','" + U1 + "','덴마크 왕자','raw','f','paste','2026-11-03Z'),"
                        + "(gen_random_uuid(),'" + U1 + "','갈매기','raw','f','paste','2026-11-02Z')",
                "INSERT INTO challenges(id,line,work,origin,duration_days,starts_at,ends_at,request_fingerprint,request_id) VALUES "
                        + "('" + CH + "','대사','작품','team',7,'2026-11-01Z','2026-11-08Z','f',gen_random_uuid())",
                "INSERT INTO script_lines(id,script_id,kind,ordinal,text) VALUES ('" + LINE + "','" + SCRIPT + "','direction',1,'x'),('" + LINE2 + "','" + SCRIPT + "','direction',2,'y')",
                "INSERT INTO line_memorization(id,line_id,user_id,status) VALUES (gen_random_uuid(),'" + LINE + "','" + U1 + "','memorized'),(gen_random_uuid(),'" + LINE2 + "','" + U1 + "','not_yet')",
                "INSERT INTO script_uploads(id,user_id,object_key,byte_size,expires_at,raw_text) VALUES ('" + UPLOAD + "','" + U1 + "','s/1',1,'2027-01-01Z','raw')",
                "INSERT INTO script_imports(id,user_id,upload_id,raw_hash,raw_text,request_fingerprint,request_id,source) VALUES "
                        + "('" + IMPORT + "','" + U1 + "','" + UPLOAD + "','h','raw','f',gen_random_uuid(),'file')",
                "INSERT INTO practice_reminder_sends(user_id,day,slot,template_id,kind,skipped_days) VALUES "
                        + "('" + U1 + "','2026-11-01','practice','t1','k',0),('" + U1 + "','2026-11-03','practice','t1','k',0),('" + U1 + "','2026-11-02','practice','t2','k',0)",
                "INSERT INTO user_profiles(user_id) VALUES ('" + U2 + "')",
                "INSERT INTO user_profile_directions(user_id,direction) VALUES ('" + U1 + "','stage'),('" + U1 + "','media')",
                "INSERT INTO videos(id,user_id,object_key,poster_key,byte_size,content_type,duration_ms) VALUES ('" + VIDEO + "','" + U1 + "','v/1','p/1',1,'video/mp4',1)",
                "INSERT INTO practice_sessions(id,user_id,continued_from,blockage_kind,sub_branch,status,goal,situation,character_context,upload_intent_id) VALUES "
                        + "('" + PS1 + "','" + U1 + "',NULL,'분석','캐릭터 분석','analyzed','g','s','c',gen_random_uuid()),"
                        + "('" + PS2 + "','" + U1 + "','" + PS1 + "','분석','캐릭터 분석','analyzed','g','s','c',gen_random_uuid()),"
                        + "('" + PS3 + "','" + U1 + "','" + PS2 + "','분석','캐릭터 분석','analyzed','g','s','c',gen_random_uuid())");
    }

    @AfterAll
    static void report() throws Exception {
        lab.write(Path.of("build/jpql-probe/shape-probe.md"), "SOMA-1112 SQL 모양별 HQL 실험 결과",
                "`JpqlShapeProbeIT`가 만든다. Hibernate 7.4.15.Final, PostgreSQL 18(`postgres:18-alpine`), Flyway 로 세운 스키마.\n"
                        + "시도마다 Hibernate 가 실제로 보낸 SQL(된다) 또는 오류 문구(안 된다)를 그대로 옮긴다. "
                        + "`결과 같음` 은 같은 데이터에서 원본 네이티브 SQL 과 HQL 의 결과 행을 견준 것이다.");
        lab.factory.close();
        lab.previewFactory.close();
        assertThat(MISMATCH).as("관찰과 다른 시도").isEmpty();
    }

    static void check(ProbeLab.Attempt attempt, boolean expectedWorks) {
        if (attempt.works() != expectedWorks) {
            MISMATCH.add(attempt.label() + " 기대=" + expectedWorks + " 실제=" + attempt.works() + " "
                    + (attempt.error() == null ? attempt.sql() : attempt.error()));
        }
    }

    /** 잠금 시도는 오류가 없다고 끝이 아니다 — 보낸 SQL 에 잠금 절이 실제로 있는지 따로 못박는다. */
    static void lock(ProbeLab.Probe probe, ProbeLab.Attempt attempt, boolean expectedLocked) {
        lab.note(probe, attempt.label() + ": 보낸 SQL 의 잠금 절 " + (attempt.locked() ? "있음" : "없음(오류 없이 빠짐)"));
        if (attempt.locked() != expectedLocked) {
            MISMATCH.add(attempt.label() + " 잠금 기대=" + expectedLocked + " 실제=" + attempt.locked() + " " + attempt.sql());
        }
    }

    static void same(ProbeLab.Probe probe, String label, List<List<Object>> nativeRows, List<List<Object>> hqlRows) {
        same(probe, label, true, nativeRows, hqlRows);
    }

    /** 같은 데이터에서 원본과 HQL 의 결과를 견주고 남긴다. expectEqual 은 관찰한 대로 못박는 값이다. */
    static void same(ProbeLab.Probe probe, String label, boolean expectEqual, List<List<Object>> nativeRows,
            List<List<Object>> hqlRows) {
        boolean equal = nativeRows.equals(hqlRows);
        lab.note(probe, "결과 같음(" + label + "): " + (equal ? "예" : "아니오") + " — 네이티브 " + nativeRows + " / HQL " + hqlRows);
        if (equal != expectEqual) {
            MISMATCH.add(probe.id + " 결과 다름 " + label + " native=" + nativeRows + " hql=" + hqlRows);
        }
    }

    static List<List<Object>> hqlRows(String hql, Map<String, Object> parameters) {
        return hqlRows(hql, parameters, false);
    }

    static List<List<Object>> hqlRows(String hql, Map<String, Object> parameters, boolean jsonPreview) {
        try (Session session = (jsonPreview ? lab.previewFactory : lab.factory).openSession()) {
            var transaction = session.beginTransaction();
            try {
                var query = session.createQuery(hql, Tuple.class);
                parameters.forEach(query::setParameter);
                return ProbeLab.rows(query.getResultList());
            } finally {
                transaction.rollback();
            }
        }
    }

    // ── 행 잠금 ───────────────────────────────────────────────────────────────

    @Test
    void p01ForUpdate() {
        var probe = lab.probe("P01", "행 잠금 FOR UPDATE", "PostgresReadingOwnership#reassign#1",
                "SELECT id FROM users WHERE id=:from FOR UPDATE");
        String hql = "select u.id from ProbeUser u where u.id = :from";
        var scalar = lab.attempt(probe, "스칼라 조회 + PESSIMISTIC_WRITE", hql, s -> s.createQuery(hql, UUID.class)
                .setParameter("from", U1).setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList());
        check(scalar, true);
        lock(probe, scalar, true);
        var find = lab.attempt(probe, "엔티티 find + PESSIMISTIC_WRITE", "session.find(ProbeUser.class, id, PESSIMISTIC_WRITE)",
                s -> s.find(ProbeUser.class, U1, LockModeType.PESSIMISTIC_WRITE).id);
        check(find, true);
        lock(probe, find, true);
        var custom = lab.attempt(probe, "같은 조회, 방언의 getForUpdateString 을 ' for update' 로 바꾼 경우", hql,
                s -> s.createQuery(hql, UUID.class).setParameter("from", U1)
                        .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList(), lab.forUpdateFactory);
        check(custom, true);
        lock(probe, custom, true);
        lab.note(probe, "Hibernate 7.4 의 PostgreSQLDialect#getForUpdateString 은 ' for no key update' 를 돌려준다(바이트코드 확인). "
                + "원본의 FOR UPDATE 와 잠금 세기가 다르다 — P37 이 차이를 두 세션으로 보인다.");
    }

    @Test
    void p02ForShare() {
        var probe = lab.probe("P02", "행 잠금 FOR SHARE", "PostgresEntryRepository#attachMosaic#3",
                "SELECT object_key,purged_at FROM videos WHERE id=:id FOR SHARE");
        String hql = "select v.objectKey, v.purgedAt from ProbeVideo v where v.id = :id";
        var share = lab.attempt(probe, "스칼라 조회 + PESSIMISTIC_READ", hql, s -> s.createQuery(hql, Tuple.class)
                .setParameter("id", VIDEO).setLockMode(LockModeType.PESSIMISTIC_READ).getResultList().size());
        check(share, true);
        lock(probe, share, true);
        check(lab.attempt(probe, "엔티티 find + PESSIMISTIC_READ", "session.find(ProbeVideo.class, id, PESSIMISTIC_READ)",
                s -> s.find(ProbeVideo.class, VIDEO, LockModeType.PESSIMISTIC_READ).objectKey), true);
    }

    @Test
    void p03ForUpdateOfAlias() {
        var probe = lab.probe("P03", "조인한 쿼리에서 한 표만 잠금 FOR UPDATE OF", "PostgresActorMemoryStore#appendAvoid#1", """
                SELECT m.value,m.written_by,
                       EXISTS (SELECT 1 FROM actor_memories a WHERE a.user_id=u.id AND a.field='avoid'
                                 AND a.scene_root_id IS NULL AND a.written_by='actor') AS actor_owned
                FROM users u
                LEFT JOIN actor_memories m ON m.user_id=u.id AND m.field='avoid'
                     AND m.scene_root_id IS NOT DISTINCT FROM (SELECT p.root_id FROM practices p WHERE p.id=:practiceId)
                WHERE u.id=:userId AND u.status='active'
                FOR UPDATE OF u
                """);
        String hql = """
                select m.value as value, m.writtenBy as writtenBy,
                       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
                from ProbeUser u
                left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
                     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
                where u.id = :userId and u.status = 'active'
                """;
        var alias = lab.attempt(probe, "별칭 u 에만 PESSIMISTIC_WRITE", hql, s -> s.createQuery(hql, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode("u", LockMode.PESSIMISTIC_WRITE).getResultList().size());
        check(alias, true);
        lock(probe, alias, false);
        var whole = lab.attempt(probe, "쿼리 전체에 PESSIMISTIC_WRITE", hql, s -> s.createQuery(hql, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList().size());
        check(whole, true);
        lock(probe, whole, false);
        String withRoot = hql.replace("select m.value as value,", "select u.id as userIdLocked, m.value as value,");
        var rooted = lab.attempt(probe, "select 절에 u.id 를 더하고 PESSIMISTIC_WRITE", withRoot, s -> s.createQuery(withRoot, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList().size());
        check(rooted, true);
        lock(probe, rooted, false);
        var rootedAlias = lab.attempt(probe, "select 절에 u.id 를 더하고 별칭 u 에만 PESSIMISTIC_WRITE", withRoot, s -> s.createQuery(withRoot, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode("u", LockMode.PESSIMISTIC_WRITE).getResultList().size());
        check(rootedAlias, true);
        lock(probe, rootedAlias, false);
        String entity = """
                select u from ProbeUser u
                left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
                where u.id = :userId and u.status = 'active'
                """;
        var entityLock = lab.attempt(probe, "엔티티 u 를 고르고 left join, PESSIMISTIC_WRITE", entity, s -> s.createQuery(entity, ProbeUser.class)
                .setParameter("userId", U1).setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList().size());
        check(entityLock, true);
        lock(probe, entityLock, true);
        var followOn = lab.attempt(probe, "원래 조회 + follow-on 잠금 강제(Locking.FollowOn.FORCE)", hql, s -> s.createQuery(hql, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE).setFollowOnStrategy(org.hibernate.Locking.FollowOn.FORCE)
                .getResultList().size());
        check(followOn, true);
        lock(probe, followOn, false);
        String inner = withRoot.replace("left join ProbeActorMemory m", "join ProbeActorMemory m");
        var innerLock = lab.attempt(probe, "left join 을 inner join 으로 바꾸고 u.id 를 고름, PESSIMISTIC_WRITE", inner, s -> s.createQuery(inner, Tuple.class)
                .setParameter("practiceId", PRACTICE).setParameter("userId", U1)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList().size());
        check(innerLock, true);
        lock(probe, innerLock, true);
        lab.note(probe, "inner join 이면 잠금 절이 나가지만 'of' 뒤에 조인한 두 표가 다 붙는다(원본은 users 하나만 잡는다). "
                + "left join 이면 루트를 골라도 잠금 절이 오류 없이 빠진다. 엔티티 u 자체를 고르면 잠긴다.");
    }

    @Test
    void p04SkipLocked() {
        var probe = lab.probe("P04", "SKIP LOCKED + ORDER BY + LIMIT", "PostgresVideoRepository#sweepExpiredIntents#1", """
                SELECT id,user_id,object_key FROM upload_intents
                WHERE status='pending' AND expires_at<=:now
                ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED
                """);
        String hql = "select ui from ProbeUploadIntent ui where ui.status = 'pending' and ui.expiresAt <= :now order by ui.expiresAt limit 200";
        var skip = lab.attempt(probe, "엔티티 조회 + PESSIMISTIC_WRITE + lock.timeout=-2(SKIP LOCKED)", hql,
                s -> s.createQuery(hql, ProbeUploadIntent.class).setParameter("now", NOW)
                        .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                        .setHint("jakarta.persistence.lock.timeout", -2).getResultList().size());
        check(skip, true);
        lock(probe, skip, true);
        String scalar = "select ui.id, ui.userId, ui.objectKey from ProbeUploadIntent ui where ui.status = 'pending' and ui.expiresAt <= :now order by ui.expiresAt limit :limit";
        check(lab.attempt(probe, "스칼라 조회 + LIMIT 매개변수 + SKIP LOCKED", scalar,
                s -> s.createQuery(scalar, Tuple.class).setParameter("now", NOW).setParameter("limit", 200)
                        .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                        .setHint("jakarta.persistence.lock.timeout", -2).getResultList().size()), true);
        // 다른 트랜잭션이 잡은 행을 실제로 건너뛰는지: 첫 세션이 가장 이른 행을 잡은 채로 두 번째 세션이 고른다.
        try (Session holder = lab.factory.openSession(); Session picker = lab.factory.openSession()) {
            var first = holder.beginTransaction();
            var held = holder.createQuery(hql.replace("limit 200", "limit 1"), ProbeUploadIntent.class)
                    .setParameter("now", NOW).setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .setHint("jakarta.persistence.lock.timeout", -2).getSingleResult();
            var second = picker.beginTransaction();
            var picked = picker.createQuery(hql, ProbeUploadIntent.class).setParameter("now", NOW)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .setHint("jakarta.persistence.lock.timeout", -2).getResultList();
            lab.note(probe, "두 세션 확인: 첫 세션이 " + held.objectKey + " 를 잡은 동안 둘째 세션은 "
                    + picked.stream().map(intent -> intent.objectKey).toList() + " 만 받았다(잡힌 행을 건너뜀).");
            assertThat(picked).extracting(intent -> intent.objectKey).doesNotContain(held.objectKey);
            second.rollback();
            first.rollback();
        }
    }

    @Test
    void p05ClaimWithCteAndReturning() {
        var probe = lab.probe("P05", "점유: 읽는 CTE(SKIP LOCKED) + UPDATE … RETURNING", "PostgresAiJobLedger#claimNext#1", """
                WITH picked AS (
                    SELECT id FROM ai_jobs
                    WHERE kind=:kind AND (status='pending' OR (:reclaim AND status='running' AND lease_expires_at<:now))
                      AND attempt_count<:maxAttempts
                    ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                UPDATE ai_jobs SET status='running', attempt_count=attempt_count+1, lease_token=:leaseToken,
                       lease_expires_at=:leaseExpiresAt, updated_at=:now
                WHERE id IN (SELECT id FROM picked)
                RETURNING id,user_id,target_id,attempt_count,memory_epoch
                """);
        String cte = """
                with picked as (
                    select j.id as id from ProbeAiJob j
                    where j.kind = :kind and (j.status = 'pending' or (:reclaim = true and j.status = 'running' and j.leaseExpiresAt < :now))
                      and j.attemptCount < :maxAttempts
                    order by j.createdAt, j.id limit 1
                )
                update ProbeAiJob j set j.status = 'running', j.attemptCount = j.attemptCount + 1
                where j.id in (select p.id from picked p)
                """;
        check(lab.attempt(probe, "HQL CTE 뒤에 UPDATE", cte, s -> s.createMutationQuery(cte)
                .setParameter("kind", "memory_update").setParameter("reclaim", false).setParameter("now", NOW)
                .setParameter("maxAttempts", 3).executeUpdate()), false);
        String returning = "update ProbeAiJob j set j.status = 'running' where j.id = :id returning j.id, j.attemptCount";
        check(lab.attempt(probe, "HQL UPDATE … RETURNING", returning, s -> s.createMutationQuery(returning)
                .setParameter("id", JOB1).executeUpdate()), false);
        String pick = """
                select j from ProbeAiJob j
                where j.kind = :kind and (j.status = 'pending' or (:reclaim = true and j.status = 'running' and j.leaseExpiresAt < :now))
                  and j.attemptCount < :maxAttempts
                order by j.createdAt, j.id limit 1
                """;
        check(lab.attempt(probe, "다시 쓰기: 엔티티를 SKIP LOCKED 로 잡고 고쳐서 flush(문장 둘)", pick + "\n-- 이어서 엔티티 필드를 바꾸고 flush", s -> {
            List<ProbeAiJob> jobs = s.createQuery(pick, ProbeAiJob.class).setParameter("kind", "memory_update")
                    .setParameter("reclaim", false).setParameter("now", NOW).setParameter("maxAttempts", 3)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE).setHint("jakarta.persistence.lock.timeout", -2)
                    .getResultList();
            ProbeAiJob job = jobs.getFirst();
            job.status = "running";
            job.attemptCount++;
            job.leaseToken = LEASE;
            job.leaseExpiresAt = NOW.plusSeconds(60);
            job.updatedAt = NOW;
            s.flush();
            return job.id + " attempt=" + job.attemptCount;
        }), true);
    }

    // ── ON CONFLICT ───────────────────────────────────────────────────────────

    @Test
    void p06OnConflictDoNothing() {
        var probe = lab.probe("P06", "INSERT … ON CONFLICT DO NOTHING", "PostgresPortfolioRepository#lockOrCreate#2",
                "INSERT INTO portfolios(user_id) VALUES (:userId) ON CONFLICT (user_id) DO NOTHING");
        String hql = "insert into ProbePortfolio(userId) values (:userId) on conflict(userId) do nothing";
        check(lab.attempt(probe, "HQL insert … on conflict do nothing 를 두 번", hql, s -> {
            int first = s.createMutationQuery(hql).setParameter("userId", U1).executeUpdate();
            int second = s.createMutationQuery(hql).setParameter("userId", U1).executeUpdate();
            return "영향 행 " + first + " 다음 " + second;
        }), true);
    }

    @Test
    void p07OnConflictDoUpdate() {
        var probe = lab.probe("P07", "INSERT … ON CONFLICT DO UPDATE", "PostgresAdFrequency#update#1", """
                INSERT INTO ad_settings(id,window_minutes,window_cap,first_day_cap,updated_at)
                VALUES (1,:minutes,:cap,:firstDay,:now)
                ON CONFLICT (id) DO UPDATE SET window_minutes=:minutes,window_cap=:cap,first_day_cap=:firstDay,updated_at=:now
                """);
        String hql = """
                insert into ProbeAdSettings(id, windowMinutes, windowCap, firstDayCap, updatedAt)
                values (1, :minutes, :cap, :firstDay, :now)
                on conflict(id) do update set windowMinutes = :minutes, windowCap = :cap, firstDayCap = :firstDay, updatedAt = :now
                """;
        check(lab.attempt(probe, "HQL on conflict do update(매개변수)", hql, s -> {
            int first = s.createMutationQuery(hql).setParameter("minutes", 7).setParameter("cap", 2)
                    .setParameter("firstDay", 1).setParameter("now", NOW).executeUpdate();
            int second = s.createMutationQuery(hql).setParameter("minutes", 8).setParameter("cap", 2)
                    .setParameter("firstDay", 1).setParameter("now", NOW).executeUpdate();
            return "영향 행 " + first + " 다음 " + second + ", 값=" + s.createQuery(
                    "select a.windowMinutes from ProbeAdSettings a where a.id = 1", Integer.class).getSingleResult();
        }), true);
        String excluded = """
                insert into ProbeAdSettings(id, windowMinutes, windowCap, firstDayCap, updatedAt)
                values (1, :minutes, :cap, :firstDay, :now)
                on conflict(id) do update set windowMinutes = excluded.windowMinutes, updatedAt = excluded.updatedAt
                """;
        check(lab.attempt(probe, "HQL on conflict do update(excluded)", excluded, s -> s.createMutationQuery(excluded)
                .setParameter("minutes", 9).setParameter("cap", 2).setParameter("firstDay", 1).setParameter("now", NOW)
                .executeUpdate()), true);
    }

    @Test
    void p08OnConflictOnConstraint() {
        var probe = lab.probe("P08", "ON CONFLICT ON CONSTRAINT … DO UPDATE … RETURNING", "AnonymousAliasAllocator#ensureAlias#3", """
                WITH inserted AS (
                    INSERT INTO community_anonymous_aliases (id,post_id,user_id,ordinal)
                    VALUES (:id,:postId,:userId,:ordinal)
                    ON CONFLICT ON CONSTRAINT uq_community_alias_post_user DO UPDATE SET user_id=EXCLUDED.user_id
                    RETURNING ordinal
                )
                SELECT ordinal AS ordinal FROM inserted
                """);
        String hql = """
                insert into ProbeAlias(id, postId, userId, ordinal) values (:id, :postId, :userId, :ordinal)
                on conflict on constraint uq_community_alias_post_user do update set userId = excluded.userId
                """;
        check(lab.attempt(probe, "HQL on conflict on constraint, 이어서 ordinal 을 다시 읽음(문장 둘)", hql, s -> {
            int first = s.createMutationQuery(hql).setParameter("id", UUID.randomUUID()).setParameter("postId", POST)
                    .setParameter("userId", U1).setParameter("ordinal", 1).executeUpdate();
            int second = s.createMutationQuery(hql).setParameter("id", UUID.randomUUID()).setParameter("postId", POST)
                    .setParameter("userId", U1).setParameter("ordinal", 2).executeUpdate();
            Integer ordinal = s.createQuery("select a.ordinal from ProbeAlias a where a.postId = :postId and a.userId = :userId",
                    Integer.class).setParameter("postId", POST).setParameter("userId", U1).getSingleResult();
            return "영향 행 " + first + " 다음 " + second + ", 읽은 ordinal=" + ordinal;
        }), true);
    }

    // ── RETURNING·데이터를 바꾸는 CTE ──────────────────────────────────────────

    @Test
    void p09DeleteReturning() {
        var probe = lab.probe("P09", "데이터를 바꾸는 CTE: DELETE … RETURNING", "PostgresScriptRepository#deleteLine#6",
                "WITH removed AS (DELETE FROM reading_recordings WHERE line_id=:lineId RETURNING object_key) SELECT object_key FROM removed");
        String cte = "with removed as (delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey) select x.objectKey from removed x";
        check(lab.attempt(probe, "HQL CTE 안의 DELETE", cte, s -> s.createQuery(cte, String.class)
                .setParameter("lineId", LINE).getResultList()), false);
        String returning = "delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey";
        check(lab.attempt(probe, "HQL DELETE … RETURNING", returning, s -> s.createMutationQuery(returning)
                .setParameter("lineId", LINE).executeUpdate()), false);
        String select = "select r.objectKey from ProbeReadingRecording r where r.lineId = :lineId";
        String delete = "delete from ProbeReadingRecording r where r.lineId = :lineId";
        check(lab.attempt(probe, "다시 쓰기: 키를 읽고(잠금) 지움(문장 둘)", select + "\n" + delete, s -> {
            List<String> keys = s.createQuery(select, String.class).setParameter("lineId", LINE)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList();
            int deleted = s.createMutationQuery(delete).setParameter("lineId", LINE).executeUpdate();
            return "키 " + keys + ", 지운 행 " + deleted;
        }), true);
        // 문장이 둘로 갈리면 그 사이에 들어온 행은 지워지지만 키가 돌아오지 않는다(READ COMMITTED 에서 문장마다 새 스냅숏).
        try (Session first = lab.factory.openSession(); Session other = lab.factory.openSession()) {
            var tx = first.beginTransaction();
            List<String> keys = first.createQuery(select, String.class).setParameter("lineId", LINE)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList();
            var tx2 = other.beginTransaction();
            other.createNativeQuery("""
                    INSERT INTO reading_recordings(id,line_id,user_id,object_key,attempt_no,byte_size,content_type,duration_ms,request_id,transcript_source)
                    VALUES (gen_random_uuid(),:line,:user,'rec/late',3,1,'audio/m4a',1,gen_random_uuid(),'none')
                    """).setParameter("line", LINE).setParameter("user", U1).executeUpdate();
            tx2.commit();
            int deleted = first.createMutationQuery(delete).setParameter("lineId", LINE).executeUpdate();
            lab.note(probe, "두 세션 확인(문장 둘로 나눈 경우): 읽은 키 " + keys + " 인데 지운 행은 " + deleted
                    + " — 사이에 들어온 rec/late 는 지워졌지만 키를 받지 못했다(저장소 객체가 고아로 남는다). 원본 한 문장은 지운 행의 키를 모두 돌려준다.");
            assertThat(deleted).isEqualTo(keys.size() + 1);
            tx.rollback();
            var cleanup = other.beginTransaction();
            other.createNativeQuery("DELETE FROM reading_recordings WHERE object_key='rec/late'").executeUpdate();
            cleanup.commit();
        }
    }

    @Test
    void p10UpsertReturningGeneratedId() {
        var probe = lab.probe("P10", "INSERT … SELECT … WHERE NOT EXISTS … ON CONFLICT DO UPDATE … RETURNING id(DB 생성 ID)",
                "PostgresPushTokenRepository#register#2", """
                WITH registered AS (
                    INSERT INTO push_tokens(user_id,token,platform,locale,app_version)
                    SELECT :userId,:token,:platform,:locale,:appVersion
                    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id=:userId
                                        AND NOT notify_analysis_done AND NOT notify_challenge AND NOT notify_evening_reminder)
                    ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform,
                        locale=EXCLUDED.locale, app_version=EXCLUDED.app_version, updated_at=now()
                    RETURNING id
                )
                SELECT id FROM registered
                """);
        String noId = """
                insert into ProbePushToken(userId, token, platform, locale, appVersion)
                select :userId, :token, :platform, :locale, :appVersion
                where not exists (select 1 from ProbeUserProfile p where p.userId = :userId
                                    and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false)
                on conflict(token) do update set userId = excluded.userId, platform = excluded.platform,
                    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
                """;
        check(lab.attempt(probe, "HQL insert … select(FROM 없음, id 를 DB 기본값에 맡김)", noId, s -> s.createMutationQuery(noId)
                .setParameter("userId", U1).setParameter("token", "tok-1").setParameter("platform", "ios")
                .setParameter("locale", "ko").setParameter("appVersion", "1.0").executeUpdate()), false);
        String withId = noId.replace("insert into ProbePushToken(userId,", "insert into ProbePushToken(id, userId,")
                .replace("select :userId,", "select :id, :userId,");
        check(lab.attempt(probe, "다시 쓰기: id 를 앱이 넘기고, 이어서 token 으로 id 를 읽음(문장 둘)", withId, s -> {
            int first = s.createMutationQuery(withId).setParameter("id", UUID.randomUUID()).setParameter("userId", U1)
                    .setParameter("token", "tok-1").setParameter("platform", "ios").setParameter("locale", "ko")
                    .setParameter("appVersion", "1.0").executeUpdate();
            UUID kept = s.createQuery("select t.id from ProbePushToken t where t.token = :token", UUID.class)
                    .setParameter("token", "tok-1").getSingleResult();
            int second = s.createMutationQuery(withId).setParameter("id", UUID.randomUUID()).setParameter("userId", U2)
                    .setParameter("token", "tok-1").setParameter("platform", "android").setParameter("locale", "en")
                    .setParameter("appVersion", "1.1").executeUpdate();
            UUID after = s.createQuery("select t.id from ProbePushToken t where t.token = :token", UUID.class)
                    .setParameter("token", "tok-1").getSingleResult();
            return "영향 행 " + first + "·" + second + ", 충돌 뒤에도 id 유지=" + kept.equals(after);
        }), false);
        String onConstraint = withId.replace("on conflict(token)", "on conflict on constraint push_tokens_token_key");
        check(lab.attempt(probe, "insert … select + on conflict on constraint(제약 이름)", onConstraint, s -> s.createMutationQuery(onConstraint)
                .setParameter("id", UUID.randomUUID()).setParameter("userId", U1).setParameter("token", "tok-2")
                .setParameter("platform", "ios").setParameter("locale", "ko").setParameter("appVersion", "1.0")
                .executeUpdate()), false);
        lab.note(probe, "insert … select 에 on conflict … do update 를 붙이면 충돌 대상을 열 이름으로 주든 제약 이름으로 주든 "
                + "Hibernate 가 set 절의 경로를 풀지 못했다. insert … values … do update(P07)와 insert … select … do nothing(P22)은 된다.");
        String toggles = """
                select count(*) from ProbeUserProfile p where p.userId = :userId
                  and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false
                """;
        String values = """
                insert into ProbePushToken(id, userId, token, platform, locale, appVersion)
                values (:id, :userId, :token, :platform, :locale, :appVersion)
                on conflict(token) do update set userId = excluded.userId, platform = excluded.platform,
                    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
                """;
        check(lab.attempt(probe, "다시 쓰기: 토글을 따로 읽고 insert … values … on conflict(token), 이어서 id 를 읽음(문장 셋)",
                toggles + "\n" + values, s -> {
                    long off = s.createQuery(toggles, Long.class).setParameter("userId", U1).getSingleResult();
                    int changed = off > 0 ? 0 : s.createMutationQuery(values).setParameter("id", UUID.randomUUID())
                            .setParameter("userId", U1).setParameter("token", "tok-3").setParameter("platform", "ios")
                            .setParameter("locale", "ko").setParameter("appVersion", "1.0").executeUpdate();
                    UUID id = s.createQuery("select t.id from ProbePushToken t where t.token = :token", UUID.class)
                            .setParameter("token", "tok-3").getSingleResult();
                    return "영향 행 " + changed + ", id=" + id;
                }), true);
    }

    // ── CTE ───────────────────────────────────────────────────────────────────

    @Test
    void p11ReadOnlyCteFilterAny() {
        String sql = """
                WITH team AS (
                  SELECT id FROM users
                  WHERE lower(btrim(COALESCE(email, ''))) = ANY(string_to_array(:teamEmails, ','))
                     OR left(md5(CAST(id AS text)), 8) = ANY(string_to_array(:teamActors, ','))
                )
                SELECT count(*) AS users, count(*) FILTER (WHERE u.id IN (SELECT id FROM team)) AS team
                FROM users AS u
                WHERE u.created_at < CAST(:cutoff AS timestamptz) AND u.deactivated_at IS NULL AND u.retention_purged_at IS NULL
                """;
        var probe = lab.probe("P11", "읽기만 하는 CTE + FILTER + = ANY(string_to_array)", "PostgresBillingAdminReader#signedUpBefore#1", sql);
        String hql = """
                with team as (
                  select u.id as id from ProbeUser u
                  where lower(trim(coalesce(u.email, ''))) in :teamEmails
                     or left(cast(md5(cast(u.id as String)) as String), 8) in :teamActors
                )
                select count(*) as users, count(*) filter (where u.id in (select t.id from team t)) as team
                from ProbeUser u
                where u.createdAt < :cutoff and u.deactivatedAt is null and u.retentionPurgedAt is null
                """;
        Map<String, Object> hqlParams = Map.of("teamEmails", List.of("team@acttub.test"), "teamActors", List.of("zzzzzzzz"),
                "cutoff", NOW);
        String bare = hql.replace("left(cast(md5(cast(u.id as String)) as String), 8)", "left(md5(cast(u.id as String)), 8)");
        check(lab.attempt(probe, "HQL md5() 를 그대로 씀", bare, s -> {
            var query = s.createQuery(bare, Tuple.class);
            hqlParams.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), false);
        check(lab.attempt(probe, "HQL with … select, md5 를 문자열로 cast, 목록은 Java 에서 나눈 List 로", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            hqlParams.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), true);
        same(probe, "시드", lab.nativeRows(sql, Map.of("teamEmails", "team@acttub.test", "teamActors", "zzzzzzzz",
                "cutoff", NOW.atOffset(ZoneOffset.UTC))), hqlRows(hql, hqlParams));
    }

    @Test
    void p12RecursiveCte() {
        String sql = """
                WITH RECURSIVE chain(id, root_id, ordinal) AS (
                    SELECT ps.id, ps.id, 1 FROM practice_sessions ps WHERE ps.continued_from IS NULL
                    UNION ALL
                    SELECT child.id, chain.root_id, chain.ordinal + 1
                    FROM practice_sessions child JOIN chain ON child.continued_from = chain.id
                    WHERE chain.ordinal < 100
                )
                SELECT id, root_id, ordinal FROM chain ORDER BY ordinal
                """;
        var probe = lab.probe("P12", "WITH RECURSIVE", "PostgresLegacyPracticeReader#find#1(앞부분)", sql);
        String hql = """
                with chain as (
                    select ps.id as id, ps.id as rootId, 1 as ordinal from ProbePracticeSession ps where ps.continuedFrom is null
                    union all
                    select child.id as id, c.rootId as rootId, c.ordinal + 1 as ordinal
                    from ProbePracticeSession child join chain c on child.continuedFrom = c.id
                    where c.ordinal < 100
                )
                select c.id, c.rootId, c.ordinal from chain c order by c.ordinal
                """;
        check(lab.attempt(probe, "HQL 재귀 CTE(자기 참조)", hql, s -> ProbeLab.rows(s.createQuery(hql, Tuple.class).getResultList())), true);
        same(probe, "시드 사슬 셋", lab.nativeRows(sql, Map.of()), hqlRows(hql, Map.of()));
        lab.note(probe, "practice_sessions 는 CONTRACT §5-1 이 매핑을 은퇴시킨 표다. HQL 로 옮기려면 은퇴한 매핑을 되살려야 한다.");
    }

    // ── JSON ──────────────────────────────────────────────────────────────────

    @Test
    void p13JsonReadOperators() {
        String sql = """
                SELECT count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='b') AS b,
                       count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='a') AS a
                FROM practices p JOIN coach_conversations c ON c.practice_id=p.id
                WHERE p.user_id=:userId AND p.id<>:practiceId
                """;
        var probe = lab.probe("P13", "JSON 읽기 ->·->>", "PostgresCoachFlows#assign#2", sql);
        String hql = """
                select count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'b') as b,
                       count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'a') as a
                from ProbePractice p join ProbeCoachConversation c on c.practiceId = p.id
                where p.userId = :userId and p.id <> :practiceId
                """;
        Map<String, Object> params = Map.of("userId", U1, "practiceId", UUID.randomUUID());
        check(lab.attempt(probe, "HQL json_value(앱 설정 그대로)", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            params.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), false);
        check(lab.attempt(probe, "HQL json_value", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            params.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }, true), true);
        same(probe, "시드(flow=b 하나)", lab.nativeRows(sql, params), hqlRows(hql, params, true));
        String fragment = """
                select count(*) filter (where cast(sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) as String) = 'b') as b,
                       count(*) filter (where cast(sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) as String) = 'a') as a
                from ProbePractice p join ProbeCoachConversation c on c.practiceId = p.id
                where p.userId = :userId and p.id <> :practiceId
                """;
        check(lab.attempt(probe, "HQL sql() 조각으로 ->> 를 그대로", fragment, s -> {
            var query = s.createQuery(fragment, Tuple.class);
            params.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), true);
        same(probe, "sql() 조각", lab.nativeRows(sql, params), hqlRows(fragment, params));
    }

    @Test
    void p14JsonWriteAndEdit() {
        var probe = lab.probe("P14", "JSON 쓰기: CAST(:x AS jsonb), 배열 원소 거르기, 키 지우기(jsonb - key)",
                "PostgresConversationRepository#saveLineNotes#1 · PostgresScriptRepository#deleteLine#5", """
                UPDATE coach_notes SET line_notes=CAST(:lineNotes AS jsonb) WHERE conversation_id=CAST(:conversationId AS uuid)
                --
                UPDATE reading_sessions
                SET line_results=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(line_results) e
                                           WHERE e->>'line_id'<>CAST(:lineId AS text)), '[]'::jsonb),
                    line_said=line_said-CAST(:lineId AS text)
                WHERE script_id=:scriptId
                """);
        String write = "update ProbeCoachNote n set n.lineNotes = :lineNotes where n.conversationId = :conversationId";
        check(lab.attempt(probe, "HQL update 에 JsonNode 매개변수", write, s -> s.createMutationQuery(write)
                .setParameter("lineNotes", JSON.readTree("[{\"line\":1}]")).setParameter("conversationId", CONV)
                .executeUpdate()), true);
        String remove = "update ProbeReadingSession s set s.lineSaid = json_remove(s.lineSaid, :path) where s.scriptId = :scriptId";
        check(lab.attempt(probe, "HQL json_remove 로 키 지우기", remove, s -> {
            int changed = s.createMutationQuery(remove).setParameter("path", "$.\"" + LINE + "\"")
                    .setParameter("scriptId", SCRIPT).executeUpdate();
            s.clear();
            return changed + "행, 남은 값=" + s.find(ProbeReadingSession.class, SESSION).lineSaid;
        }), true);
        String filter = """
                update ProbeReadingSession s
                set s.lineResults = coalesce(json_query(s.lineResults, '$[*] ? (@.line_id != $id)' passing :lineId as id with wrapper), '[]')
                where s.scriptId = :scriptId
                """;
        check(lab.attempt(probe, "HQL json_query 로 배열 원소 거르기(앱 설정 그대로)", filter, s -> s.createMutationQuery(filter)
                .setParameter("lineId", LINE.toString()).setParameter("scriptId", SCRIPT).executeUpdate()), false);
        check(lab.attempt(probe, "HQL json_query 로 배열 원소 거르기", filter, s -> {
            int changed = s.createMutationQuery(filter).setParameter("lineId", LINE.toString())
                    .setParameter("scriptId", SCRIPT).executeUpdate();
            s.clear();
            return changed + "행, 남은 값=" + s.find(ProbeReadingSession.class, SESSION).lineResults;
        }, true), true);
        // 원본과 같은 값을 남기는지(같은 행을 원본 SQL 로 고친 값과 비교)
        String nativeEdit = """
                SELECT CAST(COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(line_results) e
                                       WHERE e->>'line_id'<>CAST(:lineId AS text)), '[]'::jsonb) AS text) AS results,
                       CAST(line_said-CAST(:lineId AS text) AS text) AS said
                FROM reading_sessions WHERE id=:id
                """;
        String hqlEdit = """
                select cast(coalesce(json_query(s.lineResults, '$[*] ? (@.line_id != $id)' passing :lineId as id with wrapper), '[]') as String) as results,
                       cast(json_remove(s.lineSaid, :path) as String) as said
                from ProbeReadingSession s where s.id = :sid
                """;
        lab.note(probe, "json_remove 에 따옴표로 감싼 키 경로($.\"<uuid>\")를 주면 Hibernate 가 따옴표째 키로 바꿔(#- array['\"…\"']) "
                + "오류 없이 아무것도 지우지 않는다. UUID 처럼 '-' 가 든 키는 따옴표 없이 쓸 수 없다.");
        same(probe, "시드 회차 하나", false, lab.nativeRows(nativeEdit, Map.of("lineId", LINE.toString(), "id", SESSION)),
                hqlRows(hqlEdit, Map.of("lineId", LINE.toString(), "path", "$.\"" + LINE + "\"", "sid", SESSION), true));
    }

    // ── LATERAL·FILTER·DISTINCT ON·창 함수 ─────────────────────────────────────

    @Test
    void p15Lateral() {
        String sql = """
                SELECT last_decision.action
                FROM (SELECT id FROM consent_documents WHERE type='cloud_voice' AND locale='ko'
                      ORDER BY published_at DESC,id DESC LIMIT 1) current_document
                LEFT JOIN LATERAL (SELECT action FROM user_consents
                                   WHERE user_id=:userId AND document_id=current_document.id
                                   ORDER BY occurred_at DESC,id DESC LIMIT 1) last_decision ON true
                """;
        var probe = lab.probe("P15", "LEFT JOIN LATERAL + FROM 절 서브쿼리", "PostgresCloudVoiceRepository#consent#2", sql);
        String hql = """
                select ld.action as action
                from (select d.id as id from ProbeConsentDocument d where d.type = 'cloud_voice' and d.locale = 'ko'
                      order by d.publishedAt desc, d.id desc limit 1) cd
                left join lateral (select c.action as action from ProbeUserConsent c
                                   where c.userId = :userId and c.documentId = cd.id
                                   order by c.occurredAt desc, c.id desc limit 1) ld on true
                """;
        check(lab.attempt(probe, "HQL join lateral", hql, s -> ProbeLab.rows(s.createQuery(hql, Tuple.class)
                .setParameter("userId", U1).getResultList())), true);
        same(probe, "U1", lab.nativeRows(sql, Map.of("userId", U1)), hqlRows(hql, Map.of("userId", U1)));
        same(probe, "U2", lab.nativeRows(sql, Map.of("userId", U2)), hqlRows(hql, Map.of("userId", U2)));
    }

    @Test
    void p16Filter() {
        String sql = """
                SELECT CAST(day AS text) AS day,
                       count(*) FILTER (WHERE event='impression') AS impressions,
                       count(*) FILTER (WHERE event='click') AS clicks
                FROM ad_events WHERE ad_id=:id AND day BETWEEN :from AND :to
                GROUP BY day ORDER BY day
                """;
        var probe = lab.probe("P16", "집계 FILTER + GROUP BY + CAST(date AS text)", "PostgresAdRepository#dailyEvents#1", sql);
        String hql = """
                select cast(e.day as String) as day,
                       count(*) filter (where e.event = 'impression') as impressions,
                       count(*) filter (where e.event = 'click') as clicks
                from ProbeAdEvent e where e.adId = :id and e.day between :from and :to
                group by e.day order by e.day
                """;
        Map<String, Object> params = Map.of("id", AD, "from", LocalDate.parse("2026-11-01"), "to", LocalDate.parse("2026-11-30"));
        check(lab.attempt(probe, "HQL count(*) filter", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            params.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), true);
        same(probe, "시드 이틀", lab.nativeRows(sql, params), hqlRows(hql, params));
    }

    @Test
    void p17DistinctOn() {
        String sql = """
                SELECT DISTINCT ON(document_id) id,user_id,document_id,action,occurred_at
                FROM user_consents WHERE user_id=:userId
                ORDER BY document_id,occurred_at DESC,id DESC
                """;
        var probe = lab.probe("P17", "DISTINCT ON", "PostgresConsentRepository#currentConsentsOf#1", sql);
        String direct = """
                select distinct on (c.documentId) c.id, c.userId, c.documentId, c.action, c.occurredAt
                from ProbeUserConsent c where c.userId = :userId order by c.documentId, c.occurredAt desc, c.id desc
                """;
        check(lab.attempt(probe, "HQL distinct on", direct, s -> s.createQuery(direct, Tuple.class)
                .setParameter("userId", U1).getResultList()), false);
        String window = """
                select x.id, x.userId, x.documentId, x.action, x.occurredAt
                from (select c.id as id, c.userId as userId, c.documentId as documentId, c.action as action,
                             c.occurredAt as occurredAt,
                             row_number() over (partition by c.documentId order by c.occurredAt desc, c.id desc) as rn
                      from ProbeUserConsent c where c.userId = :userId) x
                where x.rn = 1 order by x.documentId
                """;
        check(lab.attempt(probe, "다시 쓰기: row_number() over(partition by) = 1", window, s -> ProbeLab.rows(
                s.createQuery(window, Tuple.class).setParameter("userId", U1).getResultList())), true);
        same(probe, "U1 문서 셋", lab.nativeRows(sql, Map.of("userId", U1)), hqlRows(window, Map.of("userId", U1)));
    }

    @Test
    void p18WindowInUpdateFrom() {
        String sql = """
                UPDATE challenge_entries e SET final_rank=ranked.position,updated_at=:now
                FROM (SELECT id,rank() OVER (ORDER BY final_like_count DESC) AS position
                      FROM challenge_entries WHERE challenge_id=:id AND final_eligible AND status='visible') ranked
                WHERE e.id=ranked.id
                """;
        var probe = lab.probe("P18", "창 함수 rank() OVER + UPDATE … FROM (서브쿼리)", "ChallengeSettlement#confirm#2", sql);
        String hql = """
                update ProbeEntry e
                set e.finalRank = (select r.position from (select x.id as id, rank() over (order by x.finalLikeCount desc) as position
                                                           from ProbeEntry x
                                                           where x.challengeId = :id and x.finalEligible = true and x.status = 'visible') r
                                   where r.id = e.id),
                    e.updatedAt = :now
                where e.challengeId = :id and e.finalEligible = true and e.status = 'visible'
                """;
        String ranks = "SELECT id, final_rank FROM challenge_entries WHERE challenge_id=:id ORDER BY id";
        var nativeRanks = new ArrayList<List<Object>>();
        try (Session session = lab.factory.openSession()) {
            var tx = session.beginTransaction();
            session.createNativeQuery(sql).setParameter("now", NOW.atOffset(ZoneOffset.UTC)).setParameter("id", CH).executeUpdate();
            nativeRanks.addAll(ProbeLab.rows(session.createNativeQuery(ranks, Tuple.class).setParameter("id", CH).getResultList()));
            tx.rollback();
        }
        var hqlRanks = new ArrayList<List<Object>>();
        check(lab.attempt(probe, "HQL update set = (FROM 절 서브쿼리 안의 창 함수)", hql, s -> {
            int changed = s.createMutationQuery(hql).setParameter("now", NOW).setParameter("id", CH).executeUpdate();
            hqlRanks.addAll(ProbeLab.rows(s.createNativeQuery(ranks, Tuple.class).setParameter("id", CH).getResultList()));
            return changed + "행";
        }), true);
        same(probe, "참여작 넷(공동 1위 둘)", nativeRanks, hqlRanks);
    }

    // ── 배열 ──────────────────────────────────────────────────────────────────

    @Test
    void p19Arrays() {
        var probe = lab.probe("P19", "배열: = ANY(CAST(:ids AS uuid[])) · unnest · array_to_string",
                "PostgresCommunityRepository#withImages#1 · PostgresReadingVoiceMaterials#material#2 · PostgresSessionRepository#start#3", """
                SELECT id AS id, post_id AS post_id, object_key AS object_key FROM community_post_images
                WHERE post_id = ANY (CAST(:ids AS uuid[])) ORDER BY post_id, sort_order
                --
                SELECT unnest(my_character_ids) AS id FROM reading_sessions WHERE id=:readingSessionId
                --
                SELECT id,array_to_string(member_ids,:sep) AS member_ids FROM script_characters WHERE script_id=:scriptId
                """);
        String in = "select i.objectKey from ProbePostImage i where i.postId in :ids order by i.postId, i.sortOrder";
        check(lab.attempt(probe, "IN 목록 매개변수(List)", in, s -> s.createQuery(in, String.class)
                .setParameter("ids", List.of(POST, UUID.randomUUID(), UUID.randomUUID())).getResultList()), true);
        String contains = "select i.objectKey from ProbePostImage i where array_contains(:ids, i.postId) order by i.postId, i.sortOrder";
        check(lab.attempt(probe, "array_contains(배열 매개변수 하나)", contains, s -> s.createQuery(contains, String.class)
                .setParameter("ids", new UUID[] {POST, UUID.randomUUID()}).getResultList()), true);
        String unnest = "select e from ProbeReadingSession s join unnest(s.myCharacterIds) e where s.id = :id";
        check(lab.attempt(probe, "HQL join unnest(집합 반환 함수)", unnest, s -> s.createQuery(unnest, Object.class)
                .setParameter("id", SESSION).getResultList()), false);
        String lateral = "select e from ProbeReadingSession s join lateral unnest(s.myCharacterIds) e where s.id = :id";
        check(lab.attempt(probe, "HQL join lateral unnest(집합 반환 함수)", lateral, s -> s.createQuery(lateral, Object.class)
                .setParameter("id", SESSION).getResultList()), true);
        check(lab.attempt(probe, "엔티티로 읽고 배열을 Java 에서 펼침", "session.find(ProbeReadingSession.class, id).myCharacterIds",
                s -> List.of(s.find(ProbeReadingSession.class, SESSION).myCharacterIds)), true);
        String toString = "select c.id, array_to_string(c.memberIds, :sep) from ProbeScriptCharacter c where c.scriptId = :scriptId";
        check(lab.attempt(probe, "HQL array_to_string", toString, s -> ProbeLab.rows(s.createQuery(toString, Tuple.class)
                .setParameter("sep", ",").setParameter("scriptId", SCRIPT).getResultList())), true);
        same(probe, "array_to_string", lab.nativeRows(
                "SELECT id,array_to_string(member_ids,:sep) AS member_ids FROM script_characters WHERE script_id=:scriptId",
                Map.of("sep", ",", "scriptId", SCRIPT)), hqlRows(toString, Map.of("sep", ",", "scriptId", SCRIPT)));
        same(probe, "unnest", lab.nativeRows("SELECT unnest(my_character_ids) AS id FROM reading_sessions WHERE id=:id",
                Map.of("id", SESSION)), hqlRows(lateral, Map.of("id", SESSION)));
    }

    // ── 여러 표 UPDATE·DELETE, INSERT … SELECT ─────────────────────────────────

    @Test
    void p20UpdateFrom() {
        String sql = """
                UPDATE script_uploads u SET script_id=:scriptId,raw_text=NULL,updated_at=:now
                FROM script_imports i WHERE i.id=:importId AND u.id=i.upload_id AND u.script_id IS NULL
                """;
        var probe = lab.probe("P20", "UPDATE … FROM 다른 표", "PostgresScriptImportRepository#linkUpload#1", sql);
        String direct = "update ProbeScriptUpload u set u.scriptId = :scriptId from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId";
        check(lab.attempt(probe, "HQL update … from", direct, s -> s.createMutationQuery(direct)
                .setParameter("scriptId", SCRIPT).setParameter("importId", IMPORT).executeUpdate()), false);
        String exists = """
                update ProbeScriptUpload u set u.scriptId = :scriptId, u.rawText = null, u.updatedAt = :now
                where u.scriptId is null and exists (select 1 from ProbeScriptImport i where i.id = :importId and i.uploadId = u.id)
                """;
        check(lab.attempt(probe, "다시 쓰기: where exists(상관 서브쿼리)", exists, s -> s.createMutationQuery(exists)
                .setParameter("scriptId", SCRIPT).setParameter("now", NOW).setParameter("importId", IMPORT)
                .executeUpdate() + "행"), true);
    }

    @Test
    void p21DeleteUsing() {
        String sql = "DELETE FROM line_memorization m USING script_lines l WHERE l.id=m.line_id AND l.script_id=:scriptId";
        var probe = lab.probe("P21", "DELETE … USING 다른 표", "PostgresScriptRepository#delete#4", sql);
        String direct = "delete from ProbeLineMemorization m using ProbeScriptLine l where l.id = m.lineId and l.scriptId = :scriptId";
        check(lab.attempt(probe, "HQL delete … using", direct, s -> s.createMutationQuery(direct)
                .setParameter("scriptId", SCRIPT).executeUpdate()), false);
        String in = "delete from ProbeLineMemorization m where m.lineId in (select l.id from ProbeScriptLine l where l.scriptId = :scriptId)";
        check(lab.attempt(probe, "다시 쓰기: where … in (서브쿼리)", in, s -> s.createMutationQuery(in)
                .setParameter("scriptId", SCRIPT).executeUpdate() + "행"), true);
    }

    @Test
    void p22InsertSelectOnConflict() {
        var probe = lab.probe("P22", "INSERT … SELECT … ON CONFLICT DO NOTHING", "PostgresAuthRepository#recordActiveDay#1",
                "INSERT INTO user_active_days(user_id,day) SELECT id,:day FROM users WHERE id=:userId AND deactivated_at IS NULL ON CONFLICT DO NOTHING");
        String hql = """
                insert into ProbeUserActiveDay(userId, day)
                select u.id, :day from ProbeUser u where u.id = :userId and u.deactivatedAt is null
                on conflict do nothing
                """;
        check(lab.attempt(probe, "HQL insert … select … on conflict do nothing 를 두 번", hql, s -> {
            int first = s.createMutationQuery(hql).setParameter("day", LocalDate.parse("2026-11-24"))
                    .setParameter("userId", U1).executeUpdate();
            int second = s.createMutationQuery(hql).setParameter("day", LocalDate.parse("2026-11-24"))
                    .setParameter("userId", U1).executeUpdate();
            return "영향 행 " + first + " 다음 " + second;
        }), true);
        String batch = """
                insert into ProbeUserActiveDay(userId, day)
                select u.id, :day from ProbeUser u where u.deactivatedAt is null order by u.createdAt, u.id limit :batch
                on conflict do nothing
                """;
        check(lab.attempt(probe, "HQL insert … select … order by … limit :batch … on conflict do nothing", batch, s -> s.createMutationQuery(batch)
                .setParameter("day", LocalDate.parse("2026-11-25")).setParameter("batch", 1).executeUpdate() + "행"), true);
    }

    // ── 함수·연산자 ───────────────────────────────────────────────────────────

    @Test
    void p23Regex() {
        String sql = """
                SELECT EXISTS (SELECT 1 FROM consent_documents pd
                        WHERE pd.type='privacy'
                          AND (CASE WHEN pd.version ~ '^v[0-9]+$' THEN CAST(substring(pd.version FROM 2) AS integer) ELSE 0 END) >= 9
                          AND (SELECT pc.action FROM user_consents pc
                               WHERE pc.user_id=:userId AND pc.document_id=pd.id
                               ORDER BY pc.occurred_at DESC,pc.id DESC LIMIT 1)='granted') AS covered
                """;
        var probe = lab.probe("P23", "정규식 ~ · substring FROM · 스칼라 서브쿼리 LIMIT 1 · FROM 없는 SELECT",
                "PostgresCloudVoiceRepository#consent#1", sql);
        String hql = """
                select exists (select 1 from ProbeConsentDocument pd
                        where pd.type = 'privacy'
                          and (case when regexp_like(pd.version, '^v[0-9]+$') then cast(substring(pd.version, 2) as Integer) else 0 end) >= 9
                          and (select pc.action from ProbeUserConsent pc
                               where pc.userId = :userId and pc.documentId = pd.id
                               order by pc.occurredAt desc, pc.id desc limit 1) = 'granted') as covered
                """;
        check(lab.attempt(probe, "HQL regexp_like, FROM 없는 select exists", hql, s -> ProbeLab.rows(
                s.createQuery(hql, Tuple.class).setParameter("userId", U1).getResultList())), true);
        same(probe, "U1(v10 동의)", lab.nativeRows(sql, Map.of("userId", U1)), hqlRows(hql, Map.of("userId", U1)));
        same(probe, "U2(동의 없음)", lab.nativeRows(sql, Map.of("userId", U2)), hqlRows(hql, Map.of("userId", U2)));
        String replace = "select regexp_replace(pd.version, '[0-9]', '#', 'g') from ProbeConsentDocument pd where pd.id = :id";
        check(lab.attempt(probe, "regexp_replace(등록되지 않은 함수를 이름으로 부름)", replace, s -> s.createQuery(replace, Object.class)
                .setParameter("id", D3).getResultList()), true);
    }

    @Test
    void p24OrderedStringAgg() {
        String sql = """
                SELECT (SELECT string_agg(direction, ',' ORDER BY CASE direction WHEN 'media' THEN 1 WHEN 'stage' THEN 2 END)
                        FROM user_profile_directions WHERE user_profile_directions.user_id=users.id) AS directions
                FROM users WHERE users.id=:id
                """;
        var probe = lab.probe("P24", "string_agg(… ORDER BY …)", "PostgresProfileRepository#find#1(부분)", sql);
        String hql = """
                select (select listagg(d.direction, ',') within group (order by case d.direction when 'media' then 1 when 'stage' then 2 end)
                        from ProbeProfileDirection d where d.userId = u.id) as directions
                from ProbeUser u where u.id = :id
                """;
        check(lab.attempt(probe, "HQL listagg … within group", hql, s -> ProbeLab.rows(s.createQuery(hql, Tuple.class)
                .setParameter("id", U1).getResultList())), true);
        same(probe, "방향 둘", lab.nativeRows(sql, Map.of("id", U1)), hqlRows(hql, Map.of("id", U1)));
    }

    @Test
    void p25ConditionalUpdateRowCount() {
        var probe = lab.probe("P25", "조건부 UPDATE 의 영향 행 수 + GREATEST + 열 증감", "PostgresRetranscribeRepository#release#1", """
                UPDATE reading_recording_retranscripts
                SET status='queued', attempt_count=GREATEST(attempt_count-1,0), lease_token=NULL, lease_until=NULL,
                    updated_at=CAST(:now AS timestamptz)
                WHERE recording_id=:id AND lease_token=:token AND status='running'
                """);
        String hql = """
                update ProbeRetranscript r
                set r.status = 'queued', r.attemptCount = greatest(r.attemptCount - 1, 0), r.leaseToken = null,
                    r.leaseUntil = null, r.updatedAt = :now
                where r.recordingId = :id and r.leaseToken = :token and r.status = 'running'
                """;
        check(lab.attempt(probe, "HQL update 를 두 번(두 번째는 조건이 안 맞음)", hql, s -> {
            int first = s.createMutationQuery(hql).setParameter("now", NOW).setParameter("id", REC)
                    .setParameter("token", LEASE).executeUpdate();
            int second = s.createMutationQuery(hql).setParameter("now", NOW).setParameter("id", REC)
                    .setParameter("token", LEASE).executeUpdate();
            return "영향 행 " + first + " 다음 " + second;
        }), true);
        // 두 트랜잭션이 같은 행을 두고 다툴 때: 먼저 커밋한 쪽이 1, 나중 쪽은 조건을 다시 보고 0 을 받는다.
        try (Session a = lab.factory.openSession(); Session b = lab.factory.openSession()) {
            var txA = a.beginTransaction();
            int winner = a.createMutationQuery(hql).setParameter("now", NOW).setParameter("id", REC)
                    .setParameter("token", LEASE).executeUpdate();
            var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
            var loser = executor.submit(() -> {
                var txB = b.beginTransaction();
                int changed = b.createMutationQuery(hql).setParameter("now", NOW).setParameter("id", REC)
                        .setParameter("token", LEASE).executeUpdate();
                txB.rollback();
                return changed;
            });
            Thread.sleep(300);
            boolean blocked = !loser.isDone();
            txA.commit();
            int late = loser.get();
            executor.shutdown();
            lab.note(probe, "두 트랜잭션 확인: 먼저 고친 쪽 " + winner + "행, 다른 쪽은 커밋을 기다렸다(" + blocked + ") 조건을 다시 보고 "
                    + late + "행 — JPQL UPDATE 한 문장이 승자 판정을 지킨다.");
            assertThat(winner).isEqualTo(1);
            assertThat(late).isZero();
            var restore = a.beginTransaction();
            a.createNativeQuery("UPDATE reading_recording_retranscripts SET status='running',attempt_count=1,lease_token=:t WHERE recording_id=:id")
                    .setParameter("t", LEASE).setParameter("id", REC).executeUpdate();
            restore.commit();
        } catch (Exception exc) {
            throw new IllegalStateException(exc);
        }
    }

    @Test
    void p26Time() {
        var probe = lab.probe("P26", "시간 계산: to_char · AT TIME ZONE · ::date · now() - interval",
                "PostgresPracticeReminderRepository#recentTemplates#1 · #countedPracticeDays#1 · PostgresCoachProMemory#recent#1", """
                SELECT template_id, to_char(max(day),'YYYY-MM-DD') AS day FROM practice_reminder_sends
                WHERE user_id=:userId AND day>=CAST(:since AS date) GROUP BY template_id
                --
                SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d FROM practices p WHERE p.user_id=:userId
                --
                ... AND c.closed_at > now() - interval '60 days'
                """);
        String format = """
                select s.templateId, format(max(s.day) as 'yyyy-MM-dd') from ProbeReminderSend s
                where s.userId = :userId and s.day >= :since group by s.templateId order by s.templateId
                """;
        check(lab.attempt(probe, "HQL format(… as 'yyyy-MM-dd')", format, s -> ProbeLab.rows(s.createQuery(format, Tuple.class)
                .setParameter("userId", U1).setParameter("since", LocalDate.parse("2026-11-01")).getResultList())), true);
        same(probe, "to_char", lab.nativeRows("""
                SELECT template_id, to_char(max(day),'YYYY-MM-DD') AS day FROM practice_reminder_sends
                WHERE user_id=:userId AND day>=CAST(:since AS date) GROUP BY template_id ORDER BY template_id
                """, Map.of("userId", U1, "since", "2026-11-01")), hqlRows(format,
                Map.of("userId", U1, "since", LocalDate.parse("2026-11-01"))));
        String zone = "select cast(timezone('Asia/Seoul', p.createdAt) as LocalDate) from ProbePractice p where p.userId = :userId";
        check(lab.attempt(probe, "AT TIME ZONE 대신 timezone() 함수를 이름으로 부름", zone, s -> s.createQuery(zone, Object.class)
                .setParameter("userId", U1).getResultList()), true);
        same(probe, "서울 날짜(UTC 16:30 은 서울 다음날)", lab.nativeRows(
                "SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d FROM practices p WHERE p.user_id=:userId",
                Map.of("userId", U1)), hqlRows(zone.replace("select cast", "select cast") , Map.of("userId", U1)));
        String interval = "select c.id from ProbeCoachConversation c where c.closedAt > instant - 60 day";
        check(lab.attempt(probe, "HQL instant - 60 day", interval, s -> s.createQuery(interval, UUID.class).getResultList()), true);
    }

    @Test
    void p27RowValueComparison() {
        String sql = """
                SELECT EXISTS (SELECT 1 FROM reading_sessions s WHERE s.id=:sessionId AND s.user_id=:userId
                  AND NOT EXISTS (SELECT 1 FROM reading_sessions e WHERE e.user_id=s.user_id
                                    AND (e.started_at, e.id) < (s.started_at, s.id))) AS first
                """;
        var probe = lab.probe("P27", "행 값 비교 (a, b) < (x, y)", "PostgresCloudVoiceRepository#firstReadingSession#1", sql);
        String hql = """
                select exists (select 1 from ProbeReadingSession s where s.id = :sessionId and s.userId = :userId
                  and not exists (select 1 from ProbeReadingSession e where e.userId = s.userId
                                    and (e.startedAt, e.id) < (s.startedAt, s.id))) as first
                """;
        check(lab.attempt(probe, "HQL 튜플 비교", hql, s -> ProbeLab.rows(s.createQuery(hql, Tuple.class)
                .setParameter("sessionId", SESSION).setParameter("userId", U1).getResultList())), true);
        same(probe, "첫 회차", lab.nativeRows(sql, Map.of("sessionId", SESSION, "userId", U1)),
                hqlRows(hql, Map.of("sessionId", SESSION, "userId", U1)));
    }

    @Test
    void p28GenRandomUuid() {
        var probe = lab.probe("P28", "INSERT … SELECT 안의 gen_random_uuid()", "PostgresPracticeDataMigration#applyMessages#1",
                "INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,created_at) SELECT gen_random_uuid(),e.target_id, … FROM practice_migration_entries e JOIN coach_turns t …");
        String hql = "insert into ProbeProfileDirection(id, userId, direction) select gen_random_uuid(), u.id, 'media' from ProbeUser u where u.id = :id";
        check(lab.attempt(probe, "HQL insert … select gen_random_uuid()", hql, s -> s.createMutationQuery(hql)
                .setParameter("id", U2).executeUpdate()), false);
        String cast = hql.replace("select gen_random_uuid()", "select cast(gen_random_uuid() as UUID)");
        check(lab.attempt(probe, "HQL insert … select cast(gen_random_uuid() as UUID)", cast, s -> s.createMutationQuery(cast)
                .setParameter("id", U2).executeUpdate()), false);
        String javaType = hql.replace("select gen_random_uuid()", "select cast(gen_random_uuid() as java.util.UUID)");
        check(lab.attempt(probe, "HQL insert … select cast(gen_random_uuid() as java.util.UUID)", javaType, s -> s.createMutationQuery(javaType)
                .setParameter("id", U2).executeUpdate()), true);
    }

    @Test
    void p29Union() {
        String sql = """
                SELECT object_key FROM upload_intents WHERE user_id=:userId
                UNION SELECT object_key FROM videos WHERE user_id=:userId AND purged_at IS NULL
                UNION SELECT poster_key FROM videos WHERE user_id=:userId AND purged_at IS NULL AND poster_key IS NOT NULL
                UNION SELECT mosaic_key FROM challenge_entries WHERE user_id=:userId AND mosaic_key IS NOT NULL
                ORDER BY 1
                """;
        var probe = lab.probe("P29", "UNION", "PostgresProfileRepository#videoKeys#1", sql);
        String hql = """
                select ui.objectKey from ProbeUploadIntent ui where ui.userId = :userId
                union select v.objectKey from ProbeVideo v where v.userId = :userId and v.purgedAt is null
                union select v.posterKey from ProbeVideo v where v.userId = :userId and v.purgedAt is null and v.posterKey is not null
                union select e.mosaicKey from ProbeEntry e where e.userId = :userId and e.mosaicKey is not null
                order by 1
                """;
        check(lab.attempt(probe, "HQL union", hql, s -> ProbeLab.rows(s.createQuery(hql, Tuple.class)
                .setParameter("userId", U1).getResultList())), true);
        same(probe, "U1 키", lab.nativeRows(sql, Map.of("userId", U1)), hqlRows(hql, Map.of("userId", U1)));
    }

    @Test
    void p30AdvisoryLock() {
        var probe = lab.probe("P30", "권고 잠금 pg_advisory_xact_lock", "PostgresChallengeRepository#createTeam#1",
                "SELECT 1 FROM pg_advisory_xact_lock(hashtext('challenge_team_create'))");
        String from = "select 1 from pg_advisory_xact_lock(hashtext('challenge_team_create'))";
        check(lab.attempt(probe, "HQL FROM 절에 함수", from, s -> s.createQuery(from, Integer.class).getResultList()), false);
        String select = "select pg_advisory_xact_lock(hashtext('challenge_team_create'))";
        check(lab.attempt(probe, "HQL select 절에서 함수를 이름으로 부름", select, s -> s.createQuery(select, Object.class)
                .getResultList()), true);
        String fn = "select function('pg_advisory_xact_lock', function('hashtext', 'challenge_team_create'))";
        check(lab.attempt(probe, "HQL function('…') 문법", fn, s -> s.createQuery(fn, Object.class).getResultList()), true);
        // 실제로 잡는지: 같은 키를 다른 세션이 try 로 잡아 보면 실패해야 한다.
        try (Session holder = lab.factory.openSession(); Session other = lab.factory.openSession()) {
            var tx = holder.beginTransaction();
            holder.createQuery(select, Object.class).getResultList();
            var tx2 = other.beginTransaction();
            Object got = other.createNativeQuery("SELECT pg_try_advisory_xact_lock(hashtext('challenge_team_create'))", Object.class)
                    .getSingleResult();
            lab.note(probe, "두 세션 확인: HQL 로 잡은 동안 다른 세션의 pg_try_advisory_xact_lock = " + got + " (잡혀 있음)");
            assertThat(got).isEqualTo(false);
            tx2.rollback();
            tx.rollback();
        }
    }

    @Test
    void p31SetLocal() {
        var probe = lab.probe("P31", "SET LOCAL · SET CONSTRAINTS", "PostgresSessionRepository#saveProgress#2 · PostgresScriptRepository#update#3",
                "SET LOCAL synchronous_commit = off\n--\nSET CONSTRAINTS uq_script_characters_script_name DEFERRED");
        String set = "set local synchronous_commit = off";
        check(lab.attempt(probe, "HQL set local", set, s -> s.createMutationQuery(set).executeUpdate()), false);
        String config = "select set_config('synchronous_commit', 'off', true)";
        check(lab.attempt(probe, "HQL set_config(…, true) 함수 호출", config, s -> {
            Object value = s.createQuery(config, Object.class).getSingleResult();
            Object now = s.createNativeQuery("SELECT current_setting('synchronous_commit')", Object.class).getSingleResult();
            return "set_config=" + value + ", 같은 트랜잭션의 current_setting=" + now;
        }), true);
        String constraints = "set constraints uq_script_characters_script_name deferred";
        check(lab.attempt(probe, "HQL set constraints", constraints, s -> s.createMutationQuery(constraints).executeUpdate()), false);
    }

    @Test
    void p32ScalarSubqueriesInSelect() {
        String sql = """
                SELECT e.id,
                       (SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS like_count,
                       EXISTS(SELECT 1 FROM entry_likes l WHERE l.entry_id=e.id AND l.user_id=:viewer) AS liked
                FROM challenge_entries e WHERE e.id IN (:ids) ORDER BY e.id
                """;
        var probe = lab.probe("P32", "SELECT 절 서브쿼리·EXISTS, IN 목록", "EntryCards#cards#1(부분)", sql);
        String hql = """
                select e.id as id, (select count(*) from ProbeEntryLike l where l.entryId = e.id) as likeCount,
                       exists (select 1 from ProbeEntryLike l where l.entryId = e.id and l.userId = :viewer) as liked
                from ProbeEntry e where e.id in :ids order by e.id
                """;
        Map<String, Object> params = Map.of("viewer", U2, "ids", List.of(E1, E2));
        check(lab.attempt(probe, "HQL 스칼라 서브쿼리", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            params.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), true);
        same(probe, "참여작 둘", lab.nativeRows(sql, params), hqlRows(hql, params));
    }

    @Test
    void p33SelectOne() {
        var probe = lab.probe("P33", "FROM 없는 SELECT 1(상태 확인)", "DatabaseHealthIndicator#checkDatabase#1", "SELECT 1");
        check(lab.attempt(probe, "HQL select 1", "select 1", s -> s.createQuery("select 1", Integer.class).getSingleResult()), true);
        String nulls = "select e.finalRank from ProbeEntry e where e.challengeId = :id order by e.finalRank desc nulls last, e.id";
        check(lab.attempt(probe, "HQL order by … nulls last", nulls, s -> s.createQuery(nulls, Integer.class)
                .setParameter("id", CH).getResultList()), true);
    }

    @Test
    void p34CorrelatedSubqueryUpdate() {
        var probe = lab.probe("P34", "상관 서브쿼리로 값을 다시 세는 UPDATE … RETURNING", "PostgresCommunityRepository#resyncLikeCount#1", """
                WITH changed AS (
                    UPDATE community_posts AS like_count_post
                    SET like_count = (SELECT COUNT(*) FROM community_post_likes community_like WHERE community_like.post_id = like_count_post.id)
                    WHERE like_count_post.id = :postId
                    RETURNING like_count
                )
                SELECT like_count AS like_count FROM changed
                """);
        String hql = "update ProbeCommunityPost p set p.likeCount = (select count(*) from ProbePostLike l where l.postId = p.id) where p.id = :postId";
        check(lab.attempt(probe, "HQL update set = (상관 서브쿼리), 이어서 값을 읽음(문장 둘)", hql, s -> {
            int changed = s.createMutationQuery(hql).setParameter("postId", POST).executeUpdate();
            Integer count = s.createQuery("select p.likeCount from ProbeCommunityPost p where p.id = :postId", Integer.class)
                    .setParameter("postId", POST).getSingleResult();
            return changed + "행, like_count=" + count;
        }), true);
    }

    @Test
    void p35SqlFragmentFunction() {
        var probe = lab.probe("P35", "HQL 안에 SQL 조각 넣기 sql('…')", "(여러 곳: ->>·~·AT TIME ZONE 처럼 HQL 에 문법이 없는 연산자)",
                "c.state->'practice_loop'->>'flow' · pd.version ~ '^v[0-9]+$' · created_at AT TIME ZONE 'Asia/Seoul'");
        String hql = "select sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) from ProbeCoachConversation c where c.id = :id";
        check(lab.attempt(probe, "HQL sql() 로 ->> 연산자", hql, s -> s.createQuery(hql, Object.class).setParameter("id", CONV)
                .getResultList()), true);
        String regex = "select d.version from ProbeConsentDocument d where sql('(? ~ ''^v[0-9]+$'')', d.version) order by d.version";
        check(lab.attempt(probe, "HQL sql() 로 ~ 연산자(조건 자리에 그대로)", regex, s -> s.createQuery(regex, String.class).getResultList()), false);
        String regexCast = "select d.version from ProbeConsentDocument d where cast(sql('(? ~ ''^v[0-9]+$'')', d.version) as Boolean) = true order by d.version";
        check(lab.attempt(probe, "HQL sql() 로 ~ 연산자(Boolean 으로 cast)", regexCast, s -> s.createQuery(regexCast, String.class).getResultList()), true);
        String zone = "select sql('(? at time zone ''Asia/Seoul'')', p.createdAt) from ProbePractice p where p.id = :id";
        check(lab.attempt(probe, "HQL sql() 로 AT TIME ZONE", zone, s -> s.createQuery(zone, Object.class).setParameter("id", PRACTICE)
                .getResultList()), true);
    }

    @Test
    void p36PersistAndHqlInsert() {
        var probe = lab.probe("P36", "INSERT … VALUES(조건 없음)", "PostgresAdRepository#recordEvent 류",
                "INSERT INTO ad_events(id,ad_id,day,event,slot,user_id) VALUES (:id,:adId,:day,:event,:slot,:userId)");
        check(lab.attempt(probe, "엔티티 persist", "session.persist(new ProbeProfileDirection(...))", s -> {
            var direction = new ProbeEntities.ProbeProfileDirection();
            direction.id = UUID.randomUUID();
            direction.userId = U2;
            direction.direction = "stage";
            s.persist(direction);
            s.flush();
            return direction.id;
        }), true);
    }

    // ── 옮기면 달라지는 것(끝난 기준 3) ─────────────────────────────────────────

    @Test
    void p37LockStrengthAgainstChildInsert() throws Exception {
        var probe = lab.probe("P37", "잠금 세기: FOR UPDATE 와 Hibernate 의 FOR NO KEY UPDATE(자식 행 INSERT 를 막는가)",
                "PostgresPushTokenRepository#register#1 처럼 users 행을 잡는 곳",
                "SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE");
        String hql = "select u.id from ProbeUser u where u.id = :userId and u.status = 'active'";
        Map<String, Boolean> blocked = new java.util.LinkedHashMap<>();
        for (String mode : List.of("네이티브 FOR UPDATE", "HQL PESSIMISTIC_WRITE(기본 방언)", "HQL PESSIMISTIC_WRITE(FOR UPDATE 방언)")) {
            var factory = mode.contains("FOR UPDATE 방언") ? lab.forUpdateFactory : lab.factory;
            try (Session holder = factory.openSession(); Session child = lab.factory.openSession()) {
                var tx = holder.beginTransaction();
                if (mode.startsWith("네이티브")) {
                    holder.createNativeQuery("SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE", Object.class)
                            .setParameter("userId", U1).getResultList();
                } else {
                    holder.createQuery(hql, UUID.class).setParameter("userId", U1)
                            .setLockMode(LockModeType.PESSIMISTIC_WRITE).getResultList();
                }
                var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
                var insert = executor.submit(() -> {
                    var tx2 = child.beginTransaction();
                    child.createNativeQuery("INSERT INTO push_tokens(user_id,token,platform) VALUES (:userId,:token,'ios')")
                            .setParameter("userId", U1).setParameter("token", "lock-" + mode.hashCode()).executeUpdate();
                    tx2.rollback();
                    return true;
                });
                Thread.sleep(500);
                blocked.put(mode, !insert.isDone());
                tx.rollback();
                insert.get(5, java.util.concurrent.TimeUnit.SECONDS);
                executor.shutdown();
            }
        }
        lab.note(probe, "두 세션 확인: 한 세션이 users 행을 잡은 동안 다른 세션이 그 사용자를 가리키는 push_tokens 행을 넣으면 "
                + "기다렸는가 → " + blocked + ". FK 검사는 부모 행에 FOR KEY SHARE 를 잡는데, FOR UPDATE 는 이것과 부딪히고 "
                + "FOR NO KEY UPDATE 는 부딪히지 않는다.");
        assertThat(blocked).containsExactly(java.util.Map.entry("네이티브 FOR UPDATE", true),
                java.util.Map.entry("HQL PESSIMISTIC_WRITE(기본 방언)", false),
                java.util.Map.entry("HQL PESSIMISTIC_WRITE(FOR UPDATE 방언)", true));
    }

    @Test
    void p38LostUpdate() throws Exception {
        var probe = lab.probe("P38", "한 문장 갱신을 '읽고 고치고 저장'으로 바꾸면(잃어버린 갱신)",
                "PostgresCommunityRepository#deleteComment#2 같은 열 증감", "UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = :postId");
        String read = "SELECT comment_count FROM community_posts WHERE id=:id";
        java.util.function.Supplier<Long> current = () -> (Long) ProbeLab.normalize(lab.nativeRows(read, Map.of("id", POST)).getFirst().getFirst());
        long start = current.get();
        // 1) 둘이 같은 값을 읽고 각자 +1 해서 저장
        try (Session a = lab.factory.openSession(); Session b = lab.factory.openSession()) {
            var txA = a.beginTransaction();
            var txB = b.beginTransaction();
            var postA = a.find(ProbeEntities.ProbeCommunityPost.class, POST);
            var postB = b.find(ProbeEntities.ProbeCommunityPost.class, POST);
            postA.commentCount++;
            postB.commentCount++;
            txA.commit();
            txB.commit();
        }
        long afterReadModifyWrite = current.get();
        // 2) JPQL UPDATE 한 문장 둘
        String bump = "update ProbeCommunityPost p set p.commentCount = p.commentCount + 1 where p.id = :id";
        for (int i = 0; i < 2; i++) {
            try (Session session = lab.factory.openSession()) {
                var tx = session.beginTransaction();
                session.createMutationQuery(bump).setParameter("id", POST).executeUpdate();
                tx.commit();
            }
        }
        long afterJpql = current.get();
        // 3) 읽을 때 행을 잡으면(PESSIMISTIC_WRITE) 두 번째가 기다렸다가 새 값을 읽는다
        try (Session a = lab.factory.openSession(); Session b = lab.factory.openSession()) {
            var txA = a.beginTransaction();
            var postA = a.find(ProbeEntities.ProbeCommunityPost.class, POST, LockModeType.PESSIMISTIC_WRITE);
            var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
            var second = executor.submit(() -> {
                var txB = b.beginTransaction();
                var postB = b.find(ProbeEntities.ProbeCommunityPost.class, POST, LockModeType.PESSIMISTIC_WRITE);
                postB.commentCount++;
                txB.commit();
                return true;
            });
            Thread.sleep(300);
            postA.commentCount++;
            txA.commit();
            second.get(5, java.util.concurrent.TimeUnit.SECONDS);
            executor.shutdown();
        }
        long afterLocked = current.get();
        lab.note(probe, "시작 " + start + " → 읽고 고치고 저장 두 번 뒤 " + afterReadModifyWrite + "(하나를 잃음) → JPQL UPDATE 두 번 뒤 "
                + afterJpql + "(둘 다 반영) → PESSIMISTIC_WRITE 로 읽고 고치기 두 번 뒤 " + afterLocked + "(둘 다 반영, 대신 두 번째가 기다림).");
        assertThat(afterReadModifyWrite - start).isEqualTo(1);
        assertThat(afterJpql - afterReadModifyWrite).isEqualTo(2);
        assertThat(afterLocked - afterJpql).isEqualTo(2);
        lab.seed("UPDATE community_posts SET comment_count=0 WHERE id='" + POST + "'");
    }

    @Test
    void p39StaleEntityAfterBulkUpdate() {
        var probe = lab.probe("P39", "JPQL 로 한꺼번에 고친 뒤 같은 트랜잭션의 엔티티가 든 낡은 값",
                "CONTRACT §5-2·§5-4: native bulk 뒤 clear·재조회 규칙", "UPDATE community_posts SET comment_count = 5 WHERE id = :postId");
        String bulk = "update ProbeCommunityPost p set p.commentCount = 5 where p.id = :id";
        check(lab.attempt(probe, "엔티티를 읽은 뒤 JPQL UPDATE, 이어서 다른 필드를 고쳐 flush", bulk, s -> {
            var post = s.find(ProbeEntities.ProbeCommunityPost.class, POST);
            int before = post.commentCount;
            s.createMutationQuery(bulk).setParameter("id", POST).executeUpdate();
            int stale = post.commentCount;
            post.likeCount = 9;
            s.flush();
            Object stored = s.createNativeQuery("SELECT comment_count FROM community_posts WHERE id=:id", Object.class)
                    .setParameter("id", POST).getSingleResult();
            return "읽은 값 " + before + ", JPQL 뒤 엔티티 값 " + stale + ", 다른 필드를 고쳐 flush 한 뒤 DB 값 " + stored
                    + " (JPQL 이 쓴 5 가 엔티티의 낡은 값으로 덮였다)";
        }), true);
        check(lab.attempt(probe, "JPQL UPDATE 뒤 refresh", bulk, s -> {
            var post = s.find(ProbeEntities.ProbeCommunityPost.class, POST);
            s.createMutationQuery(bulk).setParameter("id", POST).executeUpdate();
            s.refresh(post);
            return "refresh 뒤 엔티티 값 " + post.commentCount;
        }), true);
    }

    @Test
    void p40QueryCount() {
        var probe = lab.probe("P40", "쿼리 수: 한 쿼리의 서브쿼리 vs 행마다 저장소 메서드", "EntryCards#cards#1 의 like_count",
                "SELECT e.id,(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS like_count FROM challenge_entries e WHERE e.id IN (:ids)");
        List<UUID> ids = List.of(E1, E2, E3, E4);
        String one = "select e.id, (select count(*) from ProbeEntryLike l where l.entryId = e.id) from ProbeEntry e where e.id in :ids";
        var single = lab.attempt(probe, "HQL 한 쿼리(스칼라 서브쿼리)", one, s -> s.createQuery(one, Tuple.class)
                .setParameter("ids", ids).getResultList().size() + "행");
        check(single, true);
        String each = "select count(*) from ProbeEntryLike l where l.entryId = :id";
        var perRow = lab.attempt(probe, "엔티티 목록 + 행마다 count 메서드(관계 매핑 없이 저장소 메서드로 나눈 경우)",
                "select e from ProbeEntry e where e.id in :ids\n" + each, s -> {
                    var entries = s.createQuery("select e from ProbeEntry e where e.id in :ids", ProbeEntities.ProbeEntry.class)
                            .setParameter("ids", ids).getResultList();
                    long total = 0;
                    for (var entry : entries) {
                        total += s.createQuery(each, Long.class).setParameter("id", entry.id).getSingleResult();
                    }
                    return entries.size() + "행, 좋아요 합 " + total;
                });
        check(perRow, true);
        lab.note(probe, "보낸 SQL 수: 한 쿼리 " + single.sql().size() + "개, 행마다 " + perRow.sql().size() + "개(참여작 " + ids.size() + "개).");
        assertThat(single.sql()).hasSize(1);
        assertThat(perRow.sql()).hasSize(1 + ids.size());
    }

    // ── 앞에서 다루지 않은 모양(ILIKE·널 매개변수·배열 집계·빈 목록·배열 매개변수·JSON 함수) ─────────────

    @Test
    void p41IlikeNullableParamArrayMembership() {
        String sql = """
                SELECT s.id, s.title,
                       (SELECT string_agg(c.name,:sep ORDER BY c.sort_order) FROM script_characters c
                        WHERE c.id=ANY(ls.my_character_ids)) AS my_character_names
                FROM scripts s
                LEFT JOIN LATERAL (
                    SELECT rs.status,rs.my_character_ids FROM reading_sessions rs
                    WHERE rs.script_id=s.id ORDER BY rs.started_at DESC,rs.id DESC LIMIT 1
                ) ls ON true
                WHERE s.user_id=:userId
                  AND (CAST(:pattern AS text) IS NULL
                       OR s.title ILIKE CAST(:pattern AS text) ESCAPE '\\'
                       OR EXISTS (SELECT 1 FROM script_characters c
                                  WHERE c.script_id=s.id AND c.name ILIKE CAST(:pattern AS text) ESCAPE '\\'))
                ORDER BY s.updated_at DESC,s.id DESC
                """;
        var probe = lab.probe("P41", "ILIKE … ESCAPE · CAST(:p AS text) IS NULL(널 매개변수) · = ANY(배열 열) · LATERAL",
                "PostgresScriptRepository#list#1(부분)", sql);
        String hql = """
                select s.id, s.title,
                       (select listagg(c.name, :sep) within group (order by c.sortOrder) from ProbeScriptCharacter c
                        where array_contains(ls.myCharacterIds, c.id)) as myCharacterNames
                from ProbeScript s
                left join lateral (
                    select rs.status as status, rs.myCharacterIds as myCharacterIds from ProbeReadingSession rs
                    where rs.scriptId = s.id order by rs.startedAt desc, rs.id desc limit 1
                ) ls on true
                where s.userId = :userId
                  and (:pattern is null
                       or s.title ilike :pattern escape '\\'
                       or exists (select 1 from ProbeScriptCharacter c where c.scriptId = s.id and c.name ilike :pattern escape '\\'))
                order by s.updatedAt desc, s.id desc
                """;
        java.util.HashMap<String, Object> none = new java.util.HashMap<>(Map.of("userId", U1, "sep", ","));
        none.put("pattern", null);
        check(lab.attempt(probe, "HQL ilike … escape, :pattern is null(널), array_contains(배열 열, 값)", hql, s -> {
            var query = s.createQuery(hql, Tuple.class);
            none.forEach(query::setParameter);
            return ProbeLab.rows(query.getResultList());
        }), true);
        same(probe, "검색어 없음(널)", lab.nativeRows(sql, none), hqlRows(hql, none));
        Map<String, Object> hamlet = Map.of("userId", U1, "sep", ",", "pattern", "%햄%");
        same(probe, "배역 이름으로 찾음", lab.nativeRows(sql, hamlet), hqlRows(hql, hamlet));
        Map<String, Object> nothing = Map.of("userId", U1, "sep", ",", "pattern", "%없는말%");
        same(probe, "없음", lab.nativeRows(sql, nothing), hqlRows(hql, nothing));
    }

    @Test
    void p42ArrayAggElementBoolOr() {
        String sql = """
                SELECT c.document_id, count(DISTINCT c.action) AS kinds,
                       count(*) FILTER (WHERE c.action='granted') AS granted,
                       (array_agg(c.action ORDER BY c.occurred_at DESC,c.id DESC))[1] AS latest,
                       bool_or(c.action='revoked') AS ever_revoked
                FROM user_consents c WHERE c.user_id=:userId GROUP BY c.document_id ORDER BY c.document_id
                """;
        var probe = lab.probe("P42", "(array_agg(… ORDER BY …))[1] · bool_or · count(DISTINCT)", "PostgresNotificationRepository#inbox#1(같은 연산)", sql);
        String hql = """
                select c.documentId, count(distinct c.action),
                       count(*) filter (where c.action = 'granted'),
                       array_get(array_agg(c.action) within group (order by c.occurredAt desc, c.id desc), 1),
                       any(c.action = 'revoked')
                from ProbeUserConsent c where c.userId = :userId group by c.documentId order by c.documentId
                """;
        check(lab.attempt(probe, "HQL array_agg … within group 의 첫 원소(array_get), any(조건)", hql, s -> ProbeLab.rows(
                s.createQuery(hql, Tuple.class).setParameter("userId", U1).getResultList())), false);
        lab.note(probe, "Hibernate 가 array_get(array_agg(…), 1) 을 괄호 없이 'array_agg(…)[1]' 로 내서 PostgreSQL 이 문법 오류로 거절한다.");
        String latest = """
                select c.documentId, count(distinct c.action),
                       count(*) filter (where c.action = 'granted'),
                       (select c2.action from ProbeUserConsent c2 where c2.userId = c.userId and c2.documentId = c.documentId
                        order by c2.occurredAt desc, c2.id desc limit 1),
                       any(c.action = 'revoked')
                from ProbeUserConsent c where c.userId = :userId group by c.userId, c.documentId order by c.documentId
                """;
        check(lab.attempt(probe, "다시 쓰기: 첫 원소를 상관 서브쿼리(order by … limit 1)로", latest, s -> ProbeLab.rows(
                s.createQuery(latest, Tuple.class).setParameter("userId", U1).getResultList())), true);
        same(probe, "U1 문서 셋", lab.nativeRows(sql, Map.of("userId", U1)), hqlRows(latest, Map.of("userId", U1)));
    }

    @Test
    void p43EmptyListAndArrayParameters() {
        String sql = """
                WITH removed AS (
                    DELETE FROM community_post_images
                    WHERE post_id = :postId AND NOT (id = ANY (CAST(:keep AS uuid[])))
                    RETURNING object_key
                )
                SELECT object_key AS object_key FROM removed
                """;
        var probe = lab.probe("P43", "빈 목록: NOT (id = ANY(빈 배열)) · 배열 매개변수 INSERT(CAST(:x AS uuid[]))",
                "PostgresCommunityRepository#replaceImages#1 · PostgresEntryRepository#byLikes#2", sql);
        int nativeDeleted;
        try (Session session = lab.factory.openSession()) {
            var tx = session.beginTransaction();
            nativeDeleted = session.createNativeQuery(sql, Tuple.class).setParameter("postId", POST)
                    .setParameter("keep", new UUID[0]).getResultList().size();
            tx.rollback();
        }
        String notIn = "delete from ProbePostImage i where i.postId = :postId and i.id not in :keep";
        var emptyNotIn = lab.attempt(probe, "HQL not in :keep 에 빈 List", notIn, s -> s.createMutationQuery(notIn)
                .setParameter("postId", POST).setParameter("keep", List.of()).executeUpdate());
        check(emptyNotIn, true);
        String contains = "delete from ProbePostImage i where i.postId = :postId and not array_contains(:keep, i.id)";
        var emptyArray = lab.attempt(probe, "HQL not array_contains(:keep, id) 에 빈 배열", contains, s -> s.createMutationQuery(contains)
                .setParameter("postId", POST).setParameter("keep", new UUID[0]).executeUpdate());
        check(emptyArray, true);
        lab.note(probe, "빈 목록으로 지운 행 수: 원본 " + nativeDeleted + ", HQL not in 빈 List " + emptyNotIn.observed()
                + ", HQL not array_contains 빈 배열 " + emptyArray.observed() + ".");
        String insert = """
                insert into ProbeRankingSnapshot(id, challengeId, viewerId, basis, entryIds, ranks, createdAt)
                values (:id, :challenge, :viewer, :basis, :entries, :ranks, :now)
                """;
        check(lab.attempt(probe, "HQL insert … values 에 UUID[]·Integer[] 매개변수", insert, s -> s.createMutationQuery(insert)
                .setParameter("id", UUID.randomUUID()).setParameter("challenge", CH).setParameter("viewer", U2)
                .setParameter("basis", "live").setParameter("entries", new UUID[] {E1, E2})
                .setParameter("ranks", new Integer[] {1, 2}).setParameter("now", NOW).executeUpdate()), true);
    }

    @Test
    void p44JsonFunctionsByName() {
        String sql = """
                SELECT jsonb_typeof(line_results) AS kind, jsonb_array_length(line_results) AS length
                FROM reading_sessions WHERE id=:id
                """;
        var probe = lab.probe("P44", "jsonb_typeof·jsonb_array_length·jsonb_agg(jsonb_build_object(…) ORDER BY …)",
                "PostgresLegacyPracticeReader#find#1 · PostgresPracticeDataMigration#applyTranscripts#1", sql);
        String hql = "select cast(jsonb_typeof(s.lineResults) as String), cast(jsonb_array_length(s.lineResults) as Integer) from ProbeReadingSession s where s.id = :id";
        check(lab.attempt(probe, "등록 안 된 jsonb_* 함수를 이름으로 부르고 cast", hql, s -> ProbeLab.rows(
                s.createQuery(hql, Tuple.class).setParameter("id", SESSION).getResultList())), true);
        same(probe, "회차 하나", lab.nativeRows(sql, Map.of("id", SESSION)), hqlRows(hql, Map.of("id", SESSION)));
        String aggSql = """
                SELECT CAST(jsonb_agg(jsonb_build_object('ord',l.ordinal,'text',l.text) ORDER BY l.ordinal) AS text) AS doc
                FROM script_lines l WHERE l.script_id=:id
                """;
        String aggHql = """
                select cast(json_arrayagg(json_object('ord', l.ordinal, 'text', l.text) order by l.ordinal) as String)
                from ProbeScriptLineText l where l.scriptId = :id
                """;
        check(lab.attempt(probe, "HQL json_arrayagg(json_object(…) order by …)(앱 설정 그대로)", aggHql, s -> s.createQuery(aggHql, String.class)
                .setParameter("id", SCRIPT).getResultList()), false);
        var agg = lab.attempt(probe, "HQL json_arrayagg(json_object(…) order by …)", aggHql, s -> s.createQuery(aggHql, String.class)
                .setParameter("id", SCRIPT).getSingleResult(), true);
        check(agg, true);
        Object nativeDoc = lab.nativeRows(aggSql, Map.of("id", SCRIPT)).getFirst().getFirst();
        boolean sameJson = JSON.readTree(String.valueOf(nativeDoc)).equals(JSON.readTree(agg.observed()));
        lab.note(probe, "JSON 값으로 견줌: " + (sameJson ? "같음" : "다름") + " — 네이티브 " + nativeDoc + " / HQL " + agg.observed());
        assertThat(sameJson).isTrue();
    }

    @Test
    void p45CurrentTimestampRendering() {
        var probe = lab.probe("P45", "JPQL CURRENT_TIMESTAMP 와 now()", "PostgresPortfolioRepository#saveIntro 의 updated_at=now() (표본)",
                "UPDATE portfolios SET intro=CAST(:intro AS text),updated_at=now() WHERE user_id=:userId");
        for (String zone : List.of("UTC", "America/New_York", "Asia/Seoul")) {
            check(lab.attempt(probe, "세션 TimeZone=" + zone + " 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌",
                    "select set_config('TimeZone', :zone, true)\nupdate … set updatedAt = current_timestamp", s -> {
                        s.createQuery("select set_config('TimeZone', :zone, true)", Object.class).setParameter("zone", zone).getSingleResult();
                        s.createMutationQuery("update ProbeAdSettings a set a.updatedAt = current_timestamp where a.id = 1").executeUpdate();
                        Object gap = s.createNativeQuery(
                                "SELECT abs(extract(epoch FROM (updated_at - now()))) FROM ad_settings WHERE id=1", Object.class)
                                .getSingleResult();
                        return "updated_at 과 now() 의 차이(초)=" + gap;
                    }), true);
        }
    }
}
