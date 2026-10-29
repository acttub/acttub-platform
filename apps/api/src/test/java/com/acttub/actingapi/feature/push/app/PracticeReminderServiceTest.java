package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 10분마다 도는 연습 알림: 하루 한 번씩 두 칸, 연습하면 처음부터, 7일 뒤엔 멈춤 (account.notification). */
class PracticeReminderServiceTest {
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-0000000000a2");

    private static Instant kst(String dateTime) {
        return LocalDateTime.parse(dateTime).atZone(PracticeReminderPolicy.SEOUL).toInstant();
    }

    /** 메모리 저장소. 회원 상태를 직접 적어 두고, 보낸 기록(선점)을 쌓는다. */
    static class FakeRepo implements PracticeReminderRepository {
        record State(UUID userId, List<PushTarget> targets, Instant first, LocalDate lastDay, boolean never,
                     boolean reading, boolean practicedToday, Set<LocalDate> counted) {}

        final List<State> states = new ArrayList<>();
        final Set<String> claims = new HashSet<>();
        final List<ReminderCopy> claimedCopies = new ArrayList<>();
        ReminderContent.Resume resume;
        ReminderContent.Homework homework;
        Map<String, LocalDate> recent = new HashMap<>();
        UUID pendingVideo;
        UUID unreadScript;
        /** 보낸 기록(day, kind) — sentCountsByKind 가 센다. */
        final List<Map.Entry<LocalDate, String>> sendLog = new ArrayList<>();
        int claimCalls;
        boolean failCandidates;

        State add(UUID id, String practiceAt, boolean reading, Set<LocalDate> counted) {
            Instant first = kst(practiceAt);
            State s = new State(id, List.of(new PushTarget("tok-" + id, "ko")), first, PracticeReminderPolicy.kstDate(first),
                    false, reading, false, counted);
            states.add(s);
            return s;
        }

        @Override
        public List<Candidate> candidates(LocalDate today, Instant windowStart, String minimumAppVersion) {
            if (failCandidates) throw new IllegalStateException("db down");
            List<Candidate> out = new ArrayList<>();
            for (State s : states) {
                Set<String> sent = new HashSet<>();
                for (String slot : List.of("practice", "streak")) if (claims.contains(s.userId() + "|" + today + "|" + slot)) sent.add(slot);
                out.add(new Candidate(s.userId(), s.targets(), s.first(), s.lastDay(), s.never(), s.reading(),
                        s.practicedToday() || (!s.never() && s.lastDay().equals(today)), sent));
            }
            return out;
        }

        @Override public Set<LocalDate> countedPracticeDays(UUID userId, LocalDate since) {
            return states.stream().filter(s -> s.userId().equals(userId)).findFirst().orElseThrow().counted();
        }
        @Override public ReminderContent.Resume latestOpenQuestion(UUID userId) { return resume; }
        @Override public ReminderContent.Homework latestHomework(UUID userId) { return homework; }
        @Override public UUID latestPendingVideo(UUID userId, Instant since) { return pendingVideo; }
        @Override public UUID latestUnreadScript(UUID userId, Instant since) { return unreadScript; }
        @Override public Map<String, Integer> sentCountsByKind(UUID userId, LocalDate since) {
            Map<String, Integer> counts = new HashMap<>();
            for (Map.Entry<LocalDate, String> e : sendLog) if (!e.getKey().isBefore(since)) counts.merge(e.getValue(), 1, Integer::sum);
            return counts;
        }
        @Override public Map<String, LocalDate> recentTemplates(UUID userId, LocalDate since) { return recent; }
        @Override public boolean claim(UUID userId, LocalDate day, ReminderCopy copy) {
            claimCalls++;
            boolean added = claims.add(userId + "|" + day + "|" + copy.kind().slot());
            if (added) { claimedCopies.add(copy); sendLog.add(Map.entry(day, copy.kind().wire())); }
            return added;
        }
    }

