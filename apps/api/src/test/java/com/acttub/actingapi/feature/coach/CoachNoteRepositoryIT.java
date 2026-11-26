package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Race;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Sent;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NewNote;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 코치 대화 저장소의 노트 쪽(만들기·고쳐 쓰기·대사별 메모·읽기)이 내는 결과·경합·문장을 고정한다. 옮기는 문장은
 * {@code coach_notes} 와 대화 행만 쓰는 것이다. 주인 확인(practices)·사용자 행 잠금·옛 노트 읽기는 네이티브로 남는다. HTTP 의
 * 노트 생성과 조회는 {@link CoachConversationIT}, 평가가 실린 조회는 {@link NoteRatingIT} 가 본다.
 */
@CoachStoreTest
class CoachNoteRepositoryIT {
    private static final String OWNER = "select coach_conversations,practices";
    private static final String USER_LOCK = "select users for update";
    private static final String NOTE = "select coach_conversations,coach_notes";

    @Autowired
    CoachStoreFixture.Tools tools;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    ConversationRepository conversations;

    /** 나노초까지 있는 시각 — 저장은 마이크로초로 반올림된다. */
    private final Instant now = Instant.parse("2026-11-26T03:00:00.123456789Z");
    private final Instant stored = Instant.parse("2026-11-26T03:00:00.123457Z");

    private UUID member;
    private UUID practice;
    private UUID conversation;

    @BeforeEach
    void setUp() {
        tools.reset();
        member = tools.member();
        practice = tools.practice(member);
        conversation = tools.conversation(practice);
    }

    @Test
    @DisplayName("saveNote: 노트를 한 번 만든다 — 글 칸과 jsonb 칸이 넘긴 값 그대로이고 만든 시각은 넘긴 시각, 대사별 메모는 빈 배열이다. 원문이 없으면 legacy_report 는 SQL NULL 이 아니라 JSON null 이다. 이미 있으면 새로 쓰지 않고 있던 것을 돌려준다")
    void saveNoteWritesOnce() throws Exception {
        NoteView saved = conversations.saveNote(conversation, note("붙잡는 순간", "시선을 두고 찍어보세요", 4, null), now);

        assertThat(saved.conversationId()).isEqualTo(conversation);
        assertThat(saved.format()).isEqualTo("v2");
        assertThat(saved.kind()).isEqualTo("action");
        assertThat(saved.title()).isEqualTo("붙잡는 순간");
        assertThat(saved.summaryQuotes()).isEqualTo(mapper.readTree("[{\"quote\":\"가지 마\",\"kind\":\"actor\",\"source_ref\":\"turn:1\"}]"));
        assertThat(saved.nextTake()).isEqualTo("시선을 두고 찍어보세요");
        assertThat(saved.actorWords()).isEqualTo(mapper.readTree("[\"숨이 막혔어요\"]"));
        assertThat(saved.corrections()).isEqualTo(mapper.readTree("[\"화난 게 아니에요\"]"));
        assertThat(saved.tags()).isEqualTo(mapper.readTree("[\"시선\"]"));
        assertThat(saved.fallback()).isTrue();
        assertThat(saved.sourceRevision()).isEqualTo(4);
        assertThat(saved.legacyReport().isNull()).as("JSON null 로 읽힌다").isTrue();
        assertThat(saved.createdAt()).isEqualTo(stored);
        assertThat(saved.lineNotes()).isEqualTo(mapper.readTree("[]"));
        assertThat(jdbc.queryForMap("""
                SELECT id,legacy_report IS NULL AS sql_null,jsonb_typeof(legacy_report) AS report_type,
                       summary_quotes::text AS quotes,line_notes::text AS line_notes
                FROM coach_notes
                """))
                .containsEntry("id", saved.id()).containsEntry("sql_null", false).containsEntry("report_type", "null")
                .containsEntry("quotes", "[{\"kind\": \"actor\", \"quote\": \"가지 마\", \"source_ref\": \"turn:1\"}]").containsEntry("line_notes", "[]");

        NoteView again = conversations.saveNote(conversation,
                note("다른 제목", "다른 제안", 9, mapper.readTree("{\"title\":\"원문\"}")), now.plusSeconds(60));

        assertThat(again).isEqualTo(saved);
        assertThat(tools.count("coach_notes")).isEqualTo(1);
    }

