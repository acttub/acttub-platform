package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import com.acttub.actingapi.feature.push.app.ReminderContent.Homework;
import com.acttub.actingapi.feature.push.app.ReminderContent.PracticeInput;
import com.acttub.actingapi.feature.push.app.ReminderContent.Resume;
import com.acttub.actingapi.feature.push.app.ReminderTemplates.Template;
import org.junit.jupiter.api.Test;

/** 알림 종류를 고르는 순서, 문구 돌려쓰기, 문구 목록 자체의 점검 (account.notification). */
class ReminderContentTest {
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 21);
    private static final UUID CONVERSATION = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID PRACTICE = UUID.fromString("00000000-0000-0000-0000-0000000000b1");

    private static Resume resume(boolean answered, String question) {
        return new Resume(CONVERSATION, PRACTICE, answered, question, List.of());
    }

    private static Homework homework(String nextTake) {
        return new Homework(PRACTICE, nextTake, List.of());
    }

    private static PracticeInput input(int k, boolean never, boolean reading, Resume resume, Homework homework) {
        return new PracticeInput(USER, TODAY, k, never, reading, resume, homework, true);
    }

    @Test
    void neverPracticedGetsFirstPracticeEvenWithOtherInputs() {
        ReminderCopy copy = ReminderContent.practice(input(2, true, false, null, null), Map.of());
        assertThat(copy.kind()).isEqualTo(ReminderKind.FIRST_PRACTICE);
        assertThat(copy.templateId()).startsWith("first.");
        assertThat(copy.skippedDays()).isEqualTo(2);
    }

    @Test
    void resumeBeatsHomeworkReadingAndGeneralButOnlyOnTheFirstSkippedDay() {
        ReminderCopy first = ReminderContent.practice(
                input(1, false, true, resume(false, "그 장면에서 상대에게 가장 원하는 게 뭐였어요?"), homework("상대 눈을 보고 한 호흡 쉬고 시작해 보세요.")),
                Map.of());
        assertThat(first.kind()).isEqualTo(ReminderKind.RESUME);

        ReminderCopy second = ReminderContent.practice(
                input(2, false, true, resume(false, "그 장면에서 상대에게 가장 원하는 게 뭐였어요?"), homework("상대 눈을 보고 한 호흡 쉬고 시작해 보세요.")),
                Map.of());
        assertThat(second.kind()).isEqualTo(ReminderKind.HOMEWORK);
    }

    @Test
    void homeworkBeatsReadingAndReadingBeatsGeneral() {
        assertThat(ReminderContent.practice(input(2, false, true, null, homework("상대 눈을 보고 한 호흡 쉬고 시작해 보세요.")), Map.of()).kind())
                .isEqualTo(ReminderKind.HOMEWORK);
        assertThat(ReminderContent.practice(input(2, false, true, null, null), Map.of()).kind()).isEqualTo(ReminderKind.READING);
        assertThat(ReminderContent.practice(input(2, false, false, null, null), Map.of()).kind()).isEqualTo(ReminderKind.GENERAL);
    }

    @Test
    void resumeBodyDependsOnWhetherTheActorAnswered() {
        String question = "그 장면에서 상대에게 가장 원하는 게 뭐였어요?";
        ReminderCopy unanswered = ReminderContent.practice(input(1, false, false, resume(false, question), null), Map.of());
        assertThat(unanswered.title()).isEqualTo("아까 하던 코칭 마저 할까요?");
        assertThat(unanswered.body()).isEqualTo("코치 질문이 남아 있어요: " + question);
        ReminderCopy answered = ReminderContent.practice(input(1, false, false, resume(true, question), null), Map.of());
        assertThat(answered.body()).isEqualTo("답한 건 저장돼 있어요. 코치가 물어본 것: " + question);
        assertThat(answered.data()).containsEntry("conversation_id", CONVERSATION.toString())
                .containsEntry("practice_id", PRACTICE.toString()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "resume");
    }

    @Test
    void resumeQuestionIsCutAndUnusableQuestionDropsTheQuote() {
        ReminderCopy cut = ReminderContent.practice(
                input(1, false, false, resume(false, "이 장면에서 인물이 정말로 숨기고 싶었던 감정은 무엇이었다고 생각해요?"), null), Map.of());
        assertThat(cut.body()).startsWith("코치 질문이 남아 있어요: ").endsWith("\u2026");
        ReminderCopy plain = ReminderContent.practice(input(1, false, false, resume(true, "Why did you pause there?"), null), Map.of());
        assertThat(plain.body()).isEqualTo("답한 건 저장돼 있어요. 이어서 해 볼까요?");
        assertThat(plain.data()).containsEntry("conversation_id", CONVERSATION.toString());
    }

    @Test
    void homeworkBodyIsTheTrimmedNextTakeAndTitleComesFromTheBucket() {
        ReminderCopy copy = ReminderContent.practice(input(3, false, false, null, homework("\"사랑해\"라고 말하기 전에 숨을 한 번 들이쉬어 보세요.")), Map.of());
        assertThat(copy.kind()).isEqualTo(ReminderKind.HOMEWORK);
        assertThat(copy.body()).isEqualTo("말하기 전에 숨을 한 번 들이쉬어 보세요.");
        assertThat(copy.templateId()).startsWith("homework.2.");
        assertThat(copy.data()).containsEntry("practice_id", PRACTICE.toString()).doesNotContainKey("conversation_id");
        ReminderCopy fallback = ReminderContent.practice(input(5, false, false, null, homework("Breathe first.")), Map.of());
        assertThat(fallback.body()).isEqualTo("노트에 남긴 한 가지만 해 봐도 충분해요.");
        assertThat(fallback.templateId()).startsWith("homework.4.");
    }

    @Test
    void skippedDayBucketsPickTheMatchingGeneralSet() {
        assertThat(ReminderContent.practice(input(1, false, false, null, null), Map.of()).templateId()).startsWith("general.1.");
        assertThat(ReminderContent.practice(input(2, false, false, null, null), Map.of()).templateId()).startsWith("general.2.");
        assertThat(ReminderContent.practice(input(3, false, false, null, null), Map.of()).templateId()).startsWith("general.2.");
        assertThat(ReminderContent.practice(input(4, false, false, null, null), Map.of()).templateId()).startsWith("general.4.");
        assertThat(ReminderContent.practice(input(7, false, false, null, null), Map.of()).templateId()).startsWith("general.4.");
    }

    @Test
    void dataCarriesKindSkippedDaysAndTemplateId() {
        ReminderCopy copy = ReminderContent.practice(input(2, false, true, null, null), Map.of());
        assertThat(copy.data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "reading").containsEntry("skipped_days", "2")
                .containsEntry("template_id", copy.templateId()).doesNotContainKeys("conversation_id", "practice_id");
    }

    @Test
    void streakTitleAndBodyCarryTheCount() {
        ReminderCopy copy = ReminderContent.streak(USER, TODAY, 5, true, Map.of());
        assertThat(copy.kind()).isEqualTo(ReminderKind.STREAK);
        assertThat(copy.title() + copy.body()).contains("5").doesNotContain("{n}");
        assertThat(copy.data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "streak").containsEntry("skipped_days", "0");
    }

    @Test
    void englishLocaleUsesTheEnglishSet() {
        PracticeInput english = new PracticeInput(USER, TODAY, 2, false, false, null, null, false);
        ReminderCopy copy = ReminderContent.practice(english, Map.of());
        assertThat(copy.templateId()).startsWith("general.en.");
        assertThat(copy.title()).matches("[\\x00-\\x7F]+");
        ReminderCopy streak = ReminderContent.streak(USER, TODAY, 3, false, Map.of());
        assertThat(streak.title() + streak.body()).contains("3").doesNotContain("{n}").matches("[\\x00-\\x7F]+");
    }

    // ── 돌려쓰기

    @Test
    void rotationAvoidsTemplatesSentInTheLastFourteenDays() {
        List<Template> pool = ReminderTemplates.GENERAL_1_KO;
        Map<String, LocalDate> used = new LinkedHashMap<>();
        Set<String> picked = new HashSet<>();
        // 하루씩 보내면서 쓴 것을 기록하면 7개를 다 쓸 때까지 겹치지 않는다
        for (int i = 0; i < pool.size(); i++) {
            LocalDate day = TODAY.plusDays(i);
            Template t = ReminderContent.pick(pool, USER, day, "practice", used);
            assertThat(picked.add(t.id())).as("%s 가 다시 나왔다", t.id()).isTrue();
            used.put(t.id(), day);
        }
        assertThat(picked).hasSize(pool.size());
    }

    @Test
    void templateUsedExactlyFourteenDaysAgoIsAllowedAgainButThirteenIsNot() {
        List<Template> pool = ReminderTemplates.GENERAL_1_KO;
        Map<String, LocalDate> used = new LinkedHashMap<>();
        for (Template t : pool) used.put(t.id(), TODAY.minusDays(13));
        used.put(pool.get(3).id(), TODAY.minusDays(14));
        assertThat(ReminderContent.pick(pool, USER, TODAY, "practice", used).id()).isEqualTo(pool.get(3).id());
    }

    @Test
    void whenEverythingWasUsedTheLeastRecentlyUsedIsPicked() {
        List<Template> pool = ReminderTemplates.GENERAL_1_KO;
        Map<String, LocalDate> used = new LinkedHashMap<>();
        for (int i = 0; i < pool.size(); i++) used.put(pool.get(i).id(), TODAY.minusDays(1 + i));
        // 가장 오래전: 마지막 문구(7일 전)
        assertThat(ReminderContent.pick(pool, USER, TODAY, "practice", used).id()).isEqualTo(pool.getLast().id());
    }

    @Test
    void pickIsDeterministicForTheSameUserAndDay() {
        List<Template> pool = ReminderTemplates.GENERAL_2_3_KO;
        Template first = ReminderContent.pick(pool, USER, TODAY, "practice", Map.of());
        for (int i = 0; i < 5; i++) assertThat(ReminderContent.pick(pool, USER, TODAY, "practice", Map.of())).isEqualTo(first);
        // 사람이나 날이 바뀌면 고르는 문구도 흩어진다
        Set<String> across = new HashSet<>();
        for (int d = 0; d < 20; d++) across.add(ReminderContent.pick(pool, USER, TODAY.plusDays(d), "practice", Map.of()).id());
        assertThat(across.size()).isGreaterThan(1);
    }

    // ── 문구 목록 점검

    private static Stream<List<Template>> koreanPools() {
        return Stream.of(ReminderTemplates.GENERAL_1_KO, ReminderTemplates.GENERAL_2_3_KO, ReminderTemplates.GENERAL_4_7_KO,
                ReminderTemplates.HOMEWORK_1_KO, ReminderTemplates.HOMEWORK_2_3_KO, ReminderTemplates.HOMEWORK_4_7_KO,
                ReminderTemplates.READING_KO, ReminderTemplates.FIRST_PRACTICE_KO, ReminderTemplates.FIRST_NUDGE_KO, ReminderTemplates.STREAK_KO);
    }

    /** 승인된 문구 그대로 세 개씩인 새 종류. 5~10개 규칙에서는 빼고 길이·금지어만 점검한다. */
    private static Stream<List<Template>> pendingPools() {
        return Stream.of(ReminderTemplates.VIDEO_KO, ReminderTemplates.SCRIPT_KO);
    }

    @Test
    void pendingCopyIsShortAndHasNoPromotionOrWorkNames() {
        pendingPools().flatMap(List::stream).forEach(t -> {
            assertThat(t.title().length()).as(t.id()).isLessThanOrEqualTo(30);
            assertThat(t.body().length()).as(t.id()).isLessThanOrEqualTo(45);
            assertThat(t.title() + t.body()).as(t.id()).doesNotContain("{", "}").doesNotContain("이벤트", "할인", "혜택", "광고");
        });
    }

    @Test
    void everyKoreanSetHasFiveToTenTemplates() {
        koreanPools().forEach(pool -> assertThat(pool.size()).isBetween(5, 10));
    }

    @Test
    void templateIdsAreUniqueAndStable() {
        List<Template> all = Stream.concat(Stream.concat(koreanPools(), pendingPools()).flatMap(List::stream),
                Stream.of(ReminderTemplates.GENERAL_EN, ReminderTemplates.HOMEWORK_EN, ReminderTemplates.READING_EN,
                        ReminderTemplates.FIRST_PRACTICE_EN, ReminderTemplates.FIRST_NUDGE_EN, ReminderTemplates.STREAK_EN,
                        ReminderTemplates.VIDEO_EN, ReminderTemplates.SCRIPT_EN).flatMap(List::stream)).toList();
        assertThat(all).extracting(Template::id).doesNotHaveDuplicates();
        assertThat(ReminderTemplates.GENERAL_1_KO.getFirst().id()).isEqualTo("general.1.a");
        assertThat(ReminderTemplates.GENERAL_1_KO.getFirst().title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(ReminderTemplates.GENERAL_1_KO.getFirst().body()).isEqualTo("5분이면 돼요. 장면 하나 찍거나 대본 한 번 읽어 볼까요?");
    }

    @Test
    void copyIsShortAndHasNoPromotionOrUnknownPlaceholders() {
        koreanPools().flatMap(List::stream).forEach(t -> {
            assertThat(t.title().length()).as(t.id()).isLessThanOrEqualTo(30);
            assertThat(t.body().length()).as(t.id()).isLessThanOrEqualTo(45);
            String text = (t.title() + t.body()).replace("{n}", "").replace("{take}", "");
            assertThat(text).as(t.id()).doesNotContain("{", "}").doesNotContain("이벤트", "할인", "혜택", "광고");
        });
        // 숙제 문구는 제목만 돌리고 본문은 {take} 하나다
        Stream.of(ReminderTemplates.HOMEWORK_1_KO, ReminderTemplates.HOMEWORK_2_3_KO, ReminderTemplates.HOMEWORK_4_7_KO)
                .flatMap(List::stream).forEach(t -> assertThat(t.body()).isEqualTo("{take}"));
    }

    private static final UUID VIDEO = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
    private static final UUID SCRIPT = UUID.fromString("00000000-0000-0000-0000-0000000000e1");

    private static PracticeInput pending(int k, boolean never, UUID video, UUID script, Map<String, Integer> sent, Homework homework) {
        return new PracticeInput(USER, TODAY, k, never, true, null, homework, true, video, script, sent);
    }

    @Test
    void pendingVideoAndUnreadScriptFollowResumeAndPrecedeEverythingElse() {
        Homework hw = homework("상대 눈을 보고 한 호흡 쉬고 시작해 보세요.");
        // resume(k=1) 이 가장 앞이다
        PracticeInput withResume = new PracticeInput(USER, TODAY, 1, false, true, resume(false, "그 장면에서 상대에게 가장 원하는 게 뭐였어요?"),
                hw, true, VIDEO, SCRIPT, Map.of());
        assertThat(ReminderContent.practice(withResume, Map.of()).kind()).isEqualTo(ReminderKind.RESUME);
        // k=2 면 영상 → 대본 → 숙제 → 리딩 순이다
        assertThat(ReminderContent.practice(pending(2, false, VIDEO, SCRIPT, Map.of(), hw), Map.of()).kind()).isEqualTo(ReminderKind.PENDING_VIDEO);
        assertThat(ReminderContent.practice(pending(2, false, null, SCRIPT, Map.of(), hw), Map.of()).kind()).isEqualTo(ReminderKind.UNREAD_SCRIPT);
        assertThat(ReminderContent.practice(pending(2, false, null, null, Map.of(), hw), Map.of()).kind()).isEqualTo(ReminderKind.HOMEWORK);
        assertThat(ReminderContent.practice(pending(2, false, null, null, Map.of(), null), Map.of()).kind()).isEqualTo(ReminderKind.READING);
    }

    @Test
    void unreadScriptBeatsFirstPracticeForSignupWhoOnlyAddedAScript() {
        ReminderCopy copy = ReminderContent.practice(pending(2, true, null, SCRIPT, Map.of(), null), Map.of());
        assertThat(copy.kind()).isEqualTo(ReminderKind.UNREAD_SCRIPT);
        assertThat(ReminderContent.practice(pending(2, true, null, null, Map.of(), null), Map.of()).kind()).isEqualTo(ReminderKind.FIRST_PRACTICE);
    }

    @Test
    void pendingKindsCarryTheirIdInDataAndKeepTheLegacyKind() {
        Map<String, String> video = ReminderContent.practice(pending(2, false, VIDEO, SCRIPT, Map.of(), null), Map.of()).data();
        assertThat(video).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "pending_video")
                .containsEntry("video_id", VIDEO.toString()).doesNotContainKey("script_id");
        Map<String, String> script = ReminderContent.practice(pending(2, false, null, SCRIPT, Map.of(), null), Map.of()).data();
        assertThat(script).containsEntry("reminder_kind", "unread_script").containsEntry("script_id", SCRIPT.toString())
                .doesNotContainKey("video_id");
    }

    @Test
    void aKindSentTwiceInSevenDaysMovesOnToTheNextKind() {
        Homework hw = homework("상대 눈을 보고 한 호흡 쉬고 시작해 보세요.");
        assertThat(ReminderContent.practice(pending(3, false, VIDEO, SCRIPT, Map.of("pending_video", 1), hw), Map.of()).kind())
                .isEqualTo(ReminderKind.PENDING_VIDEO);
        assertThat(ReminderContent.practice(pending(3, false, VIDEO, SCRIPT, Map.of("pending_video", 2), hw), Map.of()).kind())
                .isEqualTo(ReminderKind.UNREAD_SCRIPT);
        assertThat(ReminderContent.practice(pending(3, false, VIDEO, SCRIPT, Map.of("pending_video", 2, "unread_script", 2), hw), Map.of()).kind())
                .isEqualTo(ReminderKind.HOMEWORK);
        assertThat(ReminderContent.practice(pending(3, true, null, SCRIPT, Map.of("unread_script", 2), null), Map.of()).kind())
                .isEqualTo(ReminderKind.FIRST_PRACTICE);
    }

    @Test
    void aKindWithNoFreshTemplateInFourteenDaysIsSkipped() {
        Map<String, LocalDate> allVideoUsed = Map.of("video.a", TODAY.minusDays(3), "video.b", TODAY.minusDays(5), "video.c", TODAY.minusDays(6));
        assertThat(ReminderContent.practice(pending(3, false, VIDEO, SCRIPT, Map.of(), null), allVideoUsed).kind())
                .isEqualTo(ReminderKind.UNREAD_SCRIPT);
        Map<String, LocalDate> oneFree = Map.of("video.a", TODAY.minusDays(3), "video.b", TODAY.minusDays(5));
        ReminderCopy copy = ReminderContent.practice(pending(3, false, VIDEO, SCRIPT, Map.of(), null), oneFree);
        assertThat(copy.kind()).isEqualTo(ReminderKind.PENDING_VIDEO);
        assertThat(copy.templateId()).isEqualTo("video.c");
    }

    @Test
    void pendingCopyIsExactlyTheApprovedWordingAndEnglishIsAvailable() {
        assertThat(ReminderTemplates.VIDEO_KO).extracting(Template::id, Template::title, Template::body).containsExactly(
                org.assertj.core.groups.Tuple.tuple("video.a", "올려 둔 영상이 그대로 있어요", "코치에게 보여 주면 첫 질문부터 시작해요."),
                org.assertj.core.groups.Tuple.tuple("video.b", "찍어 둔 연기, 코치가 아직 못 봤어요", "이미 찍었으니 대화만 시작하면 돼요."),
                org.assertj.core.groups.Tuple.tuple("video.c", "영상은 이미 올라와 있어요", "코치가 어떤 질문을 할지 들어 보세요."));
        assertThat(ReminderTemplates.SCRIPT_KO).extracting(Template::id, Template::title, Template::body).containsExactly(
                org.assertj.core.groups.Tuple.tuple("script.a", "넣어 둔 대본, 상대역이 기다려요", "상대 대사는 AI가 읽어 줘요. 내 대사만 읽으면 돼요."),
                org.assertj.core.groups.Tuple.tuple("script.b", "대본은 준비돼 있어요", "배역만 고르면 바로 맞춰 읽을 수 있어요."),
                org.assertj.core.groups.Tuple.tuple("script.c", "넣어 둔 대본으로 바로 리딩할 수 있어요", "처음부터 다 안 읽어도 돼요. 한 장면만 맞춰 봐요."));
        assertThat(ReminderTemplates.VIDEO_EN).singleElement().satisfies(t -> {
            assertThat(t.id()).isEqualTo("video.en.a");
            assertThat(t.title()).isEqualTo("Your video is still waiting");
            assertThat(t.body()).isEqualTo("Show it to the coach and start with the first question.");
        });
        assertThat(ReminderTemplates.SCRIPT_EN).singleElement().satisfies(t -> {
            assertThat(t.id()).isEqualTo("script.en.a");
            assertThat(t.title()).isEqualTo("Your script is ready");
            assertThat(t.body()).isEqualTo("The AI reads the other parts. You only read yours.");
        });
        PracticeInput english = new PracticeInput(USER, TODAY, 2, false, false, null, null, false, VIDEO, null, Map.of());
        assertThat(ReminderContent.practice(english, Map.of()).templateId()).isEqualTo("video.en.a");
    }

    // ── 실기(exam, SOMA-864)
    private static PracticeInput exam(int k, boolean never, boolean reading, Homework homework, boolean examPrep, LocalDate examDate, boolean korean) {
        return new PracticeInput(USER, TODAY, k, never, reading, null, homework, korean, null, null, Map.of(), examPrep, examDate);
    }

    @Test
    void examReplacesGeneralReadingAndFirstPracticeInsideThirtyDays() {
        LocalDate in10 = TODAY.plusDays(10);
        for (boolean[] c : new boolean[][] {{false, false}, {false, true}, {true, false}}) {
            ReminderCopy copy = ReminderContent.practice(exam(2, c[0], c[1], null, true, in10, true), Map.of());
            assertThat(copy.kind()).isEqualTo(ReminderKind.EXAM);
            assertThat(copy.kind().wire()).isEqualTo("exam");
            assertThat(copy.kind().slot()).isEqualTo("practice");
            assertThat(copy.title()).isEqualTo("실기까지 D-10");
            assertThat(copy.templateId()).startsWith("exam.");
            assertThat(copy.data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "exam");
        }
    }

    @Test
    void examBoundariesAreTodayThroughThirtyDays() {
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY.plusDays(30), true), Map.of()).title())
                .isEqualTo("실기까지 D-30");
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY.plusDays(31), true), Map.of()).kind())
                .isEqualTo(ReminderKind.GENERAL);
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY.minusDays(1), true), Map.of()).kind())
                .isEqualTo(ReminderKind.GENERAL);
        ReminderCopy today = ReminderContent.practice(exam(2, false, false, null, true, TODAY, true), Map.of());
        assertThat(today.kind()).isEqualTo(ReminderKind.EXAM);
        assertThat(today.title()).isEqualTo("오늘 실기예요");
    }

    @Test
    void examIsIgnoredWithoutExamPrepOrDateAndDoesNotBeatOtherKinds() {
        LocalDate in5 = TODAY.plusDays(5);
        assertThat(ReminderContent.practice(exam(2, false, true, null, false, in5, true), Map.of()).kind()).isEqualTo(ReminderKind.READING);
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, null, true), Map.of()).kind()).isEqualTo(ReminderKind.GENERAL);
        assertThat(ReminderContent.practice(exam(2, true, false, null, false, in5, true), Map.of()).kind()).isEqualTo(ReminderKind.FIRST_PRACTICE);
        assertThat(ReminderContent.practice(exam(2, false, false, homework("목소리를 낮춰서 한 번 더 해 보기"), true, in5, true), Map.of()).kind())
                .isEqualTo(ReminderKind.HOMEWORK);
        PracticeInput withResume = new PracticeInput(USER, TODAY, 1, false, false, resume(true, "어떤 마음이었어요?"), null, true,
                null, null, Map.of(), true, in5);
        assertThat(ReminderContent.practice(withResume, Map.of()).kind()).isEqualTo(ReminderKind.RESUME);
    }

    @Test
    void examEnglishTitles() {
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY.plusDays(7), false), Map.of()).title())
                .isEqualTo("7 days to your exam");
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY.plusDays(1), false), Map.of()).title())
                .isEqualTo("Your exam is tomorrow");
        assertThat(ReminderContent.practice(exam(2, false, false, null, true, TODAY, false), Map.of()).title())
                .isEqualTo("Your exam is today");
    }
}
