package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.acttub.actingapi.feature.push.app.PracticeReminderPolicy;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository.Candidate;
import com.acttub.actingapi.feature.push.app.PracticeReminderService;
import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import com.acttub.actingapi.feature.push.app.ReminderContent;
import com.acttub.actingapi.feature.push.app.ReminderCopy;
import com.acttub.actingapi.feature.push.app.ReminderKind;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 개인화 연습 알림의 SQL(후보 고르기·이어 하기·숙제·연속 일수·선점)을 실제 Postgres에서 확인한다 (SOMA-720).
 * 오늘은 한국 시간 2026-10-21 로 고정한다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "EVENING_REMINDER_ENABLED=false"})
class PracticeReminderRepositoryIT {
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        String db = PostgresContainerSupport.createDatabaseName("practice_reminder_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(db));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 21);
    private static final Instant WINDOW = TODAY.minusDays(7).atStartOfDay(PracticeReminderPolicy.SEOUL).toInstant();

    @Autowired JdbcTemplate jdbc;
    @Autowired PracticeReminderRepository reminders;

    private static Timestamp kst(String dateTime) {
        return Timestamp.from(LocalDateTime.parse(dateTime).atZone(PracticeReminderPolicy.SEOUL).toInstant());
    }

    private UUID user(String name, boolean enabled, String version, String signup) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status,created_at) VALUES (?,?, 'active',?)", id, name + "@test.invalid", kst(signup));
        jdbc.update("INSERT INTO user_profiles(user_id,name,notify_evening_reminder) VALUES (?,?,?)", id, name, enabled);
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform,locale,app_version) VALUES (?,?,'ios','ko',?)",
                id, "token-" + name, version);
        return id;
    }

    private void video(UUID userId, String at) {
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                UUID.randomUUID(), userId, "video/" + UUID.randomUUID(), kst(at));
    }

    private UUID script(UUID userId, String title, String at) {
        return script(userId, title, at, "paste");
    }

    private UUID script(UUID userId, String title, String at, String source) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_fingerprint,created_at,updated_at) VALUES (?,?,?,'r',repeat('0',64),?,?,?,?)",
                id, userId, title, source, "f".repeat(64), kst(at), kst(at));
        return id;
    }

    private UUID videoId(UUID userId, String at) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                id, userId, "video/" + id, kst(at));
        return id;
    }

    private static final Instant PENDING_SINCE = kst("2026-10-14T20:00").toInstant();

    /** 영상 + 연습 한 회차. rootId 가 null 이면 첫 회차(자기 자신이 root). */
    private UUID practice(UUID userId, UUID rootId, int ordinal, String title, String at, boolean hiddenRoot) {
        return practice(userId, rootId, ordinal, title, at, hiddenRoot, "closed");
    }

    /** stage 는 closed(끝난 회차) 또는 conversing(진행 중). 묶음에는 진행 중 회차가 하나뿐이다. */
    private UUID practice(UUID userId, UUID rootId, int ordinal, String title, String at, boolean hiddenRoot, String stage) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                videoId, userId, "video/" + videoId, kst(at));
        UUID id = UUID.randomUUID();
        UUID root = rootId == null ? id : rootId;
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch,title,created_at,hidden_at)
                VALUES (?,?,?,?,?,?,'three_layers_v1','분석','캐릭터 분석',?,?,?)
                """, id, userId, videoId, root, ordinal, stage, title, kst(at), hiddenRoot ? kst(at) : null);
        if ("closed".equals(stage)) jdbc.update("UPDATE practices SET close_reason='conversation_closed' WHERE id=?", id);
        return id;
    }

    private UUID conversation(UUID practiceId, String status, String at) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status,created_at) VALUES (?,?,?,?,?)",
                id, practiceId, UUID.randomUUID(), status, kst(at));
        return id;
    }

    private void message(UUID conversationId, int turn, String role, String text, String at) {
        jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,created_at) VALUES (?,?,?,?,?,?)",
                UUID.randomUUID(), conversationId, turn, role, text, kst(at));
    }

    private void note(UUID conversationId, String kind, String nextTake, boolean fallback, String at) {
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision,next_take,fallback,created_at)
                VALUES (?,?,'v2',?,1,?,?,?)
                """, UUID.randomUUID(), conversationId, kind, nextTake, fallback, kst(at));
    }

    private Candidate find(List<Candidate> list, UUID userId) {
        return list.stream().filter(c -> c.userId().equals(userId)).findFirst().orElse(null);
    }

    @Test
    void candidatesCoverTheSevenDayWindowAndRespectSettingsVersionAndStatus() {
        UUID yesterday = user("yesterday", true, "0.1.2", "2026-09-01T10:00");
        video(yesterday, "2026-10-20T20:00");
        video(yesterday, "2026-10-20T21:30");
        UUID today = user("today", true, "0.1.2", "2026-09-01T10:00");
        video(today, "2026-10-21T08:00");
        UUID sixDays = user("six-days", true, "0.1.2", "2026-09-01T10:00");
        video(sixDays, "2026-10-15T12:00");
        UUID tooOld = user("too-old", true, "0.1.2", "2026-09-01T10:00");
        video(tooOld, "2026-10-13T12:00");
        UUID never = user("never", true, "0.1.2", "2026-10-19T10:00");
        UUID neverOld = user("never-old", true, "0.1.2", "2026-10-10T10:00");
        UUID scriptOnly = user("script-only", true, "0.1.2", "2026-10-19T11:00");
        script(scriptOnly, "대본만 올림", "2026-10-20T10:00");
        UUID toggleOff = user("toggle-off", false, "0.1.2", "2026-09-01T10:00");
        video(toggleOff, "2026-10-20T20:00");
        UUID oldVersion = user("old-version", true, "0.1.1", "2026-09-01T10:00");
        video(oldVersion, "2026-10-20T20:00");
        UUID unknownVersion = user("unknown-version", true, null, "2026-09-01T10:00");
        video(unknownVersion, "2026-10-20T20:00");
        UUID inactive = user("inactive", true, "0.1.2", "2026-09-01T10:00");
        video(inactive, "2026-10-20T20:00");
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", inactive);

        List<Candidate> all = reminders.candidates(TODAY, WINDOW, "0.1.2");

        Candidate y = find(all, yesterday);
        assertThat(y).isNotNull();
        assertThat(y.lastPracticeDay()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(y.firstPracticeAt()).isEqualTo(kst("2026-10-20T20:00").toInstant());
        assertThat(y.neverPracticed()).isFalse();
        assertThat(y.practicedToday()).isFalse();
        assertThat(y.lastWasReading()).isFalse();
        assertThat(y.targets()).extracting(t -> t.token()).containsExactly("token-yesterday");
        assertThat(find(all, today).practicedToday()).isTrue();
        assertThat(find(all, sixDays)).isNotNull();
        assertThat(find(all, tooOld)).as("7일(윈도) 밖의 마지막 연습은 후보가 아니다").isNull();
        Candidate n = find(all, never);
        assertThat(n.neverPracticed()).isTrue();
        assertThat(n.lastPracticeDay()).isEqualTo(LocalDate.of(2026, 10, 19));
        assertThat(n.firstPracticeAt()).isEqualTo(kst("2026-10-19T10:00").toInstant());
        assertThat(find(all, neverOld)).as("가입한 지 7일이 넘은 연습 전 회원은 후보가 아니다").isNull();
        Candidate s = find(all, scriptOnly);
        assertThat(s).as("대본만 올린 것은 연습이 아니라 연습 전 회원이다").isNotNull();
        assertThat(s.neverPracticed()).isTrue();
        assertThat(find(all, toggleOff)).isNull();
        assertThat(find(all, oldVersion)).isNull();
        assertThat(find(all, unknownVersion)).isNull();
        assertThat(find(all, inactive)).isNull();
    }

    @Test
    void lastEventKindReportsReading() {
        UUID reader = user("reader", true, "0.1.2", "2026-09-01T10:00");
        video(reader, "2026-10-19T20:00");
        UUID scriptId = script(reader, "읽은 대본", "2026-10-19T19:00");
        jdbc.update("""
                INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'역할',0)
                """, UUID.randomUUID(), scriptId);
        UUID characterId = jdbc.queryForObject("SELECT id FROM script_characters WHERE script_id=?", UUID.class, scriptId);
        UUID lineId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,0,'dialogue','안녕하세요 반갑습니다',?)",
                lineId, scriptId, characterId);
        jdbc.update("""
                INSERT INTO reading_sessions(id,user_id,script_id,mode,advance,my_character_ids,start_line_id,end_line_id,status,record,started_at,updated_at)
                VALUES (?,?,?,'read','manual',ARRAY[?]::uuid[],?,?,'completed',false,?,?)
                """, UUID.randomUUID(), reader, scriptId, characterId, lineId, lineId, kst("2026-10-20T20:30"), kst("2026-10-20T20:40"));

        Candidate c = find(reminders.candidates(TODAY, WINDOW, "0.1.2"), reader);
        assertThat(c.lastWasReading()).isTrue();
        assertThat(c.lastPracticeDay()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(c.firstPracticeAt()).isEqualTo(kst("2026-10-20T20:30").toInstant());
    }

    @Test
    void claimIsOncePerUserDayAndSlotAndSlotsAreIndependent() {
        UUID u = user("claim", true, "0.1.2", "2026-09-01T10:00");
        video(u, "2026-10-20T20:00");
        ReminderCopy practice = new ReminderCopy(ReminderKind.GENERAL, 1, "general.1.a", "t", "b", null, null);
        ReminderCopy streak = new ReminderCopy(ReminderKind.STREAK, 0, "streak.a", "t", "b", null, null);

        assertThat(reminders.claim(u, TODAY, practice)).isTrue();
        assertThat(reminders.claim(u, TODAY, practice)).isFalse();
        assertThat(reminders.claim(u, TODAY, new ReminderCopy(ReminderKind.HOMEWORK, 1, "homework.1.a", "t", "b", null, null)))
                .as("같은 칸이면 종류가 달라도 하루 한 번").isFalse();
        assertThat(reminders.claim(u, TODAY, streak)).isTrue();
        assertThat(reminders.claim(u, TODAY.plusDays(1), practice)).isTrue();

        assertThat(find(reminders.candidates(TODAY, WINDOW, "0.1.2"), u).sentToday()).containsExactlyInAnyOrder("practice", "streak");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_reminder_sends WHERE user_id=?", Long.class, u)).isEqualTo(3L);
        assertThat(jdbc.queryForMap("SELECT kind,skipped_days,template_id FROM practice_reminder_sends WHERE user_id=? AND slot='practice' AND day=?",
                u, java.sql.Date.valueOf(TODAY))).containsEntry("kind", "general").containsEntry("template_id", "general.1.a");
    }

    @Test
    void resumeConversationIsClaimedOnlyOnceAcrossDays() {
        UUID u = user("resume-once", true, "0.1.2", "2026-09-01T10:00");
        UUID p = practice(u, null, 1, "연습", "2026-10-20T20:00", false, "conversing");
        UUID c = conversation(p, "open", "2026-10-20T20:01");
        ReminderCopy copy = new ReminderCopy(ReminderKind.RESUME, 1, "resume.a", "t", "b", c, p);
        assertThat(reminders.claim(u, TODAY, copy)).isTrue();
        assertThat(reminders.claim(u, TODAY.plusDays(1), copy)).isFalse();
        assertThat(reminders.claim(u, TODAY.plusDays(1), new ReminderCopy(ReminderKind.GENERAL, 1, "general.a", "t", "b", null, null))).isTrue();
    }

    @Test
    void recentTemplatesReturnsTheLastDayEachWasUsed() {
        UUID u = user("recent", true, "0.1.2", "2026-09-01T10:00");
        jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,'practice','general',1,'general.1.a')",
                u, java.sql.Date.valueOf(TODAY.minusDays(3)));
        jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,'practice','general',1,'general.1.a')",
                u, java.sql.Date.valueOf(TODAY.minusDays(1)));
        jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,'streak','streak',0,'streak.b')",
                u, java.sql.Date.valueOf(TODAY.minusDays(20)));

        Map<String, LocalDate> used = reminders.recentTemplates(u, TODAY.minusDays(14));
        assertThat(used).containsExactly(Map.entry("general.1.a", TODAY.minusDays(1)));
    }

    @Test
    void homeworkIsTheLatestNonFallbackActionNoteAndSkipsHiddenGroupsIncludingLaterRounds() {
        UUID u = user("homework", true, "0.1.2", "2026-09-01T10:00");
        UUID visible = practice(u, null, 1, "보이는 연습", "2026-10-18T20:00", false);
        note(conversation(visible, "closed", "2026-10-18T20:01"), "action", "첫 번째 숙제를 천천히 해 보세요.", false, "2026-10-18T20:30");

        // 숨긴 묶음: 숨김 표시는 첫 회차에만 있고 2회차 노트는 더 최근이다 — 그래도 건너뛴다
        UUID hiddenRoot = practice(u, null, 1, "숨긴 연습", "2026-10-19T20:00", true);
        UUID hiddenRound2 = practice(u, hiddenRoot, 2, "숨긴 연습", "2026-10-19T21:00", false);
        note(conversation(hiddenRound2, "closed", "2026-10-19T21:01"), "action", "숨긴 묶음의 숙제를 해 보세요.", false, "2026-10-19T21:30");

        ReminderContent.Homework homework = reminders.latestHomework(u);
        assertThat(homework).isNotNull();
        assertThat(homework.practiceId()).isEqualTo(visible);
        assertThat(homework.nextTake()).isEqualTo("첫 번째 숙제를 천천히 해 보세요.");

        // 더 최근의 대체 문구(fallback) 노트는 무시한다
        UUID later = practice(u, null, 1, "또 다른 연습", "2026-10-20T20:00", false);
        note(conversation(later, "closed", "2026-10-20T20:01"), "action", "대체 문구의 숙제입니다 읽지 마세요.", true, "2026-10-20T20:30");
        assertThat(reminders.latestHomework(u).practiceId()).isEqualTo(visible);

        // 가장 최근 노트가 action 이 아니면(관찰) 숙제가 없다
        UUID observation = practice(u, null, 1, "관찰 연습", "2026-10-20T22:00", false);
        note(conversation(observation, "closed", "2026-10-20T22:01"), "observation", null, false, "2026-10-20T22:30");
        assertThat(reminders.latestHomework(u)).isNull();
    }

    @Test
    void homeworkTextSensitiveTermsComeFromRecentScripts() {
        UUID u = user("sensitive", true, "0.1.2", "2026-09-01T10:00");
        UUID scriptId = script(u, "비밀 작품명", "2026-10-19T10:00");
        UUID characterId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'비밀인물',0)", characterId, scriptId);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,0,'dialogue','그 말만은 하지 말아 줘요',?)",
                UUID.randomUUID(), scriptId, characterId);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,1,'dialogue','네',?)",
                UUID.randomUUID(), scriptId, characterId);
        UUID p = practice(u, null, 1, "연습 제목", "2026-10-20T20:00", false);
        note(conversation(p, "closed", "2026-10-20T20:01"), "action", "비밀인물에게 말할 때 숙제를 해 보세요.", false, "2026-10-20T20:30");

        assertThat(reminders.latestHomework(u).sensitive())
                .contains("연습 제목", "비밀 작품명", "비밀인물", "그 말만은 하지 말아 줘요")
                .doesNotContain("네");
    }

    @Test
    void resumeNeedsAnOpenLatestConversationWhoseLastMessageIsACoachQuestion() {
        UUID u = user("resume", true, "0.1.2", "2026-09-01T10:00");
        UUID p = practice(u, null, 1, "이어 할 연습", "2026-10-20T20:00", false, "conversing");
        UUID c = conversation(p, "open", "2026-10-20T20:01");
        message(c, 0, "ai", "어떤 장면을 찍었나요?", "2026-10-20T20:02");

        ReminderContent.Resume unanswered = reminders.latestOpenQuestion(u);
        assertThat(unanswered).isNotNull();
        assertThat(unanswered.conversationId()).isEqualTo(c);
        assertThat(unanswered.practiceId()).isEqualTo(p);
        assertThat(unanswered.actorAnswered()).isFalse();
        assertThat(unanswered.lastCoachText()).isEqualTo("어떤 장면을 찍었나요?");

        message(c, 1, "actor", "문 앞에서 돌아서는 장면이요", "2026-10-20T20:05");
        message(c, 2, "ai", "그 순간 인물은 무엇을 가장 원했을까요?", "2026-10-20T20:06");
        ReminderContent.Resume answered = reminders.latestOpenQuestion(u);
        assertThat(answered.actorAnswered()).isTrue();
        assertThat(answered.lastCoachText()).isEqualTo("그 순간 인물은 무엇을 가장 원했을까요?");

        // 마지막이 배우의 답이면 코치 질문이 남은 것이 아니다
        message(c, 3, "actor", "상대가 남아 주길요", "2026-10-20T20:07");
        assertThat(reminders.latestOpenQuestion(u)).isNull();
    }

    @Test
    void resumeIgnoresClosedConversationsNonQuestionsAndHiddenGroups() {
        UUID closed = user("resume-closed", true, "0.1.2", "2026-09-01T10:00");
        UUID p1 = practice(closed, null, 1, "닫힌 연습", "2026-10-20T20:00", false);
        UUID c1 = conversation(p1, "closed", "2026-10-20T20:01");
        message(c1, 0, "ai", "마지막 질문이었나요?", "2026-10-20T20:02");
        assertThat(reminders.latestOpenQuestion(closed)).isNull();

        UUID statement = user("resume-statement", true, "0.1.2", "2026-09-01T10:00");
        UUID p2 = practice(statement, null, 1, "서술 연습", "2026-10-20T20:00", false, "conversing");
        message(conversation(p2, "open", "2026-10-20T20:01"), 0, "ai", "좋아요. 오늘은 여기까지 해요.", "2026-10-20T20:02");
        assertThat(reminders.latestOpenQuestion(statement)).isNull();

        UUID hidden = user("resume-hidden", true, "0.1.2", "2026-09-01T10:00");
        UUID root = practice(hidden, null, 1, "숨긴 연습", "2026-10-20T19:00", true);
        UUID round2 = practice(hidden, root, 2, "숨긴 연습", "2026-10-20T20:00", false, "conversing");
        message(conversation(round2, "open", "2026-10-20T20:01"), 0, "ai", "숨긴 묶음의 질문인가요?", "2026-10-20T20:02");
        assertThat(reminders.latestOpenQuestion(hidden)).isNull();
    }

    @Test
    void countedPracticeDaysMirrorTheAppStreakInputs() {
        UUID u = user("counted", true, "0.1.2", "2026-09-01T10:00");
        // 노트가 생긴 코칭 회차만 센다
        UUID withNote = practice(u, null, 1, "노트 있음", "2026-10-20T10:00", false);
        note(conversation(withNote, "closed", "2026-10-20T10:01"), "action", "다음엔 이렇게 해 보세요 정말로.", false, "2026-10-20T10:30");
        UUID noNote = practice(u, null, 1, "노트 없음", "2026-10-19T10:00", false);
        conversation(noNote, "open", "2026-10-19T10:01");
        // 숨긴 묶음도 센다(앱은 기기에 쌓은 연습일을 합친다)
        UUID hidden = practice(u, null, 1, "숨김", "2026-10-18T10:00", true);
        note(conversation(hidden, "closed", "2026-10-18T10:01"), "observation", null, false, "2026-10-18T10:30");
        // 자정 직전(한국)은 한국 날짜로 센다
        UUID lateNight = practice(u, null, 1, "밤", "2026-10-17T23:50", false);
        note(conversation(lateNight, "closed", "2026-10-17T23:51"), "observation", null, false, "2026-10-17T23:55");

        Set<LocalDate> days = reminders.countedPracticeDays(u, TODAY.minusDays(30));
        assertThat(days).containsExactlyInAnyOrder(LocalDate.of(2026, 10, 20), LocalDate.of(2026, 10, 18), LocalDate.of(2026, 10, 17));
        assertThat(PracticeReminderPolicy.streak(days, TODAY)).isEqualTo(1);
    }

    @Test
    void serviceSendsPersonalizedPushesFromRealRowsAndRemembersThem() {
        UUID u = user("service", true, "0.1.2", "2026-09-01T10:00");
        // 대본은 숙제 문구에서 지울 작품명·인물명의 출처일 뿐이다. 7일보다 오래돼 unread_script 대상은 아니다.
        UUID scriptId = script(u, "비밀 작품명", "2026-10-01T10:00");
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'비밀인물',0)", UUID.randomUUID(), scriptId);
        UUID p = practice(u, null, 1, "비밀 작품명 3장", "2026-10-20T20:00", false);
        UUID c = conversation(p, "closed", "2026-10-20T20:01");
        note(c, "action", "비밀 작품명 대신 비밀인물의 눈을 보고 한 호흡 쉬고 시작해 보세요.", false, "2026-10-20T20:30");

        List<PushMessage> sent = new ArrayList<>();
        PushTokenRepository tokens = new PushTokenRepository() {
            @Override public void register(UUID userId, String token, String platform, String appVersion) { throw new AssertionError(); }
            @Override public void unregister(String token) { }
            @Override public List<com.acttub.actingapi.feature.push.app.PushTarget> analysisDoneTargets(UUID sessionId) { return List.of(); }
        };
        Clock at1930 = Clock.fixed(LocalDateTime.parse("2026-10-21T19:30").atZone(PracticeReminderPolicy.SEOUL).toInstant(), ZoneOffset.UTC);
        PracticeReminderService service = new PracticeReminderService(reminders, tokens,
                messages -> { sent.addAll(messages); return List.of(); }, new RecordingFailureReporter(), at1930, "0.1.2");

        service.sendDue();
        service.sendDue();

        List<PushMessage> mine = sent.stream().filter(m -> m.to().equals("token-service")).toList();
        assertThat(mine).hasSize(1);
        PushMessage message = mine.getFirst();
        assertThat(message.data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "homework").containsEntry("skipped_days", "1")
                .containsEntry("practice_id", p.toString());
        assertThat(message.title() + message.body()).doesNotContain("비밀 작품명").doesNotContain("비밀인물");
        assertThat(jdbc.queryForObject("SELECT template_id FROM practice_reminder_sends WHERE user_id=? AND slot='practice'",
                String.class, u)).isEqualTo(message.data().get("template_id"));
    }

    @Test
    void latestPendingVideoPicksTheNewestUnusedVideoOfTheOwnerWithinSevenDays() {
        UUID u = user("pendingvideo", true, "0.1.2", "2026-09-01T10:00");
        UUID other = user("pendingvideo_other", true, "0.1.2", "2026-09-01T10:00");
        assertThat(reminders.latestPendingVideo(u, PENDING_SINCE)).as("영상 없음").isNull();

        UUID old = videoId(u, "2026-10-10T10:00");                    // 7일보다 오래됨
        UUID purged = videoId(u, "2026-10-20T10:00");
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=?", purged);
        videoId(other, "2026-10-20T11:00");                           // 남의 영상
        assertThat(reminders.latestPendingVideo(u, PENDING_SINCE)).as("오래됨·파기·남의 것은 제외").isNull();

        UUID first = videoId(u, "2026-10-18T10:00");
        UUID newest = videoId(u, "2026-10-19T10:00");
        assertThat(reminders.latestPendingVideo(u, PENDING_SINCE)).as("가장 최근 것").isEqualTo(newest);

        UUID practiceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch,title,created_at,close_reason)
                VALUES (?,?,?,?,1,'closed','three_layers_v1','분석','캐릭터 분석','쓴 영상',?,'conversation_closed')
                """, practiceId, u, newest, practiceId, kst("2026-10-20T09:00"));
        assertThat(reminders.latestPendingVideo(u, PENDING_SINCE)).as("코칭에 쓴 영상은 제외, 다음으로 최근 것").isEqualTo(first);

        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (id,line,work,character,duration_days,origin,request_id,request_fingerprint,featured_on,starts_at,ends_at)
                VALUES (?, '대사', '작품', '인물', 7, 'team', ?, ?, ?, ?, ?)
                """, challenge, UUID.randomUUID(), "a".repeat(64), java.sql.Date.valueOf(TODAY), kst("2026-10-18T00:00"), kst("2026-10-28T00:00"));
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint)
                VALUES (?,?,?,?,'private','visible',?,?)
                """, UUID.randomUUID(), challenge, u, first, UUID.randomUUID(), "b".repeat(64));
        assertThat(reminders.latestPendingVideo(u, PENDING_SINCE)).as("참여작에 쓴 영상도 제외").isNull();
        assertThat(old).isNotNull();
    }

    @Test
    void latestUnreadScriptSkipsSamplesReadScriptsOldOnesAndOtherUsers() {
        UUID u = user("unreadscript", true, "0.1.2", "2026-09-01T10:00");
        UUID other = user("unreadscript_other", true, "0.1.2", "2026-09-01T10:00");
        script(u, "오래된 대본", "2026-10-10T10:00");
        script(u, "예시 대본", "2026-10-20T10:00", "sample");
        script(other, "남의 대본", "2026-10-20T11:00");
        assertThat(reminders.latestUnreadScript(u, PENDING_SINCE)).as("오래됨·예시·남의 것은 제외").isNull();

        UUID older = script(u, "붙여넣은 대본", "2026-10-18T10:00", "paste");
        UUID newest = script(u, "파일 대본", "2026-10-19T10:00", "file");
        assertThat(reminders.latestUnreadScript(u, PENDING_SINCE)).isEqualTo(newest);

        UUID characterId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'역할',0)", characterId, newest);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,0,'dialogue','안녕하세요 반갑습니다',?)",
                lineId, newest, characterId);
        jdbc.update("""
                INSERT INTO reading_sessions(id,user_id,script_id,mode,advance,my_character_ids,start_line_id,end_line_id,status,record,started_at,updated_at)
                VALUES (?,?,?,'read','manual',ARRAY[?]::uuid[],?,?,'in_progress',false,?,?)
                """, UUID.randomUUID(), u, newest, characterId, lineId, lineId, kst("2026-10-20T20:30"), kst("2026-10-20T20:40"));
        assertThat(reminders.latestUnreadScript(u, PENDING_SINCE)).as("리딩을 시작한 대본은 제외").isEqualTo(older);
    }

    @Test
    void sentCountsByKindCountsOnlyFromTheGivenDay() {
        UUID u = user("counts", true, "0.1.2", "2026-09-01T10:00");
        for (int ago : new int[] {8, 5, 2}) {
            jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,'practice','pending_video',1,?)",
                    u, java.sql.Date.valueOf(TODAY.minusDays(ago)), "video." + ago);
        }
        jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,'practice','unread_script',1,'script.a')",
                u, java.sql.Date.valueOf(TODAY.minusDays(1)));
        assertThat(reminders.sentCountsByKind(u, TODAY.minusDays(6)))
                .containsEntry("pending_video", 2).containsEntry("unread_script", 1).hasSize(2);
        assertThat(reminders.sentCountsByKind(UUID.randomUUID(), TODAY.minusDays(6))).isEmpty();
    }
}
