package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Race;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Sent;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.ConversationView;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Replay;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Saved;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.support.AccountFixtures;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 코치 대화 저장소(시작·답·대화 읽기·이어하기)가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL
 * 에서 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>옮기는 문장은 {@code coach_conversations}·{@code coach_messages} 만 쓰는 것이다. 회차·영상·분석·사용자를 함께 보는 문장
 * (엔진이 읽는 묶음, 주인 잠금, 회차 닫기·되돌리기)과 옛 표를 읽는 문장은 네이티브로 남는다. HTTP 의 멱등·충돌·종료·노트는
 * {@link CoachConversationIT} 가 본다. 여기서는 포트의 저장 값(시각의 정밀도, 닫힌 시각, 상태 글), 요청 하나가 보내는 문장과
 * 트랜잭션의 수, 잠금의 세기와 차례, 같은 대화에 두 저장이 겹칠 때를 본다.
 */
@CoachStoreTest
class ConversationRepositoryIT {

    private static final String CONTINUE = "{\"message\":\"무엇이 달라졌나요\",\"status\":\"continue\",\"handoff\":null}";
    private static final String FINGERPRINT = "a".repeat(64);
    private static final String OWNER = "select coach_conversations,practices";
    private static final String LOAD = "select analyses,coach_conversations,practices,videos";
    private static final String USER_LOCK = "select users for update";
    private static final String CONVERSATION_LOCK = "select coach_conversations for update";
    private static final String MESSAGES = "select coach_messages";
    // 코치가 답을 만들 때 읽는 다른 기능의 것(배우 기억·지난 노트·프로필). 코치 저장소의 문장이 아니다.
    private static final String MEMORY = "select actor_memories,actor_memory_entries";
    private static final String PRIOR_NOTES = "select coach_conversations,coach_notes,practice_reports,practice_sessions,practices";
    private static final String PROFILE = "select user_identities,user_profile_directions,user_profiles,users";

    @Autowired
    CoachStoreFixture.Tools tools;

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @Autowired
    ConversationRepository conversations;

    @Autowired
    CoachConversationIT.StubGenerator generator;

    /** 나노초까지 있는 시각 — 저장은 마이크로초로 반올림된다. */
    private final Instant now = Instant.parse("2026-11-26T03:00:00.123456789Z");
    private final Instant stored = Instant.parse("2026-11-26T03:00:00.123457Z");

    private UUID member;
    private UUID practice;

    @BeforeEach
    void setUp() {
        tools.reset();
        generator.reset();
        member = member();
        practice = practice(member, "conversing", "legacy");
    }

    // ---- 포트 메서드마다 결과 ----