    @Test
    @DisplayName("saveNote: 원문이 있으면 그대로 저장하고, 제목·다음 제안이 없으면 NULL 이다. 없는 대화는 null, 주인이 활성이 아니면 OwnerNotActive 이고 아무것도 쓰지 않는다")
    void saveNoteKeepsTheReportAndRefusesInactiveOwners() throws Exception {
        NoteView saved = conversations.saveNote(conversation,
                new NewNote("legacy", "analysis", null, mapper.readTree("[]"), null, mapper.readTree("[]"), mapper.readTree("[]"),
                        mapper.readTree("[]"), false, 2, mapper.readTree("{\"title\":\"원문\",\"n\":1}")), now);

        assertThat(saved.format()).isEqualTo("legacy");
        assertThat(saved.title()).isNull();
        assertThat(saved.nextTake()).isNull();
        assertThat(saved.fallback()).isFalse();
        assertThat(saved.legacyReport()).isEqualTo(mapper.readTree("{\"n\":1,\"title\":\"원문\"}"));
        assertThat(saved.summaryQuotes()).isEqualTo(mapper.readTree("[]"));
        assertThat(conversations.saveNote(UUID.randomUUID(), note("x", "y", 1, null), now)).isNull();

        UUID gone = tools.member();
        UUID theirs = tools.conversation(tools.practice(gone));
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", gone);
        assertThatThrownBy(() -> conversations.saveNote(theirs, note("늦은 노트", "y", 1, null), now))
                .isInstanceOf(ConversationRepository.OwnerNotActive.class);
        assertThatThrownBy(() -> conversations.replaceNote(theirs, note("늦은 노트", "y", 1, null), now))
                .isInstanceOf(ConversationRepository.OwnerNotActive.class);
        assertThat(tools.count("coach_notes")).isEqualTo(1);
    }

    @Test
    @DisplayName("saveLineNotes: 그 대화의 노트에 대사별 메모를 통째로 갈아 끼운다. 다른 칸은 그대로다. 노트가 없으면 아무것도 쓰지 않는다")
    void saveLineNotesReplacesTheWholeValue() throws Exception {
        conversations.saveLineNotes(conversation, mapper.readTree("[{\"line\":\"없는 노트\"}]"));
        assertThat(tools.count("coach_notes")).isZero();
        NoteView saved = conversations.saveNote(conversation, note("붙잡는 순간", "시선을 두고 찍어보세요", 4, null), now);

        conversations.saveLineNotes(conversation,
                mapper.readTree("[{\"line\":\"가지 마\",\"seen\":\"손이 먼저 나갔다\",\"try\":\"한 박자 늦게\"}]"));

        NoteView read = conversations.note(member, practice);
        assertThat(read.lineNotes())
                .isEqualTo(mapper.readTree("[{\"line\":\"가지 마\",\"seen\":\"손이 먼저 나갔다\",\"try\":\"한 박자 늦게\"}]"));
        assertThat(read.title()).isEqualTo(saved.title());
        assertThat(read.createdAt()).isEqualTo(stored);
        assertThat(jdbc.queryForObject("SELECT line_notes::text FROM coach_notes", String.class))
                .isEqualTo("[{\"try\": \"한 박자 늦게\", \"line\": \"가지 마\", \"seen\": \"손이 먼저 나갔다\"}]");
    }

    @Test
    @DisplayName("replaceNote: 있던 노트의 id 와 만든 시각을 지키며 내용을 새것으로 고치고 대사별 메모를 빈 배열로 되돌린다. 원문이 없으면 JSON null 로 덮는다. 없으면 넘긴 시각으로 새로 만든다")
    void replaceNoteKeepsTheRowAndClearsLineNotes() throws Exception {
        NoteView first = conversations.replaceNote(conversation,
                note("처음 제목", "처음 제안", 3, mapper.readTree("{\"title\":\"원문\"}")), now);
        conversations.saveLineNotes(conversation, mapper.readTree("[{\"line\":\"가지 마\"}]"));

        NoteView second = conversations.replaceNote(conversation,
                new NewNote("v2", "observation", null, mapper.readTree("[]"), null, mapper.readTree("[\"새 말\"]"),
                        mapper.readTree("[]"), mapper.readTree("[\"호흡\",\"시선\"]"), false, 9, null),
                now.plusSeconds(60));

        assertThat(first.createdAt()).isEqualTo(stored);
        assertThat(second.id()).isEqualTo(first.id());
        assertThat(second.createdAt()).as("만든 시각은 그대로다").isEqualTo(stored);
        assertThat(second.kind()).isEqualTo("observation");
        assertThat(second.title()).isNull();
        assertThat(second.nextTake()).isNull();
        assertThat(second.summaryQuotes()).isEqualTo(mapper.readTree("[]"));
        assertThat(second.actorWords()).isEqualTo(mapper.readTree("[\"새 말\"]"));
        assertThat(second.tags()).isEqualTo(mapper.readTree("[\"호흡\",\"시선\"]"));
        assertThat(second.fallback()).isFalse();
        assertThat(second.sourceRevision()).isEqualTo(9);
        assertThat(second.legacyReport().isNull()).isTrue();
        assertThat(second.lineNotes()).isEqualTo(mapper.readTree("[]"));
        assertThat(jdbc.queryForMap("SELECT legacy_report IS NULL AS sql_null,jsonb_typeof(legacy_report) AS report_type FROM coach_notes"))
                .containsEntry("sql_null", false).containsEntry("report_type", "null");
        assertThat(tools.count("coach_notes")).isEqualTo(1);
        assertThat(conversations.replaceNote(UUID.randomUUID(), note("x", "y", 1, null), now)).isNull();
    }

