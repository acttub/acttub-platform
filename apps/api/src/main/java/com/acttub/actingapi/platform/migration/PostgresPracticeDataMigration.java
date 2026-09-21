package com.acttub.actingapi.platform.migration;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 전환 명령의 Postgres 구현 — 단계마다 <b>고르기(대응표에 적기) + 옮기기</b>가 한 트랜잭션이다.
 *
 * <p><b>단계는 순서대로 끝까지 돈다.</b> 뒤 단계가 앞 단계가 만든 행을 가리키기 때문이다(회차는 영상을,
 * 대화는 회차를, 노트는 대화를 가리킨다). 한 단계가 남김없이 끝난 뒤에 다음 단계로 간다.
 *
 * <p><b>옮기기는 언제나 다시 돌 수 있다</b>({@code NOT EXISTS}·{@code ON CONFLICT DO NOTHING}). 고르기와
 * 옮기기 사이에서 죽어도 다음 실행이 같은 대응표를 보고 이어서 옮긴다.
 *
 * <p>옛 테이블에 쓰는 자리는 {@code upload_intents.video_id} 하나다 — V14 가 예약 장부에 더해 둔 칸이고 옛
 * 서버는 그것을 모른다.
 */
@Repository
class PostgresPracticeDataMigration implements PracticeDataMigration {

    /**
     * 이어하기 체인을 묶음(root)과 차수(ordinal)로 편다.
     *
     * <p>깊이를 100 으로 끊는다 — {@code continued_from} 은 자기 테이블을 가리키므로 순환이 들어오면 이
     * 질의가 영원히 돈다. 실제로 순환이 생길 길은 없지만, 전환 명령이 도는 동안 DB 가 멈추는 쪽이 훨씬 비싸다.
     */
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
            staged AS (
                SELECT c.id, c.root_id, c.ordinal, ui.video_id,
                       CASE
                         WHEN ps.status::text = 'failed' THEN 'closed'
                         -- 아직 분석 중인 회차는 정말로 진행 중이다 — 이어받은 회차가 있어도 그렇다.
                         WHEN ps.status::text IN ('created','analyzing') THEN 'analyzing'
                         -- 이어받은 회차가 있으면 그 회차는 끝난 것이다. 이것이 없으면 옛 체인의 모든
                         -- 회차가 열린 채로 옮겨져 "묶음당 진행 중 회차 하나" 제약에 걸린다.
                         WHEN EXISTS (SELECT 1 FROM practice_sessions nxt WHERE nxt.continued_from = ps.id)
                              THEN 'closed'
                         WHEN EXISTS (SELECT 1 FROM coach_sessions cs
                                      WHERE cs.practice_session_id = ps.id AND cs.status::text = 'open')
                              THEN 'conversing'
                         WHEN EXISTS (SELECT 1 FROM coach_sessions cs
                                      WHERE cs.practice_session_id = ps.id AND cs.status::text = 'closed')
                              THEN 'closed'
                         ELSE 'conversing'
                       END AS stage
                FROM chain c
                JOIN practice_sessions ps ON ps.id = c.id
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
            )
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final Clock clock;

    PostgresPracticeDataMigration(
            EntityManager entityManager, PlatformTransactionManager transactionManager, Clock clock) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    @Override
    public Report run(int batchSize) {
        int batch = batchSize > 0 ? batchSize : DEFAULT_BATCH;
        Map<String, Integer> moved = new LinkedHashMap<>();
        Map<String, Integer> skipped = new LinkedHashMap<>();
        int batches = 0;
        for (String step : Report.STEPS) {
            moved.put(step, 0);
            skipped.put(step, 0);
            while (runBatch(step, UUID.randomUUID(), batch, moved, skipped) > 0) {
                batches++;
            }
        }
        return new Report(Map.copyOf(moved), Map.copyOf(skipped), reasons(), batches);
    }

    /** 한 묶음: 고르기와 옮기기가 한 트랜잭션이다. @return 이번에 고른 원본 수(0 이면 그 단계는 끝났다) */
    private int runBatch(
            String step, UUID batchId, int batch, Map<String, Integer> moved, Map<String, Integer> skipped) {
        return transaction.execute(tx -> {
            Instant now = clock.instant();
            int planned = plan(step, batchId, batch, now);
            if (planned == 0) {
                return 0;
            }
            apply(step);
            moved.merge(step, count(step, batchId, true), Integer::sum);
            skipped.merge(step, count(step, batchId, false), Integer::sum);
            return planned;
        });
    }

