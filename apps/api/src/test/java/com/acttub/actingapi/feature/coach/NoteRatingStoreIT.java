package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.CoachStoreFixture.Race;
import com.acttub.actingapi.feature.coach.CoachStoreFixture.Sent;
import com.acttub.actingapi.feature.coach.app.NoteRatingOwnership;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore.Outcome;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore.Rating;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore.Saved;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 노트 평가 저장소가 내는 결과·잠금·경합·문장을 고정한다. 옮기는 문장은 {@code note_ratings} 한 표만 쓰는 것(있는 평가 읽기, 넣거나
 * 덮어쓰기, 내 평가, 이관)이다. 사용자 행 잠금과 회차로 노트를 찾는 조회는 네이티브로 남는다. HTTP 의 멱등·검증·탈퇴는
 * {@link NoteRatingIT} 가 본다.
 */
@CoachStoreTest
class NoteRatingStoreIT {
    private static final String USER_LOCK = "select users for update";
    private static final String FIND_NOTE = "select coach_conversations,coach_notes,practices";
    private static final String RATING = "select note_ratings";

    @Autowired
    CoachStoreFixture.Tools tools;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    NoteRatingStore ratings;

    @Autowired
    NoteRatingOwnership ownership;

    /** 나노초까지 있는 시각 — 저장은 마이크로초로 반올림된다. */
    private final Instant now = Instant.parse("2026-11-26T03:00:00.123456789Z");
    private final Instant stored = Instant.parse("2026-11-26T03:00:00.123457Z");

    private UUID member;
    private UUID practice;
    private UUID note;

    @BeforeEach
    void setUp() {
        tools.reset();
        member = tools.member();
        practice = tools.practice(member);
        note = tools.note(tools.conversation(practice));
    }

    @Test
    @DisplayName("save: 처음이면 한 줄을 넣고 넣은 값을 돌려준다(시각은 저장된 정밀도). 다시 누르면 같은 줄의 값·한 줄·요청 id·고친 시각을 덮어쓰고 만든 시각과 id 는 그대로다. 한 줄 없이 보내면 한 줄이 비워진다")
    void saveInsertsThenOverwritesTheSameRow() {
        UUID first = UUID.randomUUID();

        Saved saved = ratings.save(member, practice, first, "helpful", "좋았어요", now);

        assertThat(saved).isEqualTo(new Saved(Outcome.SAVED, new Rating("helpful", "좋았어요", stored)));
        UUID row = jdbc.queryForObject("SELECT id FROM note_ratings", UUID.class);
        assertThat(jdbc.queryForMap("SELECT practice_id,note_id,user_id,rating,comment,request_id,created_at=updated_at AS fresh FROM note_ratings"))
                .containsEntry("practice_id", practice).containsEntry("note_id", note).containsEntry("user_id", member)
                .containsEntry("rating", "helpful").containsEntry("comment", "좋았어요").containsEntry("request_id", first)
                .containsEntry("fresh", true);

        UUID second = UUID.randomUUID();
        Saved overwritten = ratings.save(member, practice, second, "not_helpful", null, now.plusSeconds(60));

        assertThat(overwritten).isEqualTo(new Saved(Outcome.SAVED, new Rating("not_helpful", null, stored.plusSeconds(60))));
        assertThat(jdbc.queryForMap("SELECT id,rating,comment,request_id FROM note_ratings"))
                .containsEntry("id", row).containsEntry("rating", "not_helpful").containsEntry("comment", null)
                .containsEntry("request_id", second);
        assertThat(tools.instant("SELECT created_at FROM note_ratings")).isEqualTo(stored);
        assertThat(tools.instant("SELECT updated_at FROM note_ratings")).isEqualTo(stored.plusSeconds(60));
        assertThat(tools.count("note_ratings")).isEqualTo(1);
    }

    @Test
    @DisplayName("save: 같은 요청 id·같은 본문은 저장된 값을 그대로 돌려주고 줄을 바꾸지 않는다. 같은 id 에 다른 본문은 MISMATCH 다. 남의 회차·노트 없는 회차는 NOTE_NOT_FOUND, 활성이 아닌 사람은 INACTIVE 이고 아무것도 쓰지 않는다")
    void saveIsIdempotentAndChecksTheOwner() {
        UUID request = UUID.randomUUID();
        ratings.save(member, practice, request, "helpful", "좋았어요", now);

        assertThat(ratings.save(member, practice, request, "helpful", "좋았어요", now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.REPLAYED, new Rating("helpful", "좋았어요", stored)));
        assertThat(ratings.save(member, practice, request, "helpful", null, now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.MISMATCH, null));
        assertThat(ratings.save(member, practice, request, "not_helpful", "좋았어요", now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.MISMATCH, null));
        assertThat(tools.instant("SELECT updated_at FROM note_ratings")).isEqualTo(stored);

        UUID stranger = tools.member();
        assertThat(ratings.save(stranger, practice, UUID.randomUUID(), "helpful", null, now))
                .isEqualTo(new Saved(Outcome.NOTE_NOT_FOUND, null));
        assertThat(ratings.save(member, tools.practice(member), UUID.randomUUID(), "helpful", null, now))
                .isEqualTo(new Saved(Outcome.NOTE_NOT_FOUND, null));
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", stranger);
        assertThat(ratings.save(stranger, practice, UUID.randomUUID(), "helpful", null, now))
                .isEqualTo(new Saved(Outcome.INACTIVE, null));
        assertThat(tools.count("note_ratings")).isEqualTo(1);
    }