    @Test
    @DisplayName("open: 열린 대화 한 줄을 넘긴 시각으로 만든다(상태 {}·revision 0). 같은 회차에 다시 부르면 다른 요청 id 여도 그 대화이고 줄·시작 요청 id 가 그대로다")
    void openCreatesOneConversationPerPractice() {
        UUID request = UUID.randomUUID();

        UUID id = conversations.open(practice, request, now);
        UUID again = conversations.open(practice, UUID.randomUUID(), now.plusSeconds(60));

        assertThat(again).isEqualTo(id);
        assertThat(jdbc.queryForMap("""
                SELECT practice_id,start_request_id,status,close_reason,closed_at,state_revision,state::text AS state,
                       created_at=updated_at AS fresh
                FROM coach_conversations
                """))
                .containsEntry("practice_id", practice).containsEntry("start_request_id", request)
                .containsEntry("status", "open").containsEntry("close_reason", null).containsEntry("closed_at", null)
                .containsEntry("state_revision", 0).containsEntry("state", "{}").containsEntry("fresh", true);
        assertThat(instant("SELECT created_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored);
    }

    @Test
    @DisplayName("load: 대화가 없으면 conversationId 가 null 이고 턴이 없다. 있으면 턴이 turn_index 순서로 저장된 역할(ai·actor) 그대로 온다. 새 줄의 {} 는 null 상태이고 진행된 상태는 그대로 온다. 남의 것은 null 이다")
    void loadReadsTheTurnsInOrder() throws Exception {
        Loaded empty = conversations.loadByPractice(member, practice);
        assertThat(empty.conversationId()).isNull();
        assertThat(empty.stage()).isEqualTo("conversing");
        assertThat(empty.session().turns()).isEmpty();
        assertThat(empty.session().status()).isEqualTo("open");

        UUID id = conversations.open(practice, UUID.randomUUID(), now);
        assertThat(conversations.loadByConversation(member, id).session().coachingState()).isNull();
        message(id, 2, "ai", "둘째 질문");
        message(id, 0, "ai", "첫 질문");
        message(id, 1, "actor", "첫 답");
        jdbc.update("UPDATE coach_conversations SET state=CAST(? AS jsonb),state_revision=3 WHERE id=?",
                "{\"b\": 1, \"a\": \"가\"}", id);

        Loaded loaded = conversations.loadByConversation(member, id);

        assertThat(loaded.practiceId()).isEqualTo(practice);
        assertThat(loaded.conversationId()).isEqualTo(id);
        assertThat(loaded.session().turns()).containsExactly(
                new CoachTurnSnapshot("ai", "첫 질문"), new CoachTurnSnapshot("actor", "첫 답"),
                new CoachTurnSnapshot("ai", "둘째 질문"));
        assertThat(loaded.session().stateRevision()).isEqualTo(3);
        assertThat(loaded.session().coachingState()).isEqualTo(mapper.readTree("{\"a\":\"가\",\"b\":1}"));
        assertThat(conversations.loadByPractice(member, practice).session().turns()).hasSize(3);
        assertThat(conversations.loadByConversation(member(), id)).isNull();
        assertThat(conversations.loadByConversation(member, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("saveOpening: 코치의 첫 말을 턴 0 으로 넣고 상태를 갈아 끼우며 revision 을 하나 올린다(updated_at 은 넘긴 시각, closed_at 은 그대로). 이미 턴이 있으면 아무것도 쓰지 않는다. null 상태는 {} 로, null 말은 빈 글로 저장한다")
    void saveOpeningStoresTheFirstTurnOnce() throws Exception {
        UUID id = conversations.open(practice, UUID.randomUUID(), now.minusSeconds(60));

        conversations.saveOpening(id, "첫 질문", mapper.readTree("{\"step\":\"열기\",\"n\":1}"), null, now);

        assertThat(jdbc.queryForMap("""
                SELECT status,close_reason,closed_at,state_revision,state::text AS state FROM coach_conversations WHERE id=?
                """, id))
                .containsEntry("status", "open").containsEntry("close_reason", null).containsEntry("closed_at", null)
                .containsEntry("state_revision", 1).containsEntry("state", "{\"n\": 1, \"step\": \"열기\"}");
        assertThat(instant("SELECT updated_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored);
        assertThat(instant("SELECT created_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored.minusSeconds(60));
        assertThat(jdbc.queryForMap("SELECT turn_index,role,text,request_id,request_fingerprint FROM coach_messages"))
                .containsEntry("turn_index", 0).containsEntry("role", "ai").containsEntry("text", "첫 질문")
                .containsEntry("request_id", null).containsEntry("request_fingerprint", null);
        assertThat(instant("SELECT created_at FROM coach_messages")).isEqualTo(stored);
        assertThat(stage(practice)).isEqualTo("conversing");

        conversations.saveOpening(id, "다시 온 첫 질문", mapper.readTree("{\"step\":\"다시\"}"), "user_ended", now.plusSeconds(5));

        assertThat(count("coach_messages")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT status,state_revision FROM coach_conversations WHERE id=?", id))
                .containsEntry("status", "open").containsEntry("state_revision", 1);

        UUID other = conversations.open(practice(member, "conversing", "legacy"), UUID.randomUUID(), now);
        conversations.saveOpening(other, null, null, null, now);
        assertThat(jdbc.queryForObject("SELECT text FROM coach_messages WHERE conversation_id=?", String.class, other)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT state::text FROM coach_conversations WHERE id=?", String.class, other))
                .isEqualTo("{}");
        conversations.saveOpening(UUID.randomUUID(), "없는 대화", null, null, now);
        assertThat(count("coach_messages")).isEqualTo(2);
    }

    @Test
    @DisplayName("saveOpening: closeReason 이 있으면 첫 말과 함께 대화를 닫고(closed_at 은 넘긴 시각) 회차도 닫는다. 주인이 활성이 아니면 OwnerNotActive 이고 아무것도 쓰지 않는다")
    void saveOpeningCanCloseAtOnce() {
        UUID id = conversations.open(practice, UUID.randomUUID(), now.minusSeconds(60));

        conversations.saveOpening(id, "연기 장면이 아니에요", null, "exhausted", now);

        assertThat(jdbc.queryForMap("SELECT status,close_reason,state_revision FROM coach_conversations WHERE id=?", id))
                .containsEntry("status", "closed").containsEntry("close_reason", "exhausted").containsEntry("state_revision", 1);
        assertThat(instant("SELECT closed_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored);
        assertThat(jdbc.queryForMap("SELECT stage,close_reason FROM practices WHERE id=?", practice))
                .containsEntry("stage", "closed").containsEntry("close_reason", "conversation_closed");
        assertThat(instant("SELECT updated_at FROM practices WHERE id=?", practice)).isEqualTo(stored);

        UUID gone = member();
        UUID theirs = conversations.open(practice(gone, "conversing", "legacy"), UUID.randomUUID(), now);
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", gone);
        assertThatThrownBy(() -> conversations.saveOpening(theirs, "늦은 첫 말", null, null, now))
                .isInstanceOf(ConversationRepository.OwnerNotActive.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coach_messages WHERE conversation_id=?", Integer.class, theirs))
                .isZero();
    }

    @Test
    @DisplayName("appendTurn: 배우 말(요청 id·지문)과 코치 말을 다음 두 번호로 넣고 상태·revision 을 올린다. 코치 응답 수는 ai 턴 수다. 닫지 않으면 closed_at 은 그대로다. 낡은 revision·없는 대화는 null 이고 아무것도 쓰지 않는다")
    void appendTurnStoresBothTurnsAndBumpsTheRevision() throws Exception {
        UUID id = opened();
        UUID request = UUID.randomUUID();

        Saved saved = conversations.appendTurn(id, 1, request, FINGERPRINT, "숨이 막혔어요", "그때 무엇을 느꼈나요",
                mapper.readTree("{\"step\":\"묻기\"}"), "open", null, now);

        assertThat(saved).isEqualTo(new Saved(2, "open", null, 2));
        assertThat(jdbc.queryForList("""
                SELECT turn_index,role,text,request_id,request_fingerprint::text AS fingerprint FROM coach_messages
                WHERE turn_index>0 ORDER BY turn_index
                """)).satisfiesExactly(
                actor -> assertThat(actor).containsEntry("turn_index", 1).containsEntry("role", "actor")
                        .containsEntry("text", "숨이 막혔어요").containsEntry("request_id", request)
                        .containsEntry("fingerprint", FINGERPRINT),
                coach -> assertThat(coach).containsEntry("turn_index", 2).containsEntry("role", "ai")
                        .containsEntry("text", "그때 무엇을 느꼈나요").containsEntry("request_id", null)
                        .containsEntry("fingerprint", null));
        assertThat(jdbc.queryForList("SELECT created_at FROM coach_messages WHERE turn_index>0", OffsetDateTime.class))
                .allSatisfy(at -> assertThat(at.toInstant()).isEqualTo(stored));
        assertThat(jdbc.queryForMap("""
                SELECT status,close_reason,closed_at,state_revision,state::text AS state FROM coach_conversations WHERE id=?
                """, id))
                .containsEntry("status", "open").containsEntry("close_reason", null).containsEntry("closed_at", null)
                .containsEntry("state_revision", 2).containsEntry("state", "{\"step\": \"묻기\"}");
        assertThat(instant("SELECT updated_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored);
        assertThat(stage(practice)).isEqualTo("conversing");

        assertThat(conversations.appendTurn(id, 1, UUID.randomUUID(), FINGERPRINT, "낡은 답", "x", null, "open", null, now))
                .as("낡은 revision").isNull();
        assertThat(conversations.appendTurn(UUID.randomUUID(), 0, UUID.randomUUID(), FINGERPRINT, "없는 대화", "x", null,
                "open", null, now)).isNull();
        assertThat(count("coach_messages")).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT state_revision FROM coach_conversations WHERE id=?", Integer.class, id))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("appendTurn: closed 로 저장하면 종료 사유와 closed_at(넘긴 시각)이 남고 회차도 닫힌다. 닫힌 대화에는 revision 이 맞아도 쓰지 않는다. null 상태는 {} 다. 주인이 활성이 아니면 OwnerNotActive 다")
    void appendTurnCanCloseTheConversationAndThePractice() {
        UUID id = opened();

        Saved closed = conversations.appendTurn(id, 1, UUID.randomUUID(), FINGERPRINT, "그만", "오늘은 여기까지 해요", null,
                "closed", "user_ended", now);

        assertThat(closed).isEqualTo(new Saved(2, "closed", "user_ended", 2));
        assertThat(jdbc.queryForMap("SELECT status,close_reason,state::text AS state FROM coach_conversations WHERE id=?", id))
                .containsEntry("status", "closed").containsEntry("close_reason", "user_ended").containsEntry("state", "{}");
        assertThat(instant("SELECT closed_at FROM coach_conversations WHERE id=?", id)).isEqualTo(stored);
        assertThat(jdbc.queryForMap("SELECT stage,close_reason FROM practices WHERE id=?", practice))
                .containsEntry("stage", "closed").containsEntry("close_reason", "conversation_closed");
        assertThat(conversations.appendTurn(id, 2, UUID.randomUUID(), FINGERPRINT, "닫힌 뒤", "x", null, "open", null, now))
                .as("닫힌 대화").isNull();
        assertThat(count("coach_messages")).isEqualTo(3);

        UUID gone = member();
        UUID theirs = conversations.open(practice(gone, "conversing", "legacy"), UUID.randomUUID(), now);
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", gone);
        assertThatThrownBy(() -> conversations.appendTurn(theirs, 0, UUID.randomUUID(), FINGERPRINT, "늦은 답", "x", null,
                "open", null, now)).isInstanceOf(ConversationRepository.OwnerNotActive.class);
    }

    @Test
    @DisplayName("무료 코칭 한도(배우 답 7번)가 견주는 코치 응답 수: 시작 응답을 넣어 ai 턴만 센다 — 배우 답 7번 뒤 8 이다. 한도가 켜져 있으면 한도가 걸리는 회원의 신형 대화는 reply_limit 8, Pro 회원과 옛 갈래 대화는 기본 상한이다")
    void theFreeLimitCountsCoachRepliesOnly() throws Exception {
        UUID id = opened();
        Saved last = null;
        for (int answer = 1; answer <= 7; answer++) {
            last = conversations.appendTurn(id, answer, UUID.randomUUID(), FINGERPRINT, "답 " + answer, "코치 " + answer, null,
                    "open", null, now);
        }
        assertThat(last.coachReplyCount()).isEqualTo(8);
        assertThat(count("coach_messages")).isEqualTo(15);

        passGate(member);
        UUID modern = conversations.open(practice(member, "conversing", "three_layers_v1"), UUID.randomUUID(), now);
        UUID pro = member();
        passGate(pro);
        jdbc.update("INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason) VALUES (?,?,?,?,'promo')",
                UUID.randomUUID(), pro, utc(Instant.now().minusSeconds(60)), utc(Instant.now().plusSeconds(3600)));
        UUID proModern = conversations.open(practice(pro, "conversing", "three_layers_v1"), UUID.randomUUID(), now);

        assertThat(json(get("/v2/coach/conversations/{id}", modern), member).path("reply_limit").asInt()).isEqualTo(8);
        assertThat(json(get("/v2/coach/conversations/{id}", id), member).path("reply_limit").asInt())
                .isEqualTo(ConversationService.LEGACY_REPLY_LIMIT);
        assertThat(json(get("/v2/coach/conversations/{id}", proModern), pro).path("reply_limit").asInt())
                .isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
    }

    @Test
    @DisplayName("findReplay: 그 요청이 만든 코치 말과 그때의 결과를 돌려준다. 뒤에 답이 더 쌓였으면 그때는 열려 있었고 revision 은 뒤의 답 수만큼 앞이다. 지문이 다르면 mismatch, 없는 요청은 null 이다")
    void findReplayRebuildsTheOutcomeOfThatRequest() {
        UUID id = opened();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        conversations.appendTurn(id, 1, first, FINGERPRINT, "첫 답", "둘째 질문", null, "open", null, now);

        assertThat(conversations.findReplay(id, first, FINGERPRINT)).isEqualTo(new Replay(false, "둘째 질문", "open", null, 2, 3));

        conversations.appendTurn(id, 2, second, FINGERPRINT, "그만", "마무리", null, "closed", "user_ended", now);

        assertThat(conversations.findReplay(id, second, FINGERPRINT))
                .isEqualTo(new Replay(false, "마무리", "closed", "user_ended", 3, 5));
        assertThat(conversations.findReplay(id, first, FINGERPRINT)).as("뒤에 답이 하나 더 있다")
                .isEqualTo(new Replay(false, "둘째 질문", "open", null, 2, 3));
        assertThat(conversations.findReplay(id, first, "b".repeat(64))).isEqualTo(new Replay(true, null, null, null, 0, 0));
        assertThat(conversations.findReplay(id, UUID.randomUUID(), FINGERPRINT)).isNull();
        assertThat(conversations.findReplay(UUID.randomUUID(), first, FINGERPRINT)).isNull();
    }

    @Test
    @DisplayName("conversation: 머리와 턴을 turn_index 순서로 읽고 저장된 ai 를 coach 로 보인다. 턴의 시각은 저장된 시각이다. 남의 대화와 없는 대화는 null 이다")
    void conversationReadsTheTurnsForTheScreen() {
        UUID id = opened();
        conversations.appendTurn(id, 1, UUID.randomUUID(), FINGERPRINT, "첫 답", "둘째 질문", null, "open", null, now);

        ConversationView view = conversations.conversation(member, id);

        assertThat(view.id()).isEqualTo(id);
        assertThat(view.practiceId()).isEqualTo(practice);
        assertThat(view.status()).isEqualTo("open");
        assertThat(view.closeReason()).isNull();
        assertThat(view.experienceVersion()).isEqualTo("legacy");
        assertThat(view.revision()).isEqualTo(2);
        assertThat(view.createdAt()).isEqualTo(stored.minusSeconds(60));
        assertThat(view.turns()).extracting(ConversationRepository.Turn::turnIndex).containsExactly(0, 1, 2);
        assertThat(view.turns()).extracting(ConversationRepository.Turn::role).containsExactly("coach", "actor", "coach");
        assertThat(view.turns()).extracting(ConversationRepository.Turn::text).containsExactly("첫 질문", "첫 답", "둘째 질문");
        assertThat(view.turns()).extracting(ConversationRepository.Turn::createdAt)
                .containsExactly(stored.minusSeconds(30), stored, stored);
        assertThat(conversations.conversation(member(), id)).isNull();
        assertThat(conversations.conversation(member, UUID.randomUUID())).isNull();
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("시작 응답 저장·답 저장·이어하기는 대화 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다. 기다리는 동안 주인의 사용자 행은 이미 잡혀 있다(사용자 → 대화 차례)")
    void theConversationRowIsLockedForUpdateAfterTheOwner() throws Exception {
        UUID fresh = conversations.open(practice(member, "conversing", "legacy"), UUID.randomUUID(), now);
        UUID open = opened();
        UUID closedPractice = practice(member, "closed", "legacy");
        UUID closed = conversations.open(closedPractice, UUID.randomUUID(), now);
        jdbc.update("UPDATE coach_conversations SET status='closed',close_reason='user_ended',closed_at=now() WHERE id=?", closed);
        record Case(String name, UUID row, Supplier<?> write) {
        }
        List<Case> cases = List.of(
                new Case("saveOpening", fresh, () -> {
                    conversations.saveOpening(fresh, "첫 질문", null, null, now);
                    return null;
                }),
                new Case("appendTurn", open, () -> conversations.appendTurn(open, 1, UUID.randomUUID(), FINGERPRINT, "답",
                        "질문", null, "open", null, now)),
                new Case("reopen", closed, () -> conversations.reopen(closed, 0, null, now)));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = tools.probe(); Connection second = tools.probe()) {
            for (Case each : cases) {
                lock(probe, "SELECT 1 FROM coach_conversations WHERE id=? FOR KEY SHARE", each.row());
                Future<?> waiting = pool.submit(each.write()::get);
                String statement = tools.awaitWaiting("from coach_conversations").toLowerCase(Locale.ROOT);
                boolean ownerHeld = !free(second, "SELECT 1 FROM users WHERE id=? FOR UPDATE SKIP LOCKED", member);
                second.rollback();
                probe.rollback();
                waiting.get(20, TimeUnit.SECONDS);
                assertThat(statement).as(each.name()).startsWith("select").contains("for update").doesNotContain("no key");
                assertThat(ownerHeld).as(each.name() + ": 사용자 행을 먼저 잡았다").isTrue();
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coach_messages WHERE conversation_id=?", Integer.class, fresh))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT state_revision FROM coach_conversations WHERE id=?", Integer.class, open))
                .isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT status FROM coach_conversations WHERE id=?", String.class, closed)).isEqualTo("open");
        assertThat(stage(closedPractice)).isEqualTo("conversing");
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 대화에 같은 revision 으로 두 답이 함께 오면 뒤의 것이 주인의 사용자 행에서 기다렸다가 아무것도 쓰지 않는다(null → 409). 앞의 것만 저장된다")
    void twoRepliesAtOnce() throws Exception {
        UUID id = opened();

        Race<Saved, Saved> race = tools.race(
                () -> conversations.appendTurn(id, 1, UUID.randomUUID(), FINGERPRINT, "앞의 답", "앞의 질문", null, "open", null, now),
                () -> conversations.appendTurn(id, 1, UUID.randomUUID(), FINGERPRINT, "뒤의 답", "뒤의 질문", null, "open", null, now),
                "from users");

        assertThat(race.first()).isEqualTo(new Saved(2, "open", null, 2));
        assertThat(race.second()).isNull();
        assertThat(jdbc.queryForList("SELECT text FROM coach_messages ORDER BY turn_index", String.class))
                .containsExactly("첫 질문", "앞의 답", "앞의 질문");
        assertThat(jdbc.queryForObject("SELECT state_revision FROM coach_conversations WHERE id=?", Integer.class, id))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("같은 회차의 대화를 두 요청이 함께 열면 뒤의 넣기가 앞의 커밋을 기다렸다가 넣지 않고 앞의 대화를 돌려준다")
    void twoOpensAtOnce() throws Exception {
        UUID firstRequest = UUID.randomUUID();

        Race<UUID, UUID> race = tools.race(
                () -> conversations.open(practice, firstRequest, now),
                () -> conversations.open(practice, UUID.randomUUID(), now),
                "insert into coach_conversations");

        assertThat(race.second()).isEqualTo(race.first());
        assertThat(count("coach_conversations")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT start_request_id FROM coach_conversations", UUID.class)).isEqualTo(firstRequest);
    }

    @Test
    @DisplayName("같은 대화의 시작 응답을 두 요청이 함께 저장하면 뒤의 것이 기다렸다가 턴이 있는 것을 보고 아무것도 쓰지 않는다")
    void twoOpeningsAtOnce() throws Exception {
        UUID id = conversations.open(practice, UUID.randomUUID(), now);

        tools.race(() -> {
            conversations.saveOpening(id, "앞의 첫 질문", null, null, now);
            return null;
        }, () -> {
            conversations.saveOpening(id, "뒤의 첫 질문", null, null, now);
            return null;
        }, "from users");

        assertThat(jdbc.queryForList("SELECT text FROM coach_messages", String.class)).containsExactly("앞의 첫 질문");
        assertThat(jdbc.queryForObject("SELECT state_revision FROM coach_conversations WHERE id=?", Integer.class, id))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("바깥 호출(모델)이 도는 사이에 다른 요청이 같은 대화에 저장하면, 뒤에 도착한 답은 저장되지 않고 409 conversation_conflict 다")
    void aReplySavedDuringTheModelCallWins() throws Exception {
        passGate(member);
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), member);
        UUID id = UUID.fromString(started.path("conversation").path("id").asString());
        long revision = started.path("conversation").path("revision").asLong();
        generator.enqueue(CONTINUE);
        generator.duringNextCall(() -> conversations.appendTurn(id, revision, UUID.randomUUID(), FINGERPRINT, "먼저 온 답",
                "먼저 온 질문", null, "open", null, now));

        var response = mvc.perform(post("/v2/coach/reply").contentType(MediaType.APPLICATION_JSON)
                .content(replyBody(id, UUID.randomUUID(), "늦게 온 답", revision))
                .header("Authorization", bearer(member))).andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"conversation_conflict\"}"));
        assertThat(jdbc.queryForList("SELECT text FROM coach_messages ORDER BY turn_index", String.class))
                .containsExactly("무엇이 달라졌나요", "먼저 온 답", "먼저 온 질문");
        assertThat(jdbc.queryForObject("SELECT state_revision FROM coach_conversations WHERE id=?", Long.class, id))
                .isEqualTo(revision + 1);
    }

    // ---- 문장과 트랜잭션 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류(읽고 쓰는 표의 모음으로 줄인다)와 새로 여는 트랜잭션 수")
    void eachPortMethodSendsTheseStatements() {
        UUID closedPractice = practice(member, "closed", "legacy");
        UUID closed = conversations.open(closedPractice, UUID.randomUUID(), now);
        jdbc.update("UPDATE coach_conversations SET status='closed',close_reason='user_ended',closed_at=now() WHERE id=?", closed);
        UUID request = UUID.randomUUID();
        UUID[] id = new UUID[1];

        assertThat(tools.sent(() -> conversations.loadByPractice(member, practice))).as("대화가 없을 때")
                .isEqualTo(new Sent(0, List.of(LOAD)));
        assertThat(tools.sent(() -> conversations.practiceLanguage(member, practice))).isEqualTo(new Sent(0, List.of("select practices")));
        assertThat(tools.sent(() -> id[0] = conversations.open(practice, UUID.randomUUID(), now)))
                .isEqualTo(new Sent(1, List.of("insert coach_conversations", "select coach_conversations")));
        assertThat(tools.sent(() -> conversations.loadByConversation(member, id[0]))).isEqualTo(new Sent(0, List.of(LOAD, MESSAGES)));
        assertThat(tools.sent(() -> {
            conversations.saveOpening(id[0], "첫 질문", null, null, now);
            return null;
        })).isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES, "insert coach_messages",
                "update coach_conversations")));
        assertThat(tools.sent(() -> {
            conversations.saveOpening(id[0], "다시", null, null, now);
            return null;
        })).as("이미 턴이 있을 때").isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES)));
        assertThat(tools.sent(() -> conversations.findReplay(id[0], request, FINGERPRINT)))
                .isEqualTo(new Sent(0, List.of("select coach_conversations,coach_messages")));
        assertThat(tools.sent(() -> conversations.appendTurn(id[0], 1, request, FINGERPRINT, "답", "질문", null, "open", null, now)))
                .as("답 저장")
                .isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES, "insert coach_messages",
                        "insert coach_messages", "update coach_conversations", MESSAGES)));
        assertThat(tools.sent(() -> conversations.appendTurn(id[0], 1, UUID.randomUUID(), FINGERPRINT, "낡은", "x", null, "open", null,
                now))).as("낡은 revision").isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK)));
        assertThat(tools.sent(() -> conversations.appendTurn(id[0], 2, UUID.randomUUID(), FINGERPRINT, "그만", "마무리", null, "closed",
                "user_ended", now))).as("닫는 답")
                .isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES, "insert coach_messages",
                        "insert coach_messages", "update coach_conversations", "update coach_conversations,practices", MESSAGES)));
        assertThat(tools.sent(() -> conversations.conversation(member, id[0])))
                .isEqualTo(new Sent(0, List.of(OWNER, MESSAGES)));
        assertThat(tools.sent(() -> conversations.reopen(closed, 0, null, now)))
                .isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK,
                        "select coach_conversations,practices for update", "select coach_conversations,practices",
                        "update coach_conversations", "update coach_conversations,practices", MESSAGES)));
        UUID other = conversations.open(practice(member, "conversing", "legacy"), UUID.randomUUID(), now);
        assertThat(tools.sent(() -> {
            conversations.saveOpening(other, "닫으며 시작", null, "exhausted", now);
            return null;
        })).as("닫으며 시작").isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES,
                "insert coach_messages", "update coach_conversations", "update coach_conversations,practices")));
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장과 트랜잭션: 코치 시작, 답, 같은 답 재전송, 대화 읽기 — 요청이 많은 경로")
    void eachRequestSendsTheseStatements() throws Exception {
        passGate(member);
        String token = bearer(member);
        generator.enqueue(CONTINUE);
        JsonNode[] started = new JsonNode[1];

        Sent start = tools.sent(() -> started[0] = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), token));
        UUID id = UUID.fromString(started[0].path("conversation").path("id").asString());
        long revision = started[0].path("conversation").path("revision").asLong();
        UUID request = UUID.randomUUID();
        generator.enqueue(CONTINUE);
        Sent reply = tools.sent(() -> json(post("/v2/coach/reply").content(replyBody(id, request, "숨이 막혔어요", revision)), token));
        Sent replay = tools.sent(() -> json(post("/v2/coach/reply").content(replyBody(id, request, "숨이 막혔어요", revision + 1)), token));
        Sent read = tools.sent(() -> json(get("/v2/coach/conversations/{id}", id), token));

        List<String> gate = start.statements().subList(0, start.statements().indexOf(LOAD));
        assertThat(gate).as("인증·동의·프로필 확인(코치의 문장이 아니다)").isNotEmpty().noneMatch(sql -> sql.contains("coach_"));
        assertThat(start.withoutPrefix(gate)).as("코치 시작").isEqualTo(new Sent(2, List.of(
                LOAD, "insert coach_conversations", "select coach_conversations", LOAD, MESSAGES,
                "select practices", MEMORY, PRIOR_NOTES, PROFILE,
                OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES, "insert coach_messages", "update coach_conversations",
                LOAD, MESSAGES)));
        assertThat(reply.withoutPrefix(gate)).as("코치 답").isEqualTo(new Sent(1, List.of(
                LOAD, MESSAGES, "select coach_conversations,coach_messages",
                "select practices", MEMORY, PRIOR_NOTES, PROFILE,
                OWNER, USER_LOCK, OWNER, CONVERSATION_LOCK, MESSAGES, "insert coach_messages", "insert coach_messages",
                "update coach_conversations", MESSAGES, LOAD, MESSAGES)));
        assertThat(replay.withoutPrefix(gate)).as("같은 답 재전송")
                .isEqualTo(new Sent(0, List.of(LOAD, MESSAGES, "select coach_conversations,coach_messages")));
        assertThat(read.withoutPrefix(gate)).as("대화 읽기").isEqualTo(new Sent(0, List.of(OWNER, MESSAGES)));
    }

    // ---- 도움 ----

    /** 첫 질문(턴 0, revision 1)까지 저장된 열린 대화. 대화는 60초 전에, 첫 질문은 30초 전에 저장됐다. */
    private UUID opened() {
        UUID id = conversations.open(practice, UUID.randomUUID(), now.minusSeconds(60));
        conversations.saveOpening(id, "첫 질문", null, null, now.minusSeconds(30));
        return id;
    }

    private void message(UUID conversation, int index, String role, String text) {
        jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,?,?,?)",
                UUID.randomUUID(), conversation, index, role, text);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    private void passGate(UUID user) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), user, "g-" + user);
        AccountFixtures.passGate(jdbc, user);
    }

    /** 분석이 끝난 회차. */
    private UUID practice(UUID owner, String stage, String experience) {
        UUID video = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, owner, "videos/" + owner + "/" + video + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                      blockage_kind,sub_branch,situation)
                VALUES (?,?,?,?,1,?,?,?,'분석','캐릭터 분석','문 앞에서 돌아선다')
                """, id, owner, video, id, stage, "closed".equals(stage) ? "conversation_closed" : null, experience);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'legacy','ready','test-model',CAST(? AS jsonb),now())
                """, UUID.randomUUID(), id, "{\"scene_summary\":\"문 앞에서 돌아선다\",\"observations\":[],\"uncertainties\":[]}");
        return id;
    }

    private String stage(UUID practiceId) {
        return jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, practiceId);
    }

    private String bearer(UUID user) {
        return "Bearer " + jwt.issueAccessToken(user).value();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, UUID user) throws Exception {
        return json(request, bearer(user));
    }

    private JsonNode json(MockHttpServletRequestBuilder request, String bearer) throws Exception {
        var response = mvc.perform(request.contentType(MediaType.APPLICATION_JSON).header("Authorization", bearer))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private static String startBody(UUID practiceId, UUID requestId) {
        return "{\"practice_id\":\"" + practiceId + "\",\"request_id\":\"" + requestId + "\"}";
    }

    private static String replyBody(UUID conversationId, UUID requestId, String text, long revision) {
        return "{\"conversation_id\":\"" + conversationId + "\",\"request_id\":\"" + requestId + "\",\"text\":\"" + text
                + "\",\"revision\":" + revision + "}";
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private static void lock(Connection probe, String sql, UUID id) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    /** 그 행을 지금 잡을 수 있으면 참이다(SKIP LOCKED 가 건너뛰지 않는다). */
    private static boolean free(Connection probe, String sql, UUID id) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
            statement.setObject(1, id);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next();
            }
        }
    }
}
