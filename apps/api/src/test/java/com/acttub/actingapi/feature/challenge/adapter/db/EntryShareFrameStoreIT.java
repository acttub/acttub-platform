package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.ShareFrameSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 만든 공유 프레임의 키를 참여작에 적는 일({@code EntryRepository#attachShareFrame})을 고정한다. 만들기부터 내려받기까지의
 * 흐름과 탈퇴·파기와의 순서는 {@code EntryShareFrameIT} 가 본다. 여기서는 키 목록에 적히는 값, 같은 키를 두 번 적지 않는 것,
 * 늦게 온 키를 적지 않고 정리 장부로 보내는 것, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryShareFrameStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryRepository entries;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID owner;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        owner = db.member("배우");
        UUID challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
    }

    @Test
    @DisplayName("attachShareFrame: 키를 목록 끝에 적는다. 같은 키는 두 번 적지 않고, 참여작의 다른 칸은 건드리지 않는다")
    void appendsEachKeyOnce() {
        String before = rowWithoutKeys();

        assertThat(entries.attachShareFrame(source(), "frames/a.mp4", now)).isEmpty();
        assertThat(keys()).isEqualTo("frames/a.mp4");

        assertThat(entries.attachShareFrame(source(), "frames/a.mp4", now.plusSeconds(1))).as("같은 키").isEmpty();
        assertThat(keys()).isEqualTo("frames/a.mp4");

        assertThat(entries.attachShareFrame(source(), "frames/a.jpg", now.plusSeconds(2))).isEmpty();
        assertThat(keys()).isEqualTo("frames/a.mp4,frames/a.jpg");
        assertThat(rowWithoutKeys()).as("다른 칸").isEqualTo(before);
    }

    @Test
    @DisplayName("attachShareFrame: 그 사이 원본 고르기가 바뀌었거나 참여작을 지웠으면 적지 않고 정리 장부 id 하나를 돌려준다")
    void lateKeysGoToTheLedger() {
        ShareFrameSource made = source();
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='ready',mosaic_key='mosaic/1.mp4' WHERE id=?", entry);

        assertThat(entries.attachShareFrame(made, "frames/a.mp4", now)).as("모자이크본으로 바뀜").hasSize(1);
        assertThat(keys()).isEmpty();

        ShareFrameSource mosaic = new ShareFrameSource(entry, owner, made.objectKey(), "mosaic/1.mp4", true, true, "대사", null, "배우",
                now, List.of());
        assertThat(entries.attachShareFrame(mosaic, "frames/b.mp4", now)).as("지금 고르기와 같음").isEmpty();
        assertThat(keys()).isEqualTo("frames/b.mp4");

        entries.delete(owner, entry, now.plusSeconds(1));
        assertThat(entries.attachShareFrame(mosaic, "frames/c.mp4", now.plusSeconds(2))).as("지운 뒤").hasSize(1);
        assertThat(keys()).isEmpty();
    }

    @Test
    @DisplayName("문장: 사람 행 잠금, 참여작·영상 잠금, 키 적기 한 문장씩이다. 적지 않을 때는 잠금 둘 뒤에 정리 장부에 넣는다")
    void statements() {
        ShareFrameSource made = source();

        assertThat(db.statementsOf(() -> entries.attachShareFrame(made, "frames/a.mp4", now))).as("적기")
                .containsExactly("select users for update", "select challenge_entries for update", "update challenge_entries");
        assertThat(db.statementsOf(() -> entries.attachShareFrame(made, "frames/a.mp4", now))).as("같은 키")
                .containsExactly("select users for update", "select challenge_entries for update", "update challenge_entries");

        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='ready',mosaic_key='mosaic/1.mp4' WHERE id=?", entry);
        List<String> late = db.statementsOf(() -> entries.attachShareFrame(made, "frames/b.mp4", now));
        assertThat(late.subList(0, 2)).as("적지 않음").containsExactly("select users for update", "select challenge_entries for update");
        assertThat(late).doesNotContain("update challenge_entries");
    }

    private ShareFrameSource source() {
        String object = db.jdbc.queryForObject(
                "SELECT v.object_key FROM challenge_entries e JOIN videos v ON v.id=e.video_id WHERE e.id=?", String.class, entry);
        return new ShareFrameSource(entry, owner, object, object, false, false, "대사", null, "배우", now, List.of());
    }

    private String keys() {
        return db.jdbc.queryForObject("SELECT array_to_string(share_frame_keys, ',') FROM challenge_entries WHERE id=?", String.class, entry);
    }

    private String rowWithoutKeys() {
        return db.jdbc.queryForObject("SELECT (to_jsonb(e) - 'share_frame_keys')::text FROM challenge_entries e WHERE id=?", String.class, entry);
    }
}
