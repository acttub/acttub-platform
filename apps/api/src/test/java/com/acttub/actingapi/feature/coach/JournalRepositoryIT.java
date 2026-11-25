package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.CoachStoreFixture.Race;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Sent;
import com.acttub.actingapi.feature.coach.app.JournalRepository;
import com.acttub.actingapi.feature.coach.app.JournalRepository.Row;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 배우 일지 저장소가 내는 결과·잠금·경합·문장을 고정한다. 옮기는 문장은 {@code actor_journals} 한 표만 쓰는 것(만드는 중 줄 넣기,
 * 자동 칸의 끝, 배우가 고치기)이다. 읽기는 회차·대화·사용자·프로필을 함께 보고 jsonb 안쪽을 꺼내는 네이티브로 남는다. HTTP 의
 * 만들기·고치기·소유권은 {@link JournalIT} 가 본다.
 */
@CoachStoreTest
class JournalRepositoryIT {
    private static final String FIND = "select actor_journals,coach_conversations,practices,user_profiles,users";

    @Autowired
    CoachStoreFixture.Tools tools;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JournalRepository journals;

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
    @DisplayName("insertPending: 만드는 중(pending) 줄을 넘긴 시각으로 넣는다(자동 칸·모델·고친 시각은 비어 있다). 대화 없이도 넣는다. 같은 회차에 이미 있으면 넣지 않고 false 이며 있던 줄은 그대로다")
    void insertPendingAddsOneRowPerPractice() {
        UUID id = UUID.randomUUID();

        assertThat(journals.insertPending(id, member, practice, conversation, "{\"a\":1}", now)).isTrue();

        Row row = journals.find(member, practice);
        assertThat(row.id()).isEqualTo(id);
        assertThat(row.practiceId()).isEqualTo(practice);
        assertThat(row.conversationId()).isEqualTo(conversation);
        assertThat(row.answers()).isEqualTo("{\"a\":1}");
        assertThat(row.draft()).isNull();
        assertThat(row.draftStatus()).isEqualTo("pending");
        assertThat(row.model()).isNull();
        assertThat(row.editedAt()).isNull();
        assertThat(row.createdAt()).isEqualTo(stored);
        assertThat(row.updatedAt()).isEqualTo(stored);
        assertThat(jdbc.queryForObject("SELECT user_id FROM actor_journals", UUID.class)).isEqualTo(member);

        assertThat(journals.insertPending(UUID.randomUUID(), member, practice, null, "{\"a\":2}", now.plusSeconds(60))).isFalse();
        assertThat(journals.find(member, practice)).isEqualTo(row);

        UUID quiet = tools.practice(member);
        assertThat(journals.insertPending(UUID.randomUUID(), member, quiet, null, "{}", now)).isTrue();
        assertThat(journals.find(member, quiet).conversationId()).isNull();
        assertThat(tools.count("actor_journals")).isEqualTo(2);
    }

    @Test
    @DisplayName("complete: 아직 만드는 중이고 배우가 고치지 않은 줄에만 상태·자동 칸·모델·고친 시각(updated_at)을 쓴다. 이미 끝난 줄과 배우가 고친 줄은 건드리지 않는다. 자동 칸과 모델은 null 로도 쓴다")
    void completeWritesOnlyAPendingUneditedRow() {
        UUID id = UUID.randomUUID();
        journals.insertPending(id, member, practice, conversation, "{}", now.minusSeconds(60));

        journals.complete(id, "ready", "{\"seen\":\"시선\"}", "gemini-test", now);

        Row done = journals.find(member, practice);
        assertThat(done.draftStatus()).isEqualTo("ready");
        assertThat(done.draft()).isEqualTo("{\"seen\":\"시선\"}");
        assertThat(done.model()).isEqualTo("gemini-test");
        assertThat(done.updatedAt()).isEqualTo(stored);
        assertThat(done.createdAt()).isEqualTo(stored.minusSeconds(60));
        assertThat(done.editedAt()).isNull();

        journals.complete(id, "failed", null, null, now.plusSeconds(60));
        assertThat(journals.find(member, practice)).as("이미 끝난 줄").isEqualTo(done);

        UUID edited = UUID.randomUUID();
        UUID second = tools.practice(member);
        journals.insertPending(edited, member, second, null, "{}", now.minusSeconds(60));
        journals.update(member, second, "{\"a\":\"고침\"}", "{\"d\":\"배우\"}", now.minusSeconds(30));
        journals.complete(edited, "ready", "{\"d\":\"늦은 생성\"}", "gemini-test", now);
        assertThat(journals.find(member, second).draft()).as("배우가 고친 줄").isEqualTo("{\"d\":\"배우\"}");

        UUID failed = UUID.randomUUID();
        UUID third = tools.practice(member);
        journals.insertPending(failed, member, third, null, "{}", now.minusSeconds(60));
        journals.complete(failed, "failed", null, null, now);
        Row gaveUp = journals.find(member, third);
        assertThat(gaveUp.draftStatus()).isEqualTo("failed");
        assertThat(gaveUp.draft()).isNull();
        assertThat(gaveUp.model()).isNull();
    }