    private final FakeRepo repo = new FakeRepo();
    private final List<PushMessage> sent = new ArrayList<>();
    private final List<String> unregistered = new ArrayList<>();
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private List<String> deadTokens = List.of();
    private int holdoutPercent = 0;

    private static PushTokenRepository noTokens() {
        return new PushTokenRepository() {
            @Override public void register(UUID userId, String token, String platform, String appVersion) { throw new AssertionError(); }
            @Override public void unregister(String token) { }
            @Override public List<PushTarget> analysisDoneTargets(UUID sessionId) { return List.of(); }
        };
    }

    private void run(String nowKst) {
        Clock clock = Clock.fixed(kst(nowKst), ZoneOffset.UTC);
        PushSender sender = messages -> { sent.addAll(messages); return deadTokens; };
        PushTokenRepository tokens = new PushTokenRepository() {
            @Override public void register(UUID userId, String token, String platform, String appVersion) { throw new AssertionError(); }
            @Override public void unregister(String token) { unregistered.add(token); }
            @Override public List<PushTarget> analysisDoneTargets(UUID sessionId) { return List.of(); }
        };
        new PracticeReminderService(repo, tokens, sender, failures, clock, "0.1.2", holdoutPercent).sendDue();
    }

    private static Set<LocalDate> days(int... daysAgoFrom20211021) {
        Set<LocalDate> out = new HashSet<>();
        for (int d : daysAgoFrom20211021) out.add(LocalDate.of(2026, 10, 21).minusDays(d));
        return out;
    }