    private int plan(String step, UUID batchId, int batch, Instant now) {
        return switch (step) {
            case "video" -> planVideos(batchId, batch, now);
            case "practice" -> planPractices(batchId, batch, now);
            case "transcript" -> planTranscripts(batchId, batch, now);
            case "analysis" -> planAnalyses(batchId, batch, now);
            case "conversation" -> planConversations(batchId, batch, now);
            case "message" -> planMessages(batchId, batch, now);
            case "note" -> planNotes(batchId, batch, now);
            case "memory" -> planMemories(batchId, batch, now);
            case "ai_job" -> planAiJobs(batchId, batch, now);
            default -> throw new IllegalStateException("unknown migration step: " + step);
        };
    }

    private void apply(String step) {
        switch (step) {
            case "video" -> applyVideos();
            case "practice" -> applyPractices();
            case "transcript" -> applyTranscripts();
            case "analysis" -> applyAnalyses();
            case "conversation" -> applyConversations();
            case "message" -> applyMessages();
            case "note" -> applyNotes();
            case "memory" -> applyMemories();
            case "ai_job" -> applyAiJobs();
            default -> throw new IllegalStateException("unknown migration step: " + step);
        }
    }

    // --- ① 확정된 업로드 → 보관함 영상 ---------------------------------------

    private int planVideos(UUID batchId, int batch, Instant now) {
        return ledger("""
                SELECT gen_random_uuid(),'video','upload_intents',ui.id,gen_random_uuid(),NULL,
                       :batchId,:now
                FROM upload_intents ui
                WHERE ui.status::text='finalized'
                  AND ui.video_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                  WHERE e.source_table='upload_intents' AND e.source_id=ui.id)
                ORDER BY ui.created_at, ui.id
                LIMIT :batch
                """, batchId, batch, now);
    }

