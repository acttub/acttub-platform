package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ReadingExampleRepository;
import com.acttub.actingapi.feature.reading.domain.ReadingExample;
import com.acttub.actingapi.feature.reading.domain.ReadingExampleAudio;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 예시 대본 저장소가 내는 결과·잠금·문장을 고정한다. 목록·복사·같은 글 판정의 HTTP 흐름과 미리 만든 음성 내려주기는
 * {@link ReadingExampleIT} 가 본다. 여기서는 그 테스트가 밟지 않는 정렬의 둘째 기준, 꺼진 행, jsonb 두 칸을 푼 값 전체,
 * 깨진 칸, 같은 글 가운데 가장 오래된 대본을 고르는 규칙, {@code users} 행 잠금과 그 트랜잭션, 나가는 문장을 본다.
 */
class ReadingExampleRepositoryIT extends ReadingRepositoryFixture {

    private static final String DRAFT = """
            {"characters":["니나","코스챠"],
             "lines":[{"kind":"scene","text":"호숫가"},
                      {"kind":"dialogue","character":0,"text":"안녕"},
                      {"kind":"direction","character":null,"text":"사이"},
                      {"kind":"dialogue","character":1,"text":"왔구나"}]}
            """;

    private static final String AUDIO = """
            {"prefix":"reading-examples/lake/","voices":{"코스챠":"Kore"},
             "lines":[{"seq":4,"key":"4.wav","duration_ms":1200}]}
            """;

