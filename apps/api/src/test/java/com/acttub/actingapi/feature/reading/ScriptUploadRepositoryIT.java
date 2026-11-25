package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository.Upload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * 대본 원본 파일 장부가 내는 결과·잠금·문장을 고정한다. 올리기에서 나누기·정리까지의 흐름과 실패 보관, 미연결 정리는
 * {@link ReadingUploadIT} 가 본다. 여기서는 그 테스트가 밟지 않는 시각의 정밀도, 연결된 원본의 글과 요청 id 를 고르는 규칙,
 * 글을 둘 때 지우는 칸, 같은 객체 키, 행 잠금의 세기, 포트 메서드마다 나가는 문장을 본다.
 */
class ScriptUploadRepositoryIT extends ReadingRepositoryFixture {

    @Autowired
    ScriptUploadRepository uploads;

    private UUID owner;

    @BeforeEach
    void setUp() {
        owner = member();
    }

    @Test
    @DisplayName("reserve: 넘긴 값을 적고 시각을 마이크로초로 반올림한다. 글·대본·실패·보관 시한은 비어 있다. find 는 그 행을 연결 전 모양으로 낸다")
    void reserveWritesTheRowAndFindReadsIt() {
        UUID upload = UUID.randomUUID();

        uploads.reserve(owner, upload, "scripts/a.pdf", "대본.pdf", 1234L, now.plusSeconds(600).plusNanos(123_456_789),
                now.plusNanos(987_654_321));

        assertThat(jdbc.queryForMap("SELECT * FROM script_uploads WHERE id=?", upload))
                .containsEntry("user_id", owner).containsEntry("object_key", "scripts/a.pdf")
                .containsEntry("file_name", "대본.pdf").containsEntry("byte_size", 1234L)
                .containsEntry("raw_text", null).containsEntry("script_id", null).containsEntry("failure", null)
                .containsEntry("kept_until", null);
        assertThat(instant("SELECT expires_at FROM script_uploads WHERE id=?", upload))
                .isEqualTo(now.plusSeconds(600).plus(123_457, ChronoUnit.MICROS));
        assertThat(instant("SELECT created_at FROM script_uploads WHERE id=?", upload))
                .isEqualTo(now.plus(987_654, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM script_uploads WHERE id=?", upload))
                .isEqualTo(now.plus(987_654, ChronoUnit.MICROS));
        assertThat(uploads.find(owner, upload)).isEqualTo(new Upload(upload, "scripts/a.pdf", 1234L, null, false, null));
    }

    @Test
    @DisplayName("reserve: 파일 이름이 없어도 된다. 같은 객체 키를 다시 넣으면 DataIntegrityViolationException 이고 행은 하나다")
    void reserveRefusesTheSameObjectKey() {
        uploads.reserve(owner, UUID.randomUUID(), "scripts/a.pdf", null, 1L, now.plusSeconds(600), now);

        assertThatThrownBy(() -> uploads.reserve(owner, UUID.randomUUID(), "scripts/a.pdf", null, 1L, now.plusSeconds(600), now))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(count("script_uploads")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT file_name FROM script_uploads", String.class)).isNull();
    }

    @Test
    @DisplayName("find: 없는 id 와 남의 원본은 null 이다")
    void findHidesMissingAndOthersRows() {
        UUID upload = UUID.randomUUID();
        uploads.reserve(owner, upload, "scripts/a.pdf", null, 1L, now.plusSeconds(600), now);

        assertThat(uploads.find(member(), upload)).isNull();
        assertThat(uploads.find(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("find: 연결 전에는 원본 행의 글을, 연결 뒤에는 대본의 원문을 낸다. 연결한 요청 id 는 그 대본으로 이어진 나누기 요청 가운데 가장 먼저 만든 것이다")
    void findReadsTheLinkedScriptsTextAndRequest() {
        UUID upload = UUID.randomUUID();
        uploads.reserve(owner, upload, "scripts/a.pdf", null, 1L, now.plusSeconds(600), now);
        uploads.saveText(upload, "뽑은 글", now);
        assertThat(uploads.find(owner, upload)).isEqualTo(new Upload(upload, "scripts/a.pdf", 1L, "뽑은 글", false, null));

        UUID script = script(owner);
        UUID otherScript = script(owner);
        UUID later = scriptImport(owner, upload, script, now.plusSeconds(2));
        UUID earlier = scriptImport(owner, upload, script, now.plusSeconds(1));
        scriptImport(owner, upload, otherScript, now);
        scriptImport(owner, upload, null, now.minusSeconds(5));
        jdbc.update("UPDATE script_uploads SET script_id=?, raw_text=NULL WHERE id=?", script, upload);

        assertThat(uploads.find(owner, upload)).isEqualTo(new Upload(upload, "scripts/a.pdf", 1L, "원문", true,
                jdbc.queryForObject("SELECT request_id FROM script_imports WHERE id=?", UUID.class, earlier)));
        assertThat(later).isNotEqualTo(earlier);
    }

    @Test
    @DisplayName("saveText: 글과 고친 시각을 적고 앞서 남긴 실패·보관 시한을 지운다. 다른 행은 그대로다")
    void saveTextClearsTheFailure() {
        UUID upload = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        uploads.reserve(owner, upload, "scripts/a.pdf", null, 1L, now.plusSeconds(600), now);
        uploads.reserve(owner, other, "scripts/b.pdf", null, 1L, now.plusSeconds(600), now);
        jdbc.update("UPDATE script_uploads SET failure='failed', kept_until=now()");

        uploads.saveText(upload, "뽑은 글", now.plusSeconds(30).plusNanos(1_500));

        assertThat(jdbc.queryForMap("SELECT raw_text,failure,kept_until FROM script_uploads WHERE id=?", upload))
                .containsEntry("raw_text", "뽑은 글").containsEntry("failure", null).containsEntry("kept_until", null);
        assertThat(instant("SELECT updated_at FROM script_uploads WHERE id=?", upload))
                .isEqualTo(now.plusSeconds(30).plus(2, ChronoUnit.MICROS));
        assertThat(jdbc.queryForMap("SELECT raw_text,failure FROM script_uploads WHERE id=?", other))
                .containsEntry("raw_text", null).containsEntry("failure", "failed");
    }

    @Test
    @DisplayName("saveText 의 잠금은 FOR NO KEY UPDATE 세기다 — 바깥 연결의 FOR KEY SHARE 는 막지 않고 FOR SHARE 뒤에서는 기다린다")
    void saveTextLocksLikeAnUpdateOfANonKeyColumn() throws Exception {
        UUID upload = UUID.randomUUID();
        uploads.reserve(owner, upload, "scripts/a.pdf", null, 1L, now.plusSeconds(600), now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM script_uploads WHERE id=? FOR KEY SHARE", upload);
            pool.submit(() -> uploads.saveText(upload, "하나", now)).get(20, TimeUnit.SECONDS);
            probe.rollback();

            run(probe, "SELECT 1 FROM script_uploads WHERE id=? FOR SHARE", upload);
            Future<?> blocked = pool.submit(() -> uploads.saveText(upload, "둘", now));
            String waiting = awaitWaiting("script_uploads");
            probe.rollback();

            assertThat(waiting).startsWith("update script_uploads");
            blocked.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_uploads", String.class)).isEqualTo("둘");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 자리 잡기는 INSERT 하나, 읽기는 SELECT 하나, 글 두기와 실패 남기기는 UPDATE 하나다")
    void eachPortMethodSendsTheseStatements() {
        UUID upload = UUID.randomUUID();

        assertThat(statementsOf(() -> uploads.reserve(owner, upload, "scripts/a.pdf", null, 1L, now.plusSeconds(600), now)))
                .containsExactly("insert script_uploads");
        assertThat(statementsOf(() -> uploads.find(owner, upload))).containsExactly("select script_uploads");
        assertThat(statementsOf(() -> uploads.find(owner, UUID.randomUUID()))).containsExactly("select script_uploads");
        assertThat(statementsOf(() -> uploads.saveText(upload, "글", now))).containsExactly("update script_uploads");
        assertThat(statementsOf(() -> uploads.recordFailure(upload, "failed", now.plusSeconds(60), now)))
                .containsExactly("update script_uploads");
    }

    private UUID scriptImport(UUID user, UUID upload, UUID script, java.time.Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO script_imports(id,user_id,request_id,request_fingerprint,source,raw_text,raw_hash,script_id,upload_id,
                                           created_at,updated_at)
                VALUES (?,?,?,repeat('f',64),'file','',repeat('h',64),?,?,?,?)
                """, id, user, UUID.randomUUID(), script, upload, utc(createdAt), utc(createdAt));
        return id;
    }
}