    @Test
    void sendsOnePracticeReminderOnceDueAndNeverTwiceOnTheSameDay() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-21T19:20");
        assertThat(sent).isEmpty();
        run("2026-10-21T19:30");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "general").containsEntry("skipped_days", "1");
        run("2026-10-21T19:40");
        run("2026-10-21T21:00");
        assertThat(sent).hasSize(1);
        assertThat(repo.claims).hasSize(1);
    }

    @Test
    void sendsAgainTheNextDayWithTheNextSkippedCount() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-21T19:30");
        run("2026-10-22T19:30");
        assertThat(sent).extracting(m -> m.data().get("skipped_days")).containsExactly("1", "2");
    }

    @Test
    void stopsAfterTheSeventhSkippedDay() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-27T19:30");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("skipped_days", "7");
        run("2026-10-28T12:00");
        run("2026-11-03T12:00");
        assertThat(sent).hasSize(1);
    }

    @Test
    void practicingTodayMeansNothingIsSent() {
        FakeRepo.State state = repo.add(USER, "2026-10-21T08:00", false, days(0));
        run("2026-10-21T22:30");
        assertThat(sent).isEmpty();
        assertThat(state.lastDay()).isEqualTo(LocalDate.of(2026, 10, 21));
    }

    @Test
    void practicingAgainResetsTheCountToTheNewFirstPractice() {
        FakeRepo.State old = repo.add(USER, "2026-10-10T20:00", false, days());
        run("2026-10-21T12:00");
        assertThat(sent).isEmpty();
        repo.states.clear();
        repo.add(USER, "2026-10-20T07:00", false, days());
        run("2026-10-21T12:00");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("skipped_days", "1");
        assertThat(old.lastDay()).isBefore(LocalDate.of(2026, 10, 14));
    }

    @Test
    void neverPracticedUserGetsFirstPracticeFromTheSignupTime() {
        repo.states.add(new FakeRepo.State(USER, List.of(new PushTarget("tok", "ko")), kst("2026-10-18T10:00"),
                LocalDate.of(2026, 10, 18), true, false, false, days()));
        run("2026-10-19T09:29");
        assertThat(sent).isEmpty();
        run("2026-10-19T09:30");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "first_practice").containsEntry("skipped_days", "1");
        // 7일이 지나면 가입만 한 사람에게도 더는 보내지 않는다
        sent.clear();
        run("2026-10-26T12:00");
        assertThat(sent).isEmpty();
    }

    private void addNever(String signupKst) {
        repo.states.add(new FakeRepo.State(USER, List.of(new PushTarget("tok", "ko")), kst(signupKst),
                PracticeReminderPolicy.kstDate(kst(signupKst)), true, false, false, days()));
    }

    @Test
    void signupDayNudgeGoesOnceThirtyMinutesAfterSignupThenTheUsualFirstPracticeNextDay() {
        addNever("2026-10-21T10:00");
        run("2026-10-21T10:20");
        assertThat(sent).isEmpty();
        run("2026-10-21T10:30");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "first_nudge")
                .containsEntry("skipped_days", "0");
        assertThat(sent.getFirst().data().get("template_id")).startsWith("nudge.");
        run("2026-10-21T10:40");
        run("2026-10-21T11:50");
        assertThat(sent).hasSize(1);
        run("2026-10-22T09:30");
        assertThat(sent).hasSize(2);
        assertThat(sent.get(1).data()).containsEntry("reminder_kind", "first_practice").containsEntry("skipped_days", "1");
    }

    @Test
    void signupNudgeIsSkippedWhenLateOrAtNight() {
        addNever("2026-10-21T10:00");
        run("2026-10-21T12:00");
        assertThat(sent).as("2시간이 지나면 늦었으니 보내지 않는다").isEmpty();
        repo.states.clear();
        addNever("2026-10-21T22:45");
        run("2026-10-21T23:20");
        assertThat(sent).as("밤 시간에는 보내지 않고 미루지도 않는다").isEmpty();
        assertThat(repo.claims).isEmpty();
    }

    @Test
    void holdoutGetsNothingButTheWouldBeSendIsRecordedOnce() {
        holdoutPercent = 100;
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-21T19:30");
        run("2026-10-21T19:40");
        assertThat(sent).isEmpty();
        assertThat(repo.claimedCopies).hasSize(1);
        assertThat(repo.claimedCopies.getFirst().templateId()).startsWith(ReminderCopy.HOLDOUT_PREFIX + "general.");
        assertThat(repo.claimedCopies.getFirst().kind()).isEqualTo(ReminderKind.GENERAL);
    }

    @Test
    void holdoutAlsoSkipsSignupNudge() {
        holdoutPercent = 100;
        addNever("2026-10-21T10:00");
        run("2026-10-21T10:30");
        assertThat(sent).isEmpty();
        assertThat(repo.claimedCopies).extracting(ReminderCopy::templateId).allMatch(id -> id.startsWith(ReminderCopy.HOLDOUT_PREFIX));
    }

    @Test
    void doesNotSendDuringQuietHours() {
        repo.add(USER, "2026-10-20T23:40", false, days());
        run("2026-10-21T23:30");
        run("2026-10-22T08:50");
        assertThat(sent).isEmpty();
        run("2026-10-22T09:10");
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().data()).containsEntry("skipped_days", "2");
    }

    @Test
    void streakReminderNeedsTwoDaysNoPracticeTodayAndTenPm() {
        repo.add(USER, "2026-10-20T20:00", false, days(1, 2, 3));
        run("2026-10-21T21:50");
        assertThat(sent.stream().filter(m -> "streak".equals(m.data().get("reminder_kind")))).isEmpty();
        run("2026-10-21T22:00");
        PushMessage streak = sent.stream().filter(m -> "streak".equals(m.data().get("reminder_kind"))).findFirst().orElseThrow();
        assertThat(streak.title() + streak.body()).contains("3").doesNotContain("{n}");
        assertThat(streak.data()).containsEntry("skipped_days", "0");
        run("2026-10-21T22:10");
        assertThat(sent.stream().filter(m -> "streak".equals(m.data().get("reminder_kind")))).hasSize(1);
    }

    @Test
    void streakOfOneOrBrokenStreakOrCountedPracticeTodayDoesNotSend() {
        repo.add(USER, "2026-10-20T20:00", false, days(1));
        repo.add(OTHER, "2026-10-19T20:00", false, days(2, 3, 4));
        run("2026-10-21T22:00");
        assertThat(sent.stream().filter(m -> "streak".equals(m.data().get("reminder_kind")))).isEmpty();
        // 오늘 이미 센 연습(예: 올린 참여작)이 있으면 연속이 안전하다
        repo.states.clear();
        repo.add(USER, "2026-10-20T20:00", false, days(0, 1, 2));
        run("2026-10-21T22:10");
        assertThat(sent.stream().filter(m -> "streak".equals(m.data().get("reminder_kind")))).isEmpty();
    }

    @Test
    void atMostTwoPushesPerDayOnePracticeAndOneStreak() {
        repo.add(USER, "2026-10-20T20:00", false, days(1, 2));
        for (String t : List.of("2026-10-21T19:30", "2026-10-21T19:40", "2026-10-21T22:00", "2026-10-21T22:10", "2026-10-21T22:50")) run(t);
        assertThat(sent).hasSize(2);
        assertThat(sent).extracting(m -> m.data().get("reminder_kind")).containsExactlyInAnyOrder("general", "streak");
        assertThat(repo.claims).hasSize(2);
    }

    @Test
    void streakReminderIsNotSentAfterElevenPm() {
        repo.add(USER, "2026-10-20T20:00", false, days(1, 2));
        run("2026-10-21T23:10");
        assertThat(sent).isEmpty();
    }

    @Test
    void resumeOnTheFirstSkippedDayCarriesTheConversation() {
        UUID conversation = UUID.randomUUID();
        repo.resume = new ReminderContent.Resume(conversation, UUID.randomUUID(), false, "그 장면에서 상대에게 가장 원하는 게 뭐였어요?", List.of());
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-21T19:30");
        assertThat(sent.getFirst().title()).isEqualTo("아까 하던 코칭 마저 할까요?");
        assertThat(sent.getFirst().data()).containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "resume").containsEntry("conversation_id", conversation.toString());
        // 둘째 날부터는 열린 코칭이 있어도 resume 이 아니다
        run("2026-10-22T19:30");
        assertThat(sent.getLast().data().get("reminder_kind")).isNotEqualTo("resume");
    }

    @Test
    void recentlySentTemplatesAreAvoided() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        repo.recent = new HashMap<>();
        // 오늘 후보 가운데 하나만 빼고 모두 최근에 보낸 것으로 한다
        for (var t : ReminderTemplates.GENERAL_1_KO) repo.recent.put(t.id(), LocalDate.of(2026, 10, 15));
        repo.recent.remove("general.1.e");
        run("2026-10-21T19:30");
        assertThat(sent.getFirst().data()).containsEntry("template_id", "general.1.e");
    }

    @Test
    void sendsToEveryDeviceWithItsOwnLanguageButClaimsOnce() {
        repo.states.add(new FakeRepo.State(USER, List.of(new PushTarget("tok-ko", "ko"), new PushTarget("tok-en", "en")),
                kst("2026-10-20T20:00"), LocalDate.of(2026, 10, 20), false, false, false, days()));
        run("2026-10-21T19:30");
        assertThat(sent).hasSize(2);
        assertThat(sent.get(0).to()).isEqualTo("tok-ko");
        assertThat(sent.get(0).title()).matches(".*[가-힣].*");
        assertThat(sent.get(1).to()).isEqualTo("tok-en");
        assertThat(sent.get(1).title()).matches("[\\x00-\\x7F]+");
        assertThat(repo.claimCalls).isEqualTo(1);
    }

    @Test
    void deadTokensAreUnregistered() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        deadTokens = List.of("tok-" + USER);
        run("2026-10-21T19:30");
        assertThat(unregistered).containsExactly("tok-" + USER);
    }

    @Test
    void lostClaimMeansNothingIsSent() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        repo.claims.add(USER + "|2026-10-21|practice"); // 다른 인스턴스가 먼저 선점
        // candidates 는 선점 기록을 보고 건너뛰지만, 읽은 뒤 선점이 일어난 경쟁을 흉내 낸다
        FakeRepo racing = new FakeRepo() {
            @Override public boolean claim(UUID userId, LocalDate day, ReminderCopy copy) { claimCalls++; return false; }
        };
        racing.states.addAll(repo.states);
        Clock clock = Clock.fixed(kst("2026-10-21T19:30"), ZoneOffset.UTC);
        new PracticeReminderService(racing, noTokens(), messages -> { sent.addAll(messages); return List.of(); }, failures, clock, "0.1.2", 0).sendDue();
        assertThat(racing.claimCalls).isEqualTo(1);
        assertThat(sent).isEmpty();
    }

    @Test
    void repositoryFailureIsReportedAndDoesNotEscape() {
        repo.failCandidates = true;
        run("2026-10-21T19:30");
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).hasMessage("db down");
            assertThat(report.context()).isEqualTo("PracticeReminderService.sendDue");
        });
    }

    @Test
    void oneUsersFailureDoesNotStopTheOthers() {
        repo.add(USER, "2026-10-20T20:00", false, days());
        repo.add(OTHER, "2026-10-20T20:00", false, days());
        FakeRepo flaky = new FakeRepo() {
            @Override public Map<String, LocalDate> recentTemplates(UUID userId, LocalDate since) {
                if (userId.equals(USER)) throw new IllegalStateException("bad row");
                return super.recentTemplates(userId, since);
            }
        };
        flaky.states.addAll(repo.states);
        Clock clock = Clock.fixed(kst("2026-10-21T19:30"), ZoneOffset.UTC);
        new PracticeReminderService(flaky, noTokens(), messages -> { sent.addAll(messages); return List.of(); }, failures, clock, "0.1.2", 0).sendDue();
        assertThat(sent).extracting(PushMessage::to).containsExactly("tok-" + OTHER);
        assertThat(failures.reports()).hasSize(1);
    }

    @Test
    void pendingVideoCarriesVideoIdAndGoesBeforeHomeworkAndReading() {
        UUID video = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
        repo.pendingVideo = video;
        repo.add(USER, "2026-10-20T20:00", true, days());
        run("2026-10-21T19:30");
        assertThat(sent).singleElement().satisfies(m -> assertThat(m.data())
                .containsEntry("kind", "evening_reminder").containsEntry("reminder_kind", "pending_video")
                .containsEntry("video_id", video.toString()).doesNotContainKey("script_id"));
    }

    @Test
    void unreadScriptCarriesScriptIdAndOutranksFirstPracticeForSignupWhoNeverPracticed() {
        UUID script = UUID.fromString("00000000-0000-0000-0000-0000000000e1");
        repo.unreadScript = script;
        repo.states.add(new FakeRepo.State(USER, List.of(new PushTarget("tok-" + USER, "ko")), kst("2026-10-20T20:00"),
                LocalDate.of(2026, 10, 20), true, false, false, days()));
        run("2026-10-21T19:30");
        assertThat(sent).singleElement().satisfies(m -> assertThat(m.data())
                .containsEntry("reminder_kind", "unread_script").containsEntry("script_id", script.toString()));
    }

    @Test
    void sameKindIsSentAtMostTwiceInSevenDaysThenTheNextKindIsUsed() {
        repo.pendingVideo = UUID.fromString("00000000-0000-0000-0000-0000000000d1");
        repo.unreadScript = UUID.fromString("00000000-0000-0000-0000-0000000000e1");
        repo.add(USER, "2026-10-20T20:00", false, days());
        run("2026-10-21T19:30");
        run("2026-10-22T19:30");
        run("2026-10-23T19:30");
        run("2026-10-24T19:30");
        run("2026-10-25T19:30");
        assertThat(sent).extracting(m -> m.data().get("reminder_kind"))
                .containsExactly("pending_video", "pending_video", "unread_script", "unread_script", "general");
    }
}