    @Test
    @DisplayName("mine: 그 노트에 내가 남긴 평가만 읽는다. reassign: 부르는 쪽의 트랜잭션 안에서 주인만 바꾸고 누른 시각은 그대로다")
    void mineAndReassign() {
        UUID guest = tools.member();
        UUID guestPractice = tools.practice(guest);
        UUID guestNote = tools.note(tools.conversation(guestPractice));
        ratings.save(guest, guestPractice, UUID.randomUUID(), "helpful", "좋았어요", now);

        assertThat(ratings.mine(guest, guestNote)).isEqualTo(new Rating("helpful", "좋았어요", stored));
        assertThat(ratings.mine(member, guestNote)).isNull();
        assertThat(ratings.mine(guest, note)).isNull();

        tools.inTransaction(() -> {
            ownership.reassign(guest, member);
            return null;
        });

        assertThat(ratings.mine(member, guestNote)).isEqualTo(new Rating("helpful", "좋았어요", stored));
        assertThat(ratings.mine(guest, guestNote)).isNull();
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("save 는 사용자 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void saveLocksTheUserRowForUpdate() throws Exception {
        String waiting = tools.waitingBehindKeyShare("users", member, "from users",
                () -> ratings.save(member, practice, UUID.randomUUID(), "helpful", null, now));

        assertThat(waiting).isNotNull();
        assertThat(waiting.toLowerCase()).startsWith("select").contains("for update").doesNotContain("no key");
        assertThat(tools.count("note_ratings")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 사람이 같은 노트를 함께 평가하면 뒤의 것이 사용자 행에서 기다렸다가 앞의 줄을 덮어쓴다(줄은 하나). 같은 요청 id 로 함께 오면 뒤의 것은 재전송으로 판정된다")
    void twoSavesAtOnce() throws Exception {
        Race<Saved, Saved> race = tools.race(
                () -> ratings.save(member, practice, UUID.randomUUID(), "helpful", "앞", now),
                () -> ratings.save(member, practice, UUID.randomUUID(), "not_helpful", "뒤", now.plusSeconds(1)),
                "from users");

        assertThat(race.first().outcome()).isEqualTo(Outcome.SAVED);
        assertThat(race.second()).isEqualTo(new Saved(Outcome.SAVED, new Rating("not_helpful", "뒤", stored.plusSeconds(1))));
        assertThat(jdbc.queryForMap("SELECT rating,comment FROM note_ratings"))
                .containsEntry("rating", "not_helpful").containsEntry("comment", "뒤");
        assertThat(tools.instant("SELECT created_at FROM note_ratings")).isEqualTo(stored);

        UUID same = UUID.randomUUID();
        Race<Saved, Saved> replay = tools.race(
                () -> ratings.save(member, practice, same, "helpful", "같은 요청", now.plusSeconds(2)),
                () -> ratings.save(member, practice, same, "helpful", "같은 요청", now.plusSeconds(3)),
                "from users");

        assertThat(replay.first().outcome()).isEqualTo(Outcome.SAVED);
        assertThat(replay.second()).isEqualTo(new Saved(Outcome.REPLAYED, new Rating("helpful", "같은 요청", stored.plusSeconds(2))));
    }

    // ---- 문장과 트랜잭션 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류, 새로 여는 트랜잭션 수")
    void eachPortMethodSendsTheseStatements() {
        UUID request = UUID.randomUUID();

        assertThat(tools.sent(() -> ratings.save(member, practice, request, "helpful", "좋았어요", now))).as("새 평가")
                .isEqualTo(new Sent(1, List.of(USER_LOCK, FIND_NOTE, RATING, "with note_ratings,written")));
        assertThat(tools.sent(() -> ratings.save(member, practice, UUID.randomUUID(), "not_helpful", null, now))).as("덮어쓰기")
                .isEqualTo(new Sent(1, List.of(USER_LOCK, FIND_NOTE, RATING, "with note_ratings,written")));
        assertThat(tools.sent(() -> ratings.save(member, practice, request, "helpful", "좋았어요", now))).as("다른 요청 뒤의 옛 요청 id")
                .isEqualTo(new Sent(1, List.of(USER_LOCK, FIND_NOTE, RATING, "with note_ratings,written")));
        assertThat(tools.sent(() -> ratings.save(member, practice, request, "helpful", "좋았어요", now))).as("재전송")
                .isEqualTo(new Sent(1, List.of(USER_LOCK, FIND_NOTE, RATING)));
        assertThat(tools.sent(() -> ratings.save(member, tools.practice(member), UUID.randomUUID(), "helpful", null, now)))
                .as("노트 없음").isEqualTo(new Sent(1, List.of(USER_LOCK, FIND_NOTE)));
        assertThat(tools.sent(() -> ratings.mine(member, note))).as("노트 읽기에 실린다").isEqualTo(new Sent(0, List.of(RATING)));
        assertThat(tools.sent(() -> tools.inTransaction(() -> {
            ownership.reassign(member, tools.member());
            return null;
        })).statements()).contains("update note_ratings").doesNotContain(RATING);
    }
}