    @Test
    @DisplayName("note: 내 회차의 노트를 읽는다. 남의 회차·노트가 없는 회차·없는 회차는 null 이다")
    void noteReadsMyPracticeOnly() {
        UUID quiet = tools.practice(member);
        tools.conversation(quiet);
        NoteView saved = conversations.saveNote(conversation, note("붙잡는 순간", "시선을 두고 찍어보세요", 4, null), now);

        assertThat(conversations.note(member, practice)).isEqualTo(saved);
        assertThat(conversations.note(tools.member(), practice)).isNull();
        assertThat(conversations.note(member, quiet)).isNull();
        assertThat(conversations.note(member, UUID.randomUUID())).isNull();
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 대화의 노트를 두 요청이 함께 만들면 뒤의 것이 주인의 사용자 행에서 기다렸다가 넣지 않고 앞의 노트를 돌려준다")
    void twoSavesAtOnce() throws Exception {
        Race<NoteView, NoteView> race = tools.race(
                () -> conversations.saveNote(conversation, note("앞의 노트", "앞의 제안", 4, null), now),
                () -> conversations.saveNote(conversation, note("뒤의 노트", "뒤의 제안", 4, null), now.plusSeconds(1)),
                "from users");

        assertThat(race.first().title()).isEqualTo("앞의 노트");
        assertThat(race.second()).isEqualTo(race.first());
        assertThat(tools.count("coach_notes")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 대화의 노트를 두 요청이 함께 고쳐 쓰면 뒤의 것이 기다렸다가 앞의 행을 제 내용으로 덮는다(id 와 만든 시각은 앞의 것)")
    void twoReplacesAtOnce() throws Exception {
        Race<NoteView, NoteView> race = tools.race(
                () -> conversations.replaceNote(conversation, note("앞의 노트", "앞의 제안", 4, null), now),
                () -> conversations.replaceNote(conversation, note("뒤의 노트", "뒤의 제안", 5, null), now.plusSeconds(1)),
                "from users");

        assertThat(race.second().id()).isEqualTo(race.first().id());
        assertThat(race.second().title()).isEqualTo("뒤의 노트");
        assertThat(race.second().createdAt()).isEqualTo(stored);
        assertThat(jdbc.queryForObject("SELECT title FROM coach_notes", String.class)).isEqualTo("뒤의 노트");
    }

    // ---- 문장과 트랜잭션 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류, 새로 여는 트랜잭션 수. 노트 읽기는 연습 화면이 싣는 경로다")
    void eachPortMethodSendsTheseStatements() throws Exception {
        UUID quiet = tools.practice(member);

        assertThat(tools.sent(() -> conversations.saveNote(conversation, note("붙잡는 순간", "제안", 4, null), now)))
                .isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, "insert coach_notes", NOTE)));
        assertThat(tools.sent(() -> {
            conversations.saveLineNotes(conversation, mapper.readTree("[]"));
            return null;
        })).isEqualTo(new Sent(1, List.of("update coach_notes")));
        assertThat(tools.sent(() -> conversations.replaceNote(conversation, note("고친 노트", "제안", 5, null), now)))
                .isEqualTo(new Sent(1, List.of(OWNER, USER_LOCK, OWNER, "insert coach_notes", NOTE)));
        assertThat(tools.sent(() -> conversations.note(member, practice))).as("노트 읽기 — 요청이 많은 경로")
                .isEqualTo(new Sent(0, List.of("select practices", NOTE)));
        assertThat(tools.sent(() -> conversations.note(member, quiet))).as("노트가 없으면 옛 노트를 찾는다")
                .isEqualTo(new Sent(0, List.of("select practices", NOTE, "select coaching_handoffs,practice_reports,practice_sessions")));

        tools.passGate(member);
        String bearer = "Bearer " + jwt.issueAccessToken(member).value();
        Sent read = tools.sent(() -> {
            var response = mvc.perform(get("/v2/practices/{id}/note", practice).header("Authorization", bearer))
                    .andReturn().getResponse();
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
            JsonNode body = mapper.readTree(response.getContentAsString());
            assertThat(body.path("my_rating").isNull()).isTrue();
            return body;
        });
        assertThat(read.after("select practices")).as("연습 화면의 노트 읽기(게이트 뒤)")
                .isEqualTo(new Sent(0, List.of("select practices", NOTE, "select note_ratings")));
    }

    private NewNote note(String title, String nextTake, long sourceRevision, JsonNode legacyReport) {
        return new NewNote("v2", "action", title, mapper.readTree("[{\"quote\":\"가지 마\",\"kind\":\"actor\",\"source_ref\":\"turn:1\"}]"), nextTake,
                mapper.readTree("[\"숨이 막혔어요\"]"), mapper.readTree("[\"화난 게 아니에요\"]"), mapper.readTree("[\"시선\"]"),
                true, sourceRevision, legacyReport);
    }
}