    @Test
    @DisplayName("update: 배우 답과 자동 칸을 갈아 끼우고 고친 시각 둘(edited_at·updated_at)을 넘긴 시각으로 찍는다. 만드는 중이던 줄은 ready 가 되고 다른 상태는 그대로다. 자동 칸은 null 로도 쓴다. 남의 것·없는 것은 null 이고 아무것도 바꾸지 않는다")
    void updateReplacesAnswersAndStampsTheEdit() {
        UUID id = UUID.randomUUID();
        journals.insertPending(id, member, practice, conversation, "{}", now.minusSeconds(60));

        Row updated = journals.update(member, practice, "{\"a\":\"고침\"}", "{\"d\":\"배우\"}", now);

        assertThat(updated.id()).isEqualTo(id);
        assertThat(updated.answers()).isEqualTo("{\"a\":\"고침\"}");
        assertThat(updated.draft()).isEqualTo("{\"d\":\"배우\"}");
        assertThat(updated.draftStatus()).isEqualTo("ready");
        assertThat(updated.editedAt()).isEqualTo(stored);
        assertThat(updated.updatedAt()).isEqualTo(stored);
        assertThat(updated.createdAt()).isEqualTo(stored.minusSeconds(60));

        jdbc.update("UPDATE actor_journals SET draft_status='failed' WHERE id=?", id);
        Row again = journals.update(member, practice, "{\"a\":\"또 고침\"}", null, now.plusSeconds(60));
        assertThat(again.draftStatus()).isEqualTo("failed");
        assertThat(again.draft()).isNull();
        assertThat(again.editedAt()).isEqualTo(stored.plusSeconds(60));

        assertThat(journals.update(tools.member(), practice, "{\"a\":\"남\"}", null, now)).isNull();
        assertThat(journals.update(member, UUID.randomUUID(), "{}", null, now)).isNull();
        assertThat(journals.find(member, practice)).isEqualTo(again);
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("끝내기·고치기의 UPDATE 는 키를 바꾸지 않아 FOR NO KEY UPDATE 세기다 — 바깥 연결의 FOR KEY SHARE 를 기다리지 않는다")
    void theUpdatesDoNotWaitBehindAKeyShare() throws Exception {
        UUID id = UUID.randomUUID();
        journals.insertPending(id, member, practice, conversation, "{}", now);

        assertThat(tools.waitingBehindKeyShare("actor_journals", id, "actor_journals", () -> {
            journals.complete(id, "ready", null, null, now);
            return null;
        })).isNull();
        assertThat(tools.waitingBehindKeyShare("actor_journals", id, "actor_journals",
                () -> journals.update(member, practice, "{}", null, now))).isNull();
        assertThat(journals.find(member, practice).editedAt()).isEqualTo(stored);
    }

    @Test
    @DisplayName("같은 회차의 일지를 두 요청이 함께 만들면 뒤의 넣기가 앞의 커밋을 기다렸다가 넣지 않는다(false) — 모델을 두 번 부르지 않는다")
    void twoCreatesAtOnce() throws Exception {
        Race<Boolean, Boolean> race = tools.race(
                () -> journals.insertPending(UUID.randomUUID(), member, practice, conversation, "{\"a\":\"앞\"}", now),
                () -> journals.insertPending(UUID.randomUUID(), member, practice, conversation, "{\"a\":\"뒤\"}", now),
                "insert into actor_journals");

        assertThat(race.first()).isTrue();
        assertThat(race.second()).isFalse();
        assertThat(jdbc.queryForObject("SELECT answers FROM actor_journals", String.class)).isEqualTo("{\"a\":\"앞\"}");
    }

    @Test
    @DisplayName("배우가 고치는 것과 자동 칸 생성의 끝이 겹치면, 뒤에 온 생성 결과는 고친 줄에서 기다렸다가 아무것도 쓰지 않는다")
    void aLateCompletionDoesNotOverwriteAnEdit() throws Exception {
        UUID id = UUID.randomUUID();
        journals.insertPending(id, member, practice, conversation, "{}", now.minusSeconds(60));

        tools.race(
                () -> journals.update(member, practice, "{\"a\":\"고침\"}", "{\"d\":\"배우\"}", now),
                () -> {
                    journals.complete(id, "ready", "{\"d\":\"늦은 생성\"}", "gemini-test", now.plusSeconds(1));
                    return null;
                },
                "update actor_journals");

        Row row = journals.find(member, practice);
        assertThat(row.draft()).isEqualTo("{\"d\":\"배우\"}");
        assertThat(row.model()).isNull();
        assertThat(row.updatedAt()).isEqualTo(stored);
    }

    // ---- 문장과 트랜잭션 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류, 새로 여는 트랜잭션 수")
    void eachPortMethodSendsTheseStatements() {
        UUID id = UUID.randomUUID();

        assertThat(tools.sent(() -> journals.insertPending(id, member, practice, conversation, "{}", now)))
                .isEqualTo(new Sent(1, List.of("insert actor_journals")));
        assertThat(tools.sent(() -> journals.find(member, practice))).isEqualTo(new Sent(0, List.of(FIND)));
        assertThat(tools.sent(() -> {
            journals.complete(id, "ready", "{}", "gemini-test", now);
            return null;
        })).isEqualTo(new Sent(1, List.of("update actor_journals")));
        assertThat(tools.sent(() -> journals.update(member, practice, "{}", null, now)))
                .isEqualTo(new Sent(1, List.of("update actor_journals", FIND)));
        assertThat(tools.sent(() -> journals.update(tools.member(), practice, "{}", null, now))).as("남의 것")
                .isEqualTo(new Sent(1, List.of("update actor_journals")));
    }
}