    /** 길이를 모르는 옛 업로드는 0 으로 둔다 — 분석이 끝나면 워커가 실제 길이를 채운다. */
    private void applyVideos() {
        execute("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,
                                   created_at,updated_at)
                SELECT e.target_id,ui.user_id,ui.object_key,ui.mime_type,ui.size_bytes,
                       COALESCE(ui.duration_ms,0),
                       COALESCE(ui.finalized_at,ui.created_at),COALESCE(ui.finalized_at,ui.created_at)
                FROM practice_migration_entries e
                JOIN upload_intents ui ON ui.id=e.source_id
                WHERE e.step='video' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.id=e.target_id)
                """);
        execute("""
                UPDATE upload_intents ui
                SET video_id=e.target_id
                FROM practice_migration_entries e
                WHERE e.step='video' AND e.source_id=ui.id AND ui.video_id IS NULL
                """);
    }

    // --- ② 연습 세션 → 회차 ---------------------------------------------------

    /**
     * 묶음 통째로 고른다 — 차수는 묶음 안에서만 뜻이 있고, 새 제약(묶음당 진행 중 회차 하나)도 묶음 단위다.
     *
     * <p>맞지 않는 묶음은 <b>통째로 건너뛴다</b>: 이어하기가 가지 쳐 차수가 겹치거나(`branching_chain`),
     * 닫히지 않은 회차가 둘 이상이거나(`multiple_open_practices`), 확정되지 않은 업로드를 가리켜 영상이 없는
     * (`video_missing`) 묶음이다. 임의로 닫거나 지우지 않고 옛 테이블에 남겨 호환 읽기가 보여 준다.
     */
    private int planPractices(UUID batchId, int batch, Instant now) {
        return ledger(CHAIN + """
                , verdict AS (
                    SELECT root_id,
                           CASE
                             WHEN count(*) <> count(DISTINCT ordinal) THEN 'branching_chain'
                             WHEN count(*) FILTER (WHERE video_id IS NULL) > 0 THEN 'video_missing'
                             WHEN count(*) FILTER (WHERE stage <> 'closed') > 1
                                  THEN 'multiple_open_practices'
                           END AS skip_reason
                    FROM staged
                    GROUP BY root_id
                ),
                picked AS (
                    SELECT v.root_id, v.skip_reason
                    FROM verdict v
                    WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                      WHERE e.source_table='practice_sessions' AND e.source_id=v.root_id)
                    ORDER BY v.root_id
                    LIMIT :batch
                )
                SELECT gen_random_uuid(),'practice','practice_sessions',s.id,
                       CASE WHEN p.skip_reason IS NULL THEN s.id END,p.skip_reason,:batchId,:now
                FROM staged s
                JOIN picked p ON p.root_id=s.root_id
                """, batchId, batch, now);
    }

    /**
     * 자기 테이블을 가리키는 {@code root_id} 는 한 문장 안에서 풀린다 — Postgres 의 FK 는 문장이 끝날 때
     * 확인하는 AFTER 트리거라 묶음의 첫 행과 뒤 행을 같은 INSERT 로 넣어도 순서를 맞출 필요가 없다.
     */
    private void applyPractices() {
        execute(CHAIN + """
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,
                                      experience_version,situation,character_context,goal,
                                      blockage_kind,sub_branch,blockage_detail,
                                      legacy_hidden_at,created_at,updated_at)
                SELECT e.target_id,ps.user_id,s.video_id,s.root_id,s.ordinal,s.stage,
                       CASE WHEN ps.status::text='failed' THEN 'analysis_failed'
                            WHEN s.stage='closed' THEN 'conversation_closed' END,
                       ps.experience_version,ps.situation,ps.character_context,ps.goal,
                       ps.blockage_kind,ps.sub_branch,ps.blockage_detail,
                       ps.hidden_at,ps.created_at,ps.updated_at
                FROM practice_migration_entries e
                JOIN staged s ON s.id=e.source_id
                JOIN practice_sessions ps ON ps.id=e.source_id
                WHERE e.step='practice' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM practices p WHERE p.id=e.target_id)
                """);
    }

    // --- ③ 받아쓰기 → 영상당 묶음 하나 ----------------------------------------

    private int planTranscripts(UUID batchId, int batch, Instant now) {
        return ledger("""
                WITH candidate AS (
                    SELECT ps.id AS session_id,p.video_id,ps.created_at,
                           row_number() OVER (PARTITION BY p.video_id
                                              ORDER BY ps.created_at, ps.id) AS rn
                    FROM practice_sessions ps
                    JOIN practices p ON p.id=ps.id
                    WHERE EXISTS (SELECT 1 FROM transcripts t WHERE t.session_id=ps.id)
                      AND NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                      WHERE e.source_table='transcripts' AND e.source_id=ps.id)
                ),
                picked AS (
                    SELECT * FROM candidate ORDER BY created_at, session_id LIMIT :batch
                )
                SELECT gen_random_uuid(),'transcript','transcripts',picked.session_id,
                       CASE WHEN picked.rn=1
                                 AND NOT EXISTS (SELECT 1 FROM video_transcripts vt
                                                 WHERE vt.video_id=picked.video_id)
                            THEN picked.video_id END,
                       CASE WHEN picked.rn>1
                                 OR EXISTS (SELECT 1 FROM video_transcripts vt
                                            WHERE vt.video_id=picked.video_id)
                            THEN 'transcript_conflict' END,
                       :batchId,:now
                FROM picked
                """, batchId, batch, now);
    }

    /** 순서 있는 조각은 {@code segments} 안에 순서대로 둔다 — 묶음은 통째로 쓰이고 조각으로 조회하지 않는다. */
    private void applyTranscripts() {
        execute("""
                INSERT INTO video_transcripts(id,video_id,status,source,segments,
                                              created_at,updated_at,completed_at)
                SELECT gen_random_uuid(),e.target_id,'ready','legacy',
                       COALESCE((SELECT jsonb_agg(jsonb_build_object('ord',t.ord,'text',t.text)
                                                  ORDER BY t.ord)
                                 FROM transcripts t WHERE t.session_id=e.source_id),'[]'::jsonb),
                       ps.created_at,ps.updated_at,ps.updated_at
                FROM practice_migration_entries e
                JOIN practice_sessions ps ON ps.id=e.source_id
                WHERE e.step='transcript' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM video_transcripts vt WHERE vt.video_id=e.target_id)
                """);
    }

    // --- ④ 관찰 요약 → 관찰 기록 ----------------------------------------------

    private int planAnalyses(UUID batchId, int batch, Instant now) {
        return ledger("""
                WITH candidate AS (
                    SELECT s.id,s.session_id,s.raw,s.created_at,
                           row_number() OVER (PARTITION BY s.session_id
                                              ORDER BY s.created_at DESC, s.id DESC) AS rn
                    FROM summaries s
                    JOIN practices p ON p.id=s.session_id
                    WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                      WHERE e.source_table='summaries' AND e.source_id=s.id)
                ),
                picked AS (
                    SELECT * FROM candidate ORDER BY session_id, rn LIMIT :batch
                )
                SELECT gen_random_uuid(),'analysis','summaries',picked.id,
                       CASE WHEN picked.rn=1
                                 AND NOT EXISTS (SELECT 1 FROM analyses a
                                                 WHERE a.practice_id=picked.session_id)
                            THEN CASE WHEN picked.raw->>'record_id' ~
                                           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                      THEN (picked.raw->>'record_id')::uuid
                                      ELSE gen_random_uuid() END END,
                       CASE WHEN picked.rn>1
                                 OR EXISTS (SELECT 1 FROM analyses a WHERE a.practice_id=picked.session_id)
                            THEN 'analysis_conflict' END,
                       :batchId,:now
                FROM picked
                """, batchId, batch, now);
    }

    /**
     * <b>구형을 신형으로 위장하지 않는다.</b> {@code raw} 가 신형 기록이면 그대로 두고 형식을
     * {@code video_record_v1} 로 적는다. 그 밖은 {@code legacy} 이고 저장 계층이 읽던 모양
     * ({@code StoredObservationPack})을 그대로 만든다 — 새 팩이면 원문, 구형 분리 배열이면 합친 묶음이다.
     */
    private void applyAnalyses() {
        execute("""
                WITH built AS (
                    SELECT e.target_id,s.session_id,s.model,s.created_at,
                           -- Hibernate 는 네이티브 SQL 의 `?` 를 위치 파라미터로 읽는다.
                           -- jsonb 의 존재 연산자는 같은 뜻의 함수로 쓴다.
                           CASE WHEN jsonb_exists(s.raw,'schema_version')
                                     AND s.raw->>'schema_version' LIKE 'acttub.video_record%'
                                THEN 'video_record_v1' ELSE 'legacy' END AS format,
                           CASE WHEN jsonb_exists(s.raw,'schema_version') THEN s.raw
                                WHEN jsonb_typeof(s.raw)='object'
                                     AND jsonb_typeof(s.raw->'observations')='array' THEN s.raw
                                ELSE jsonb_build_object(
                                       'observations',
                                       CASE WHEN jsonb_typeof(s.raw)='array' AND s.raw <> '[]'::jsonb
                                            THEN s.raw ELSE COALESCE(s.observations_json,'[]'::jsonb) END,
                                       'uncertainties', COALESCE(s.uncertainties_json,'[]'::jsonb))
                           END AS record
                    FROM practice_migration_entries e
                    JOIN summaries s ON s.id=e.source_id
                    WHERE e.step='analysis' AND e.target_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM analyses a WHERE a.practice_id=s.session_id)
                )
                INSERT INTO analyses(id,practice_id,format,status,model,record,created_at,completed_at)
                SELECT built.target_id,built.session_id,built.format,
                       CASE WHEN jsonb_typeof(built.record->'uncertainties')='array'
                                 AND jsonb_array_length(built.record->'uncertainties')>0
                            THEN 'partial' ELSE 'ready' END,
                       built.model,built.record,built.created_at,built.created_at
                FROM built
                ON CONFLICT (practice_id) DO NOTHING
                """);
    }

    // --- ⑤ 코치 세션 → 대화 (연습당 하나) -------------------------------------

    private int planConversations(UUID batchId, int batch, Instant now) {
        return ledger("""
                WITH candidate AS (
                    SELECT cs.id,cs.practice_session_id,
                           row_number() OVER (PARTITION BY cs.practice_session_id
                                              ORDER BY cs.created_at DESC, cs.id DESC) AS rn
                    FROM coach_sessions cs
                    JOIN practices p ON p.id=cs.practice_session_id
                    WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                      WHERE e.source_table='coach_sessions' AND e.source_id=cs.id)
                ),
                picked AS (
                    SELECT * FROM candidate ORDER BY practice_session_id, rn LIMIT :batch
                )
                SELECT gen_random_uuid(),'conversation','coach_sessions',picked.id,
                       CASE WHEN picked.rn=1
                                 AND NOT EXISTS (SELECT 1 FROM coach_conversations c
                                                 WHERE c.practice_id=picked.practice_session_id)
                            THEN picked.id END,
                       CASE WHEN picked.rn>1 THEN 'superseded_conversation'
                            WHEN EXISTS (SELECT 1 FROM coach_conversations c
                                         WHERE c.practice_id=picked.practice_session_id)
                            THEN 'conversation_conflict' END,
                       :batchId,:now
                FROM picked
                """, batchId, batch, now);
    }

    /**
     * 종료 사유는 새 어휘로 옮긴다 — 옛 표에만 있던 셋({@code actor_finished}·{@code turn_budget}·
     * {@code interrupted})을 가장 가까운 새 값으로 바꾼다. {@code start_request_id} 는 옛 자료에 없어서
     * <b>세션 id 를 그대로 쓴다</b>: NOT NULL 이고, 멱등해야 하며, 옛 대화에 재전송이 올 길이 없다.
     */
    private void applyConversations() {
        execute("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,
                                                state,state_revision,created_at,updated_at,closed_at)
                SELECT e.target_id,cs.practice_session_id,cs.id,cs.status::text,
                       CASE cs.close_reason::text
                            WHEN 'actor_finished' THEN 'user_ended'
                            WHEN 'turn_budget' THEN 'limit'
                            WHEN 'interrupted' THEN 'exhausted'
                            ELSE cs.close_reason::text END,
                       COALESCE(cs.coaching_state_json,'{}'::jsonb),
                       LEAST(cs.state_revision, 2147483647)::integer,
                       cs.created_at,cs.updated_at,
                       CASE WHEN cs.status::text='closed' THEN cs.updated_at END
                FROM practice_migration_entries e
                JOIN coach_sessions cs ON cs.id=e.source_id
                WHERE e.step='conversation' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM coach_conversations c WHERE c.id=e.target_id)
                ON CONFLICT (practice_id) DO NOTHING
                """);
    }

    // --- ⑥ 코치 턴 → 메시지 ---------------------------------------------------

    private int planMessages(UUID batchId, int batch, Instant now) {
        return ledger("""
                SELECT gen_random_uuid(),'message','coach_turns',e.source_id,e.target_id,NULL,
                       :batchId,:now
                FROM practice_migration_entries e
                WHERE e.step='conversation' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM practice_migration_entries m
                                  WHERE m.source_table='coach_turns' AND m.source_id=e.source_id)
                ORDER BY e.created_at, e.source_id
                LIMIT :batch
                """, batchId, batch, now);
    }

    /** 요청 id 는 입증된 것만 채운다 — 옛 턴에는 없으므로 비운다(재전송 멱등은 새 대화부터다). */
    private void applyMessages() {
        execute("""
                INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,created_at)
                SELECT gen_random_uuid(),e.target_id,t.turn_index,t.role::text,t.text,t.created_at
                FROM practice_migration_entries e
                JOIN coach_turns t ON t.session_id=e.source_id
                WHERE e.step='message' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM coach_messages m
                                  WHERE m.conversation_id=e.target_id AND m.turn_index=t.turn_index)
                """);
    }

    // --- ⑦ 연습 리포트 → 노트 -------------------------------------------------

    private int planNotes(UUID batchId, int batch, Instant now) {
        return ledger("""
                WITH candidate AS (
                    SELECT r.id,h.coach_session_id AS conversation_id,r.created_at,
                           row_number() OVER (PARTITION BY h.coach_session_id
                                              ORDER BY r.created_at DESC, r.id DESC) AS rn
                    FROM practice_reports r
                    JOIN coaching_handoffs h ON h.id=r.source_handoff_id
                    JOIN coach_conversations c ON c.id=h.coach_session_id
                    WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                      WHERE e.source_table='practice_reports' AND e.source_id=r.id)
                ),
                picked AS (
                    SELECT * FROM candidate ORDER BY conversation_id, rn LIMIT :batch
                )
                SELECT gen_random_uuid(),'note','practice_reports',picked.id,
                       CASE WHEN picked.rn=1
                                 AND NOT EXISTS (SELECT 1 FROM coach_notes n
                                                 WHERE n.conversation_id=picked.conversation_id)
                            THEN picked.id END,
                       CASE WHEN picked.rn>1 THEN 'superseded_note'
                            WHEN EXISTS (SELECT 1 FROM coach_notes n
                                         WHERE n.conversation_id=picked.conversation_id)
                            THEN 'note_conflict' END,
                       :batchId,:now
                FROM picked
                """, batchId, batch, now);
    }

    /**
     * <b>{@code analysis}·{@code expression} 을 {@code action}·{@code observation} 으로 이름만 바꾸지
     * 않는다.</b> 기존 갈래 노트는 {@code legacy} 형식에 옛 종류를 그대로 두고, 신형 노트만
     * {@code v2} 로 옮겨 {@code mode} 를 종류로 삼는다. 요약 인용은 비워 둔다 — 옛 노트의 원문에는 발췌와
     * 출처의 짝이 남아 있지 않다(PA5 가 새 노트에서 되살리는 것은 생성 직후의 자료다).
     */
    private void applyNotes() {
        execute("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,summary_quotes,next_take,
                                        actor_words,corrections,tags,fallback,source_revision,
                                        legacy_report,created_at)
                SELECT e.target_id,h.coach_session_id,
                       CASE WHEN r.report_type='practice_note' THEN 'v2' ELSE 'legacy' END,
                       CASE WHEN r.report_type='practice_note'
                            THEN CASE WHEN r.report_json->>'mode'
                                           IN ('action','observation','record_only')
                                      THEN r.report_json->>'mode' ELSE 'record_only' END
                            ELSE r.report_type END,
                       CASE WHEN r.report_type='practice_note'
                            THEN CASE WHEN COALESCE(r.report_json->>'mode','record_only')='record_only'
                                      THEN NULL
                                      ELSE NULLIF(r.report_json->'copy'->>'title','') END
                            ELSE NULLIF(r.report_json->>'title','') END,
                       '[]'::jsonb,
                       CASE WHEN r.report_type='practice_note'
                            THEN NULLIF(r.report_json->'practice'->>'instruction','') END,
                       '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,false,
                       GREATEST(COALESCE(h.state_revision,0),0)::integer,
                       r.report_json,r.created_at
                FROM practice_migration_entries e
                JOIN practice_reports r ON r.id=e.source_id
                JOIN coaching_handoffs h ON h.id=r.source_handoff_id
                WHERE e.step='note' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM coach_notes n WHERE n.conversation_id=h.coach_session_id)
                ON CONFLICT (conversation_id) DO NOTHING
                """);
    }

    // --- ⑧ 배우 기억 (성별·나이 제외) -----------------------------------------

    private int planMemories(UUID batchId, int batch, Instant now) {
        return ledger("""
                SELECT gen_random_uuid(),'memory','actor_memory_entries',a.id,
                       CASE WHEN NOT EXISTS (SELECT 1 FROM actor_memories m
                                             WHERE m.user_id=a.user_id AND m.field=a.field::text)
                            THEN a.id END,
                       CASE WHEN EXISTS (SELECT 1 FROM actor_memories m
                                         WHERE m.user_id=a.user_id AND m.field=a.field::text)
                            THEN 'memory_exists' END,
                       :batchId,:now
                FROM actor_memory_entries a
                WHERE a.field::text NOT IN ('gender','age')
                  AND NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                  WHERE e.source_table='actor_memory_entries' AND e.source_id=a.id)
                ORDER BY a.created_at, a.id
                LIMIT :batch
                """, batchId, batch, now);
    }

    /** 성별·나이는 옮기지 않는다 — 프로필의 것이고, 자유 입력 나이로 생년월일을 추정하지도 않는다. */
    private void applyMemories() {
        execute("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,
                                           created_at,updated_at)
                SELECT e.target_id,a.user_id,a.field::text,a.value,a.written_by::text,
                       (SELECT p.id FROM practices p WHERE p.id=a.source_practice_session_id),
                       a.created_at,a.updated_at
                FROM practice_migration_entries e
                JOIN actor_memory_entries a ON a.id=e.source_id
                WHERE e.step='memory' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM actor_memories m
                                  WHERE m.user_id=a.user_id AND m.field=a.field::text)
                ON CONFLICT ON CONSTRAINT uq_actor_memories_user_field DO NOTHING
                """);
    }

    // --- ⑨ 옛 작업 장부 → ai_jobs (분석·기억 갱신, 끝난 것만) ------------------

    /**
     * <b>진행 중인 작업은 고르지 않는다.</b> 옛 워커가 끝내야 하고 두 큐에서 같은 작업이 동시에 돌면 안 된다
     * (02-practice ③). 대응표에 "건너뜀" 으로 적지도 않는다 — 끝나면 다음 실행이 집어 간다.
     */
    private int planAiJobs(UUID batchId, int batch, Instant now) {
        return ledger("""
                SELECT gen_random_uuid(),'ai_job','external_operations',o.id,
                       CASE WHEN NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.id=o.id)
                                 AND NOT EXISTS (SELECT 1 FROM ai_jobs j2
                                                 WHERE j2.user_id=o.user_id AND j2.request_id=o.request_id)
                            THEN o.id END,
                       CASE WHEN EXISTS (SELECT 1 FROM ai_jobs j WHERE j.id=o.id)
                                 OR EXISTS (SELECT 1 FROM ai_jobs j2
                                            WHERE j2.user_id=o.user_id AND j2.request_id=o.request_id)
                            THEN 'job_conflict' END,
                       :batchId,:now
                FROM external_operations o
                JOIN practices p ON p.id=o.session_id
                WHERE o.kind::text IN ('analyze','memory_update')
                  AND o.status::text IN ('succeeded','failed')
                  AND NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                                  WHERE e.source_table='external_operations' AND e.source_id=o.id)
                ORDER BY o.created_at, o.id
                LIMIT :batch
                """, batchId, batch, now);
    }

    /**
     * lease 는 옮기지 않는다 — 끝난 작업에는 주인이 없다. {@code memory_epoch} 도 비운다: 옛 예약에는 세대가
     * 없고, NULL 은 새 워커에게 "세대를 견주지 않는다" 는 뜻이다(practice.memory).
     */
    private void applyAiJobs() {
        execute("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,
                                    attempt_count,lease_token,lease_expires_at,failure_reason,result,
                                    memory_epoch,created_at,updated_at)
                SELECT e.target_id,o.user_id,o.kind::text,o.session_id,o.request_id,o.request_fingerprint,
                       o.status::text,o.attempt_count,NULL,NULL,o.error_code,o.response_payload,
                       NULL,o.created_at,o.updated_at
                FROM practice_migration_entries e
                JOIN external_operations o ON o.id=e.source_id
                WHERE e.step='ai_job' AND e.target_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.id=e.target_id)
                ON CONFLICT (user_id,request_id) DO NOTHING
                """);
    }

    // --- 공통 -----------------------------------------------------------------

    /** 고르기는 전부 같은 모양이다 — 대응표에 한 줄씩 적고 적은 수를 돌려준다. */
    private int ledger(String select, UUID batchId, int batch, Instant now) {
        Query query = entityManager.createNativeQuery("""
                INSERT INTO practice_migration_entries(id,step,source_table,source_id,target_id,
                                                       skip_reason,batch_id,created_at)
                """ + select + """
                ON CONFLICT ON CONSTRAINT uq_practice_migration_source DO NOTHING
                """)
                .setParameter("batchId", batchId)
                .setParameter("batch", batch)
                .setParameter("now", now.atOffset(ZoneOffset.UTC));
        return query.executeUpdate();
    }

    private void execute(String sql) {
        entityManager.createNativeQuery(sql).executeUpdate();
    }

    private int count(String step, UUID batchId, boolean movedRows) {
        return ((Number) entityManager.createNativeQuery("""
                SELECT count(*) FROM practice_migration_entries
                WHERE step=:step AND batch_id=:batchId AND target_id IS %s NULL
                """.formatted(movedRows ? "NOT" : ""))
                .setParameter("step", step)
                .setParameter("batchId", batchId)
                .getSingleResult()).intValue();
    }

    /** 대응표 전체의 건너뛴 사유별 수 — 운영이 "무엇이 옛 경로에 남았는가" 를 여기서 읽는다. */
    private Map<String, Integer> reasons() {
        Map<String, Integer> counted = new LinkedHashMap<>();
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT skip_reason,count(*) AS total
                FROM practice_migration_entries
                WHERE skip_reason IS NOT NULL
                GROUP BY skip_reason
                ORDER BY skip_reason
                """, Tuple.class));
        rows.forEach(row -> counted.put(
                row.get("skip_reason", String.class), ((Number) row.get("total")).intValue()));
        return Map.copyOf(counted);
    }
}
