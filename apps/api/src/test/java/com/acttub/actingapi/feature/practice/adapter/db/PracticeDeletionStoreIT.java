package com.acttub.actingapi.feature.practice.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 연습 삭제가 쓰는 practice 의 두 장부(무료 횟수 표시 {@code practice_deletion_marks}, 보관한 지운 영상
 * {@code deleted_practice_videos})를 넣고 지우는 문장의 결과와 문장 수를 실제 PostgreSQL 에서 고정한다. 네이티브 SQL 을 JPA 로
 * 옮기기 전에 네이티브 구현에서 먼저 통과시킨다(apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 삭제의 응답·목록에서 빠지기·보관 동의별 영상 처리는 {@code PracticeLifecycleIT} 가, 탈퇴의 표별 결과와 문장 차례는
 * {@code AccountLifecycleFreezeIT} 가 본다. 여기서는 그 테스트가 밟지 않는 장부의 모든 칸, 시각의 경계와 정밀도, 이미 있는 지운
 * 영상 줄, 지우는 범위, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.practice.adapter.db.PracticeDeletionStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(PosterRepositoryIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PracticeDeletionStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PostgresPracticeGroupErasure erasure;

    @Autowired
    DeletedPracticeVideoPurge deletedVideos;

    @Autowired
    PostgresPracticeAccountErasure accountErasure;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-27T03:00:00Z");
    private UUID retentionDocument;
    private UUID user;
    private UUID other;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents CASCADE");
        retentionDocument = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'retention','v1','보관','보관 본문',false,?)
                """, retentionDocument, timestamp(now.minusSeconds(86_400)));
        user = user();
        other = user();
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 연습 삭제(erase) ----

    @Test
    @DisplayName("erase 는 회차마다 무료 횟수 표시를 남긴다 — 원래 주인, 회차를 만든 시각, 리딩에서 왔는지, 지운 시각(마이크로초 반올림)")
    void eraseLeavesAMarkPerPractice() {
        UUID video = video(user);
        UUID root = practice(user, video, root(), 1, now.minusSeconds(600), null);
        practice(user, video, root, 2, now.minusSeconds(300), readingSession(user));
        UUID otherRoot = practice(user, video(user), root(), 1, now.minusSeconds(100), null);

        assertThat(erase(user, root, now.plusNanos(1_500))).isNotNull();

        assertThat(jdbc.queryForList("""
                SELECT (user_id = ?) || ':' || to_char(practice_created_at AT TIME ZONE 'UTC', 'HH24:MI:SS') || ':'
                       || from_reading || ':' || to_char(deleted_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US')
                  FROM practice_deletion_marks ORDER BY practice_created_at
                """, String.class, user))
                .containsExactly("true:02:50:00:false:03:00:00.000002", "true:02:55:00:true:03:00:00.000002");
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT id) FROM practice_deletion_marks", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT user_id FROM practices WHERE id=?", UUID.class, otherRoot)).isEqualTo(user);
    }

    @Test
    @DisplayName("erase 는 보관에 동의했으면 영상을 지운 영상 장부에 원래 주인·지운 시각과 남긴다. 그 영상의 줄이 이미 있으면 그대로 둔다. 동의하지 않았으면 남기지 않는다")
    void eraseKeepsVideosOfRetainingOwners() {
        grantRetention(user);
        UUID kept = video(user);
        UUID root = practice(user, kept, root(), 1, now.minusSeconds(600), null);
        UUID again = video(user);
        UUID secondRoot = practice(user, again, root(), 1, now.minusSeconds(600), null);
        jdbc.update("INSERT INTO deleted_practice_videos(video_id,user_id,deleted_at) VALUES (?,?,?)", again, user,
                timestamp(now.minusSeconds(86_400)));
        UUID dropped = video(other);
        UUID otherRoot = practice(other, dropped, root(), 1, now.minusSeconds(600), null);

        erase(user, root, now.plusNanos(1_500));
        erase(user, secondRoot, now);
        erase(other, otherRoot, now);

        assertThat(jdbc.queryForList("""
                SELECT (video_id = ?) || ':' || (user_id = ?) || ':' || to_char(deleted_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI:SS.US')
                  FROM deleted_practice_videos ORDER BY deleted_at
                """, String.class, again, user))
                .containsExactly("true:true:11-26 03:00:00.000000", "false:true:11-27 03:00:00.000002");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM deleted_practice_videos WHERE video_id=?", Integer.class, dropped))
                .isZero();
    }

    // ---- 매일 정리(purgeExpired) ----

    @Test
    @DisplayName("purgeExpired 는 40일보다 먼저 지운 무료 횟수 표시를 지우고(같은 시각은 남긴다), 3년이 지났거나 보관 동의가 없는 지운 영상의 줄을 지운다")
    void purgeExpiredDeletesOldMarksAndPurgedVideoRows() {
        grantRetention(user);
        Instant cutoff = now.minus(Duration.ofDays(40));
        mark(user, cutoff.minusNanos(1_000));
        mark(user, cutoff);
        mark(other, now);
        UUID old = deletedVideo(user, now.minus(Duration.ofDays(1096)));
        UUID recent = deletedVideo(user, now.minusSeconds(60));
        UUID refused = deletedVideo(other, now.minusSeconds(60));
        Instant deletedBefore = now.minus(Duration.ofDays(1095));

        List<UUID> scheduled = new TransactionTemplate(transactionManager).execute(tx ->
                erasure.purgeExpired(deletedBefore, now));

        assertThat(scheduled).hasSize(2);
        assertThat(jdbc.queryForList("SELECT deleted_at FROM practice_deletion_marks ORDER BY deleted_at", OffsetDateTime.class))
                .extracting(OffsetDateTime::toInstant).containsExactly(cutoff, now);
        assertThat(jdbc.queryForList("SELECT video_id FROM deleted_practice_videos", UUID.class)).containsExactly(recent);
        assertThat(jdbc.queryForList("SELECT id FROM videos WHERE purged_at IS NOT NULL", UUID.class))
                .containsExactlyInAnyOrder(old, refused);
    }

    // ---- 탈퇴(PostgresPracticeAccountErasure) ----

    @Test
    @DisplayName("탈퇴는 그 사람의 무료 횟수 표시를 모두 지우고, 보관하지 않으면 그 사람의 지운 영상 줄도 모두 지운다. 다른 사람의 것은 그대로다")
    void accountErasureForgetsMarksAndPurgesDeletedVideos() {
        mark(user, now.minusSeconds(60));
        mark(user, now.minus(Duration.ofDays(90)));
        mark(other, now.minusSeconds(60));
        deletedVideo(user, now.minusSeconds(60));
        deletedVideo(user, now.minus(Duration.ofDays(9)));
        UUID theirs = deletedVideo(other, now.minusSeconds(60));

        List<UUID> scheduled = new TransactionTemplate(transactionManager).execute(tx ->
                accountErasure.erase(AccountErasureStep.DELETED_PRACTICES, closing(user, false)));

        assertThat(scheduled).hasSize(2);
        assertThat(jdbc.queryForList("SELECT user_id FROM practice_deletion_marks", UUID.class)).containsExactly(other);
        assertThat(jdbc.queryForList("SELECT video_id FROM deleted_practice_videos", UUID.class)).containsExactly(theirs);
    }

    @Test
    @DisplayName("보관하며 탈퇴하면 무료 횟수 표시만 지우고 지운 영상 줄은 남긴다")
    void accountErasureRetainingMediaKeepsDeletedVideos() {
        mark(user, now.minusSeconds(60));
        UUID kept = deletedVideo(user, now.minusSeconds(60));

        List<UUID> scheduled = new TransactionTemplate(transactionManager).execute(tx ->
                accountErasure.erase(AccountErasureStep.DELETED_PRACTICES, closing(user, true)));
        assertThat(scheduled).isEmpty();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_deletion_marks", Integer.class)).isZero();
        assertThat(jdbc.queryForList("SELECT video_id FROM deleted_practice_videos", UUID.class)).containsExactly(kept);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        grantRetention(user);
        UUID video = video(user);
        UUID root = practice(user, video, root(), 1, now.minusSeconds(600), null);
        practice(user, video, root, 2, now.minusSeconds(300), null);
        List<String> erased = statementsOf(() -> erase(user, root, now));
        assertThat(erased.stream().filter(label -> label.contains("practice_deletion_marks")
                || label.contains("deleted_practice_videos")).toList())
                .as("회차마다 표시 하나, 남길 영상마다 장부 줄 하나")
                .containsExactly("insert practice_deletion_marks", "insert practice_deletion_marks",
                        "insert deleted_practice_videos on conflict");
        assertThat(erased.indexOf("insert deleted_practice_videos on conflict"))
                .as("표시는 다른 기능의 정리 앞에, 영상 장부 줄은 영상을 넘기기 앞에 들어간다")
                .isGreaterThan(erased.lastIndexOf("insert practice_deletion_marks"));

        deletedVideo(user, now.minus(Duration.ofDays(2000)));
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                erasure.purgeExpired(now.minus(Duration.ofDays(1095)), now))).stream()
                .filter(label -> label.contains("practice_deletion_marks") || label.contains("deleted_practice_videos"))
                .toList())
                .containsExactly("delete practice_deletion_marks", "select consent_documents deleted_practice_videos user_consents videos for update",
                        "delete deleted_practice_videos");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                accountErasure.erase(AccountErasureStep.DELETED_PRACTICES, closing(other, false)))))
                .as("무료 횟수 표시, 보상형 광고로 받은 코칭 1회의 기록(SOMA-1067), 지운 영상 줄 순서다")
                .containsExactly("delete practice_deletion_marks", "delete coaching_rewards",
                        "select deleted_practice_videos videos for update");
    }

    // ---- 도움 ----

    private static final Pattern KIND = Pattern.compile("^(select|insert|update|delete)\\b.*");
    private static final Pattern TABLE = Pattern.compile(
            "\\b(?:from|join|into|update) (?!(?:set|skip|of|nowait|lateral)\\b)(\\w+)\\b");

    /** 문장을 "<종류> <문장에 나오는 표(가나다 순)>[ on conflict][ for update]" 로 줄인다. 별칭·열 목록은 견주지 않는다. */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher kind = KIND.matcher(text);
        if (!kind.matches()) {
            return text;
        }
        TreeSet<String> tables = new TreeSet<>();
        Matcher table = TABLE.matcher(text);
        while (table.find()) {
            tables.add(table.group(1));
        }
        tables.remove("current_document");
        return kind.group(1) + " " + String.join(" ", tables) + (text.contains(" on conflict") ? " on conflict" : "")
                + (text.contains(" for update") ? " for update" : "");
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(PracticeDeletionStoreIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private List<UUID> erase(UUID owner, UUID root, Instant at) {
        return erasure.erase(owner, root, at);
    }

    private static ClosingAccount closing(UUID userId, boolean retainMedia) {
        return new ClosingAccount(userId, retainMedia, Instant.parse("2026-11-27T03:00:00Z"), LocalDate.of(2026, 11, 27));
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    private void grantRetention(UUID userId) {
        jdbc.update("INSERT INTO user_consents(id,user_id,document_id,action,occurred_at) VALUES (?,?,?,'granted',?)",
                UUID.randomUUID(), userId, retentionDocument, timestamp(now.minusSeconds(3600)));
    }

    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, id, owner, "videos/" + owner + "/" + id + ".mp4");
        return id;
    }

    private static UUID root() {
        return UUID.randomUUID();
    }

    private UUID practice(UUID owner, UUID video, UUID root, int ordinal, Instant createdAt, UUID readingSession) {
        UUID id = ordinal == 1 ? root : UUID.randomUUID();
        // 묶음에 열린 회차는 하나라(uq_practices_open_root) 앞 회차를 닫고 잇는다.
        jdbc.update("UPDATE practices SET stage='closed', close_reason='conversation_closed' WHERE root_id=?", root);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch,
                                      reading_session_id,created_at,updated_at)
                VALUES (?,?,?,?,?,'conversing','legacy','표현','감정',?,?,?)
                """, id, owner, video, root, ordinal, readingSession, timestamp(createdAt), timestamp(createdAt));
        return id;
    }

    private UUID readingSession(UUID owner) {
        UUID script = UUID.randomUUID();
        UUID role = UUID.randomUUID();
        UUID line = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                VALUES (?,?,'갈매기','원문',repeat('0',64),'paste',?,?)
                """, script, owner, UUID.randomUUID(), "a".repeat(64));
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", role, script);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'안녕')",
                line, script, role);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,current_line_id)
                VALUES (?,?,?,?,CAST(? AS uuid[]),'read',?,?,'manual',true,'completed',?)
                """, id, script, owner, UUID.randomUUID(), "{" + role + "}", line, line, line);
        return id;
    }

    private void mark(UUID userId, Instant deletedAt) {
        jdbc.update("""
                INSERT INTO practice_deletion_marks(id,user_id,practice_created_at,from_reading,deleted_at)
                VALUES (?,?,?,false,?)
                """, UUID.randomUUID(), userId, timestamp(deletedAt.minusSeconds(60)), timestamp(deletedAt));
    }

    private UUID deletedVideo(UUID owner, Instant deletedAt) {
        UUID video = video(owner);
        jdbc.update("INSERT INTO deleted_practice_videos(video_id,user_id,deleted_at) VALUES (?,?,?)", video, owner,
                timestamp(deletedAt));
        return video;
    }

    private static OffsetDateTime timestamp(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }
}