    @Autowired
    ReadingExampleRepository examples;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM reading_examples");
    }

    @Test
    @DisplayName("listActive: 켜진 예시만 sort_order 순, 같으면 id 순으로 낸다. 말을 주면 그 말의 것만 낸다")
    void listActiveOrdersAndFilters() {
        example("b-second", 2, true, "ko", null);
        example("z-first", 1, true, "ko", null);
        example("a-first", 1, true, "en", null);
        example("off", 0, false, "ko", null);

        assertThat(examples.listActive()).extracting(ReadingExample::id).containsExactly("a-first", "z-first", "b-second");
        assertThat(examples.listActive("ko")).extracting(ReadingExample::id).containsExactly("z-first", "b-second");
        assertThat(examples.listActive("en")).extracting(ReadingExample::id).containsExactly("a-first");
        assertThat(examples.listActive("ja")).isEmpty();
    }

    @Test
    @DisplayName("findActive: draft 와 audio 두 jsonb 칸을 풀어 낸다. 꺼진 예시와 없는 id 는 null 이다")
    void findActiveReadsBothJsonColumns() {
        example("lake", 1, true, "ko", AUDIO);
        example("off", 2, false, "ko", null);

        assertThat(examples.findActive("lake")).isEqualTo(new ReadingExample("lake", "제목 lake", "요약 lake", "원문 lake",
                List.of("니나", "코스챠"),
                List.of(new ReadingExample.Line("scene", null, "호숫가"),
                        new ReadingExample.Line("dialogue", 0, "안녕"),
                        new ReadingExample.Line("direction", null, "사이"),
                        new ReadingExample.Line("dialogue", 1, "왔구나")),
                new ReadingExampleAudio("reading-examples/lake/", Map.of("코스챠", "Kore"),
                        List.of(new ReadingExampleAudio.Line(4, "4.wav", 1200)))));
        assertThat(examples.findActive("off")).isNull();
        assertThat(examples.findActive("none")).isNull();
    }

    @Test
    @DisplayName("audio 칸이 SQL NULL 이거나 모양이 틀리면(JSON null 포함) 음성 없는 예시로 낸다 — 목록까지 막지 않는다")
    void aMissingOrMalformedAudioIsNoAudio() {
        example("none", 1, true, "ko", null);
        example("json-null", 2, true, "ko", "null");
        example("wrong-shape", 3, true, "ko", "{\"voices\":[]}");

        assertThat(examples.listActive()).extracting(ReadingExample::id).containsExactly("none", "json-null", "wrong-shape");
        assertThat(examples.listActive()).extracting(ReadingExample::audio).containsOnlyNulls();
    }

    @Test
    @DisplayName("sameText: 그 사람의 같은 해시 대본 가운데 가장 먼저 만든 것을(같은 시각이면 id 가 작은 것) 낸다. 남의 대본과 다른 해시는 없는 것이다")
    void sameTextPicksTheOldestScript() {
        UUID owner = member();
        UUID stranger = member();
        String hash = "a".repeat(64);
        UUID newer = scriptWithHash(owner, hash, now.plusSeconds(10), 3);
        UUID tieHigh = scriptWithHash(owner, hash, now, 2);
        UUID tieLow = scriptWithHash(owner, hash, now, 1);
        scriptWithHash(stranger, hash, now.minusSeconds(60), 4);
        scriptWithHash(owner, "b".repeat(64), now.minusSeconds(60), 5);

        assertThat(examples.sameText(owner, hash)).isEqualTo(tieLow);
        assertThat(examples.sameText(owner, "c".repeat(64))).isNull();
        assertThat(examples.sameText(member(), hash)).isNull();
        assertThat(List.of(newer, tieHigh)).doesNotContain(tieLow);
    }

    @Test
    @DisplayName("rawHash: 내 대본의 해시를 낸다. 해시가 빈 옛 대본·남의 대본·없는 대본은 null 이다")
    void rawHashReadsMyScript() {
        UUID owner = member();
        UUID hashed = scriptWithHash(owner, "a".repeat(64), now, 1);
        UUID legacy = script(owner);

        assertThat(examples.rawHash(owner, hashed)).isEqualTo("a".repeat(64));
        assertThat(examples.rawHash(owner, legacy)).isNull();
        assertThat(examples.rawHash(member(), hashed)).isNull();
        assertThat(examples.rawHash(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("withOwnerLock: 그 사람의 users 행을 FOR UPDATE 로 잡은 한 트랜잭션에서 일을 하고 그 값을 낸다. 일이 던지면 그 안에서 쓴 것이 되돌려진다")
    void withOwnerLockRunsTheWorkInOneTransaction() throws Exception {
        UUID owner = member();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", owner);
            Future<String> blocked = pool.submit(() -> examples.withOwnerLock(owner, () -> "끝"));
            String waiting = awaitWaiting("from users");
            probe.rollback();

            assertThat(waiting).startsWith("select").contains("for update");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).isEqualTo("끝");
        } finally {
            pool.shutdownNow();
        }

        assertThatThrownBy(() -> examples.withOwnerLock(owner, () -> {
            jdbc.update("UPDATE users SET nickname='쓰다 만 값' WHERE id=?", owner);
            throw new UnsupportedOperationException("일이 실패했다");
        })).isInstanceOf(UnsupportedOperationException.class);
        assertThat(jdbc.queryForObject("SELECT nickname FROM users WHERE id=?", String.class, owner)).isNull();
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 읽기는 모두 SELECT 하나, 잠그고 하는 일은 users 잠금 하나 뒤에 일의 문장이다")
    void eachPortMethodSendsTheseStatements() {
        UUID owner = member();
        example("lake", 1, true, "ko", AUDIO);

        assertThat(statementsOf(() -> examples.listActive())).containsExactly("select reading_examples");
        assertThat(statementsOf(() -> examples.listActive("ko"))).containsExactly("select reading_examples");
        assertThat(statementsOf(() -> examples.findActive("lake"))).containsExactly("select reading_examples");
        assertThat(statementsOf(() -> examples.sameText(owner, "a".repeat(64)))).containsExactly("select scripts");
        assertThat(statementsOf(() -> examples.rawHash(owner, UUID.randomUUID()))).containsExactly("select scripts");
        assertThat(statementsOf(() -> examples.withOwnerLock(owner, () -> examples.sameText(owner, "a".repeat(64)))))
                .containsExactly("select users for update", "select scripts");
    }

    private void example(String id, int sortOrder, boolean active, String language, String audio) {
        jdbc.update("""
                INSERT INTO reading_examples(id,title,summary,sort_order,active,raw_text,draft,audio,language)
                VALUES (?,?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?)
                """, id, "제목 " + id, "요약 " + id, sortOrder, active, "원문 " + id, DRAFT, audio, language);
    }

    /** @param n id 의 끝 자리 — 같은 시각일 때의 순서를 정한다 */
    private UUID scriptWithHash(UUID owner, String hash, java.time.Instant createdAt, int n) {
        UUID scriptId = UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint,created_at,updated_at)
                VALUES (?,?,'대본','원문',?,'paste',?,repeat('a',64),?,?)
                """, scriptId, owner, hash, UUID.randomUUID(), utc(createdAt), utc(createdAt));
        return scriptId;
    }
}
