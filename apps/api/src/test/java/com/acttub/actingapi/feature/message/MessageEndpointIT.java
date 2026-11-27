package com.acttub.actingapi.feature.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.message.app.MessageService;
import com.acttub.actingapi.platform.json.LenientJson;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.AccountFixtures;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 배우끼리 1:1 메시지(docs/specs/community/messages.md, SOMA-1039)의 HTTP 계약. 시작·중복 시작·보내기·재전송·목록·읽음·안 읽은
 * 수·차단·신고·게스트·자기 자신·하루 한도·탈퇴한 상대를 실제 Postgres 로 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class MessageEndpointIT {
    private static final UUID ME = UUID.fromString("00000000-0000-4000-8000-000000001039");
    private static final UUID PARTNER = UUID.fromString("00000000-0000-4000-8000-000000001040");
    private static final UUID THIRD = UUID.fromString("00000000-0000-4000-8000-000000001041");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    MessageService messages;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        insertUser(ME, "나");
        insertUser(PARTNER, "상대");
        insertUser(THIRD, "셋째");
    }

    @Test
    @DisplayName("글에서 대화를 열고 보내면 상대의 목록·안 읽은 수에 보이고, 읽음 표시로 0이 된다")
    void startSendListReadAndUnread() throws Exception {
        UUID post = insertPost(PARTNER, "상대역 구해요");

        MockHttpServletResponse started = perform(post("/v2/messages/conversations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"user_id\":\"" + PARTNER + "\",\"post_id\":\"" + post + "\"}"), ME);
        assertThat(started.getStatus()).isEqualTo(201);
        JsonNode conversation = json(started);
        String conversationId = text(conversation.path("id"));
        assertThat(text(conversation.path("partner").path("name"))).isEqualTo("상대");
        assertThat(text(conversation.path("origin_post").path("title"))).isEqualTo("상대역 구해요");
        assertThat(conversation.path("can_send").asBoolean()).isTrue();
        assertThat(conversation.path("unavailable_reason").isNull()).isTrue();

        // 상대가 반대 방향으로 열어도 같은 대화다(200, 한도를 세지 않는다).
        MockHttpServletResponse reverse = perform(post("/v2/messages/conversations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"user_id\":\"" + ME + "\"}"), PARTNER);
        assertThat(reverse.getStatus()).isEqualTo(200);
        assertThat(text(json(reverse).path("id"))).isEqualTo(conversationId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM direct_conversations", Integer.class)).isEqualTo(1);

        // 메시지가 없는 대화는 목록에 없다.
        assertThat(json(perform(get("/v2/messages/conversations"), PARTNER)).path("conversations").size()).isZero();

        UUID requestId = UUID.randomUUID();
        MockHttpServletResponse sent = send(conversationId, requestId, "  안녕하세요, 대본 같이 읽어요  ", ME);
        assertThat(sent.getStatus()).isEqualTo(201);
        JsonNode message = json(sent);
        assertThat(text(message.path("body"))).isEqualTo("안녕하세요, 대본 같이 읽어요");
        assertThat(message.path("mine").asBoolean()).isTrue();

        // 같은 request_id·같은 본문은 같은 메시지(200), 다른 본문은 422.
        MockHttpServletResponse replay = send(conversationId, requestId, "안녕하세요, 대본 같이 읽어요", ME);
        assertThat(replay.getStatus()).isEqualTo(200);
        assertThat(text(json(replay).path("id"))).isEqualTo(text(message.path("id")));
        assertThat(detail(send(conversationId, requestId, "다른 본문", ME))).isEqualTo("request_fingerprint_mismatch");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM direct_messages", Integer.class)).isEqualTo(1);

        JsonNode unread = json(perform(get("/v2/messages/unread-count"), PARTNER));
        assertThat(LenientJson.intValue(unread.path("unread_count"))).isEqualTo(1);
        assertThat(LenientJson.intValue(json(perform(get("/v2/messages/unread-count"), ME)).path("unread_count"))).isZero();

        JsonNode list = json(perform(get("/v2/messages/conversations"), PARTNER));
        assertThat(list.path("conversations").size()).isEqualTo(1);
        JsonNode row = list.path("conversations").get(0);
        assertThat(text(row.path("partner").path("name"))).isEqualTo("나");
        assertThat(text(row.path("last_message").path("preview"))).isEqualTo("안녕하세요, 대본 같이 읽어요");
        assertThat(row.path("last_message").path("mine").asBoolean()).isFalse();
        assertThat(LenientJson.intValue(row.path("unread_count"))).isEqualTo(1);

        JsonNode page = json(perform(get("/v2/messages/conversations/{id}/messages", conversationId), PARTNER));
        assertThat(page.path("messages").size()).isEqualTo(1);
        assertThat(page.path("messages").get(0).path("mine").asBoolean()).isFalse();

        assertThat(perform(post("/v2/messages/conversations/{id}/read", conversationId), PARTNER).getStatus()).isEqualTo(204);
        assertThat(LenientJson.intValue(json(perform(get("/v2/messages/unread-count"), PARTNER)).path("unread_count"))).isZero();
    }

    @Test
    @DisplayName("메시지는 최근 것부터 커서로 나뉘고, 깨진 커서는 400, 남의 대화는 404 다")
    void messagesArePagedNewestFirst() throws Exception {
        String conversationId = start(ME, PARTNER);
        for (int index = 1; index <= 3; index++) {
            assertThat(send(conversationId, UUID.randomUUID(), "메시지 " + index, ME).getStatus()).isEqualTo(201);
        }
        JsonNode first = json(perform(get("/v2/messages/conversations/{id}/messages", conversationId).param("limit", "2"), ME));
        assertThat(values(first.path("messages"), "body")).containsExactly("메시지 3", "메시지 2");
        String cursor = text(first.path("next_cursor"));
        JsonNode second = json(perform(get("/v2/messages/conversations/{id}/messages", conversationId)
                .param("limit", "2").param("cursor", cursor), ME));
        assertThat(values(second.path("messages"), "body")).containsExactly("메시지 1");
        assertThat(second.path("next_cursor").isNull()).isTrue();

        assertThat(detail(perform(get("/v2/messages/conversations/{id}/messages", conversationId).param("cursor", "깨짐"), ME)))
                .isEqualTo("invalid_cursor");
        MockHttpServletResponse stranger = perform(get("/v2/messages/conversations/{id}/messages", conversationId), THIRD);
        assertThat(stranger.getStatus()).isEqualTo(404);
        assertThat(detail(stranger)).isEqualTo("conversation_not_found");
        assertThat(perform(get("/v2/messages/conversations/{id}/messages", conversationId).param("limit", "51"), ME).getStatus())
                .isEqualTo(422);
    }

    @Test
    @DisplayName("자기 자신 400, 없는 상대 404, 보이지 않는 글 404, 게스트 403 member_only")
    void rejectsSelfUnknownPartnerHiddenPostAndGuests() throws Exception {
        MockHttpServletResponse self = startResponse(ME, ME, null);
        assertThat(self.getStatus()).isEqualTo(400);
        assertThat(detail(self)).isEqualTo("cannot_message_self");

        MockHttpServletResponse unknown = startResponse(ME, UUID.randomUUID(), null);
        assertThat(unknown.getStatus()).isEqualTo(404);
        assertThat(detail(unknown)).isEqualTo("user_not_found");

        UUID hidden = insertPost(PARTNER, "가려진 글");
        jdbc.update("UPDATE community_posts SET status = 'hidden' WHERE id = ?", hidden);
        MockHttpServletResponse hiddenPost = startResponse(ME, PARTNER, hidden);
        assertThat(hiddenPost.getStatus()).isEqualTo(404);
        assertThat(detail(hiddenPost)).isEqualTo("post_not_found");

        UUID guest = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", guest);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'guest',?)",
                UUID.randomUUID(), guest, UUID.randomUUID().toString());
        AccountFixtures.grantAllConsents(jdbc, guest);
        for (MockHttpServletRequestBuilder request : List.of(
                get("/v2/messages/conversations"),
                get("/v2/messages/unread-count"),
                post("/v2/messages/conversations").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"user_id\":\"" + PARTNER + "\"}"))) {
            MockHttpServletResponse response = perform(request, guest);
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(detail(response)).isEqualTo("member_only");
        }
        // 게스트에게는 대화를 열 수 없다(회원이 아니면 없는 사람과 같다).
        assertThat(detail(startResponse(ME, guest, null))).isEqualTo("user_not_found");
    }

    @Test
    @DisplayName("어느 쪽이 차단했든 시작·보내기가 403 message_blocked 이고, 대화방은 보낼 수 없다고 말한다")
    void blockedEitherWayCannotMessage() throws Exception {
        String conversationId = start(ME, PARTNER);

        // 게시판의 차단 걸기를 그대로 쓴다(user_blocks).
        assertThat(perform(post("/v2/community/blocks").contentType(MediaType.APPLICATION_JSON)
                .content("{\"user_id\":\"" + ME + "\"}"), PARTNER).getStatus()).isEqualTo(204);

        MockHttpServletResponse blockedSend = send(conversationId, UUID.randomUUID(), "안녕하세요", ME);
        assertThat(blockedSend.getStatus()).isEqualTo(403);
        assertThat(detail(blockedSend)).isEqualTo("message_blocked");
        assertThat(detail(startResponse(ME, PARTNER, null))).isEqualTo("message_blocked");
        JsonNode detail = json(perform(get("/v2/messages/conversations/{id}", conversationId), ME));
        assertThat(detail.path("can_send").asBoolean()).isFalse();
        assertThat(text(detail.path("unavailable_reason"))).isEqualTo("message_blocked");

        // 0.1.0 전 게시판 차단(community_blocks)도 어느 쪽이든 막는다.
        jdbc.update("INSERT INTO community_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), THIRD, ME);
        assertThat(detail(startResponse(ME, THIRD, null))).isEqualTo("message_blocked");
    }

    @Test
    @DisplayName("대화 신고는 게시판 신고 표에 conversation 으로 남고, 같은 대화를 다시 신고하면 409 다")
    void reportsTheConversationOnce() throws Exception {
        String conversationId = start(ME, PARTNER);
        String body = "{\"reason\":\"abuse\",\"detail\":\"욕설을 보냈어요\"}";

        assertThat(perform(post("/v2/messages/conversations/{id}/reports", conversationId)
                .contentType(MediaType.APPLICATION_JSON).content(body), ME).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM community_reports
                WHERE target_type = 'conversation' AND target_id = ?::uuid AND reporter_id = ? AND status = 'pending'
                """, Integer.class, conversationId, ME)).isEqualTo(1);

        MockHttpServletResponse again = perform(post("/v2/messages/conversations/{id}/reports", conversationId)
                .contentType(MediaType.APPLICATION_JSON).content(body), ME);
        assertThat(again.getStatus()).isEqualTo(409);
        assertThat(detail(again)).isEqualTo("already_reported");

        assertThat(perform(post("/v2/messages/conversations/{id}/reports", conversationId)
                .contentType(MediaType.APPLICATION_JSON).content(body), THIRD).getStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("하루 새 대화 20개·보내기 300개를 넘으면 429 다. 이미 있는 대화를 다시 여는 것은 세지 않는다")
    void dailyLimits() throws Exception {
        String conversationId = start(ME, PARTNER);
        jdbc.update("""
                INSERT INTO direct_messages(id,conversation_id,sender_user_id,body,request_id,request_fingerprint,created_at)
                SELECT gen_random_uuid(), ?::uuid, ?, '본문', gen_random_uuid(), 'f', now()
                FROM generate_series(1, 300)
                """, conversationId, ME);
        MockHttpServletResponse overMessages = send(conversationId, UUID.randomUUID(), "301번째", ME);
        assertThat(overMessages.getStatus()).isEqualTo(429);
        assertThat(detail(overMessages)).isEqualTo("daily_message_limit");

        jdbc.update("""
                INSERT INTO users(id,status) SELECT ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'active'
                FROM generate_series(1, 19) n
                """);
        jdbc.update("""
                INSERT INTO direct_conversations(id,starter_user_id,recipient_user_id,created_at)
                SELECT gen_random_uuid(), ?, ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, now()
                FROM generate_series(1, 19) n
                """, ME);
        MockHttpServletResponse overConversations = startResponse(ME, THIRD, null);
        assertThat(overConversations.getStatus()).isEqualTo(429);
        assertThat(detail(overConversations)).isEqualTo("daily_conversation_limit");
        assertThat(startResponse(ME, PARTNER, null).getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("상대가 탈퇴하면 이름이 \"탈퇴한 사용자\"이고 보낼 수 없으며(403), 새 대화는 404 다")
    void withdrawnPartner() throws Exception {
        String conversationId = start(ME, PARTNER);
        assertThat(send(conversationId, UUID.randomUUID(), "안녕하세요", PARTNER).getStatus()).isEqualTo(201);
        jdbc.update("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = ?", PARTNER);
        jdbc.update("UPDATE user_profiles SET name = NULL WHERE user_id = ?", PARTNER);

        JsonNode detail = json(perform(get("/v2/messages/conversations/{id}", conversationId), ME));
        assertThat(text(detail.path("partner").path("name"))).isEqualTo("탈퇴한 사용자");
        assertThat(detail.path("partner").path("withdrawn").asBoolean()).isTrue();
        assertThat(detail.path("can_send").asBoolean()).isFalse();
        assertThat(text(detail.path("unavailable_reason"))).isEqualTo("partner_unavailable");
        // 상대가 남긴 메시지는 그대로 읽힌다.
        assertThat(json(perform(get("/v2/messages/conversations/{id}/messages", conversationId), ME)).path("messages").size())
                .isEqualTo(1);

        MockHttpServletResponse toWithdrawn = send(conversationId, UUID.randomUUID(), "답장", ME);
        assertThat(toWithdrawn.getStatus()).isEqualTo(403);
        assertThat(detail(toWithdrawn)).isEqualTo("partner_unavailable");
        assertThat(detail(startResponse(ME, PARTNER, null))).isEqualTo("user_not_found");
    }

    @Test
    @DisplayName("게이트를 지난 쓰기보다 탈퇴가 먼저 끝났으면 저장하지 않고 403 account_deactivated 다")
    void writesAfterOwnWithdrawalAreRefused() throws Exception {
        String conversationId = start(ME, PARTNER);
        UUID other = UUID.randomUUID();
        insertUser(other, "넷째");
        jdbc.update("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = ?", ME);

        // 게이트는 요청 머리에서 막으므로, 겹친 경우는 서비스를 바로 불러 재현한다.
        assertThatThrownBy(() -> messages.send(ME, UUID.fromString(conversationId), UUID.randomUUID(), "안녕하세요"))
                .isInstanceOfSatisfying(ApiException.class, failure -> assertThat(failure.getMessage()).isEqualTo("account_deactivated"));
        assertThatThrownBy(() -> messages.start(ME, other, null))
                .isInstanceOfSatisfying(ApiException.class, failure -> assertThat(failure.getMessage()).isEqualTo("account_deactivated"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM direct_messages", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM direct_conversations", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("받는 사람 푸시 시각은 같은 대화에서 1분에 한 번만 당겨진다")
    void pushIsThrottledPerConversation() throws Exception {
        String conversationId = start(ME, PARTNER);
        assertThat(send(conversationId, UUID.randomUUID(), "첫째", ME).getStatus()).isEqualTo(201);
        Instant first = pushedAt(conversationId);
        assertThat(first).isNotNull();
        assertThat(send(conversationId, UUID.randomUUID(), "둘째", ME).getStatus()).isEqualTo(201);
        assertThat(pushedAt(conversationId)).isEqualTo(first);

        jdbc.update("UPDATE direct_conversations SET recipient_pushed_at = recipient_pushed_at - interval '61 seconds' WHERE id = ?::uuid",
                conversationId);
        Instant moved = pushedAt(conversationId);
        assertThat(send(conversationId, UUID.randomUUID(), "셋째", ME).getStatus()).isEqualTo(201);
        assertThat(pushedAt(conversationId)).isAfter(moved);
    }

    private Instant pushedAt(String conversationId) {
        return jdbc.queryForObject("SELECT recipient_pushed_at FROM direct_conversations WHERE id = ?::uuid",
                java.sql.Timestamp.class, conversationId).toInstant();
    }

    private String start(UUID from, UUID to) throws Exception {
        MockHttpServletResponse response = startResponse(from, to, null);
        assertThat(response.getStatus()).isIn(200, 201);
        return text(json(response).path("id"));
    }

    private MockHttpServletResponse startResponse(UUID from, UUID to, UUID post) throws Exception {
        String body = post == null
                ? "{\"user_id\":\"" + to + "\"}"
                : "{\"user_id\":\"" + to + "\",\"post_id\":\"" + post + "\"}";
        return perform(post("/v2/messages/conversations").contentType(MediaType.APPLICATION_JSON).content(body), from);
    }

    private MockHttpServletResponse send(String conversationId, UUID requestId, String body, UUID from) throws Exception {
        return perform(post("/v2/messages/conversations/{id}/messages", conversationId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(java.util.Map.of("request_id", requestId.toString(), "body", body))), from);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, UUID user) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwt.issueAccessToken(user).value()))
                .andReturn().getResponse();
    }

    private void insertUser(UUID id, String name) {
        jdbc.update("INSERT INTO users(id, email, status) VALUES (?, NULL, 'active')", id);
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name = ? WHERE user_id = ?", name, id);
    }

    private UUID insertPost(UUID author, String title) {
        UUID id = UUID.randomUUID();
        UUID category = jdbc.queryForObject("SELECT id FROM community_categories WHERE slug = 'free'", UUID.class);
        jdbc.update("""
                INSERT INTO community_posts(id, category_id, author_id, title, body, anonymous, status)
                VALUES (?, ?, ?, ?, '본문', FALSE, 'visible')
                """, id, category, author, title);
        return id;
    }

    private JsonNode json(MockHttpServletResponse response) throws Exception {
        return mapper.readTree(response.getContentAsString());
    }

    private String detail(MockHttpServletResponse response) throws Exception {
        return text(json(response).path("detail"));
    }

    private static String text(JsonNode node) {
        return LenientJson.asText(node);
    }

    private static List<String> values(JsonNode array, String field) {
        java.util.ArrayList<String> result = new java.util.ArrayList<>();
        array.forEach(item -> result.add(LenientJson.asText(item.path(field))));
        return result;
    }
}
