package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 연습 알림의 시각 규칙 — 모두 한국 시간 (account.notification). */
class PracticeReminderPolicyTest {
    private static Instant kst(String dateTime) {
        return java.time.LocalDateTime.parse(dateTime).atZone(PracticeReminderPolicy.SEOUL).toInstant();
    }

    private static String kstText(Instant instant) {
        return instant.atZone(PracticeReminderPolicy.SEOUL).toLocalDateTime().toString();
    }

    @Test
    @DisplayName("보낼 시각은 첫 연습 + 23.5시간 + (k-1)일이다")
    void dueIsFirstPracticePlus23HoursThirtyMinutesPlusWholeDays() {
        Instant first = kst("2026-10-20T20:00");
        assertThat(kstText(PracticeReminderPolicy.dueAt(first, 1))).isEqualTo("2026-10-21T19:30");
        assertThat(kstText(PracticeReminderPolicy.dueAt(first, 2))).isEqualTo("2026-10-22T19:30");
        assertThat(kstText(PracticeReminderPolicy.dueAt(first, 7))).isEqualTo("2026-10-27T19:30");
    }

    @Test
    @DisplayName("23시~9시에 걸리면 그다음 9시로 민다")
    void quietHoursPushToNextNineAm() {
        // 23:40 에 연습 → 다음 날 23:10 → 다다음 날 09:00
        assertThat(kstText(PracticeReminderPolicy.dueAt(kst("2026-10-20T23:40"), 1))).isEqualTo("2026-10-22T09:00");
        // 정확히 23:00 도 민다
        assertThat(kstText(PracticeReminderPolicy.dueAt(kst("2026-10-20T23:30"), 1))).isEqualTo("2026-10-22T09:00");
        // 01:00 에 연습 → 다음 날 00:30 → 같은 날 09:00
        assertThat(kstText(PracticeReminderPolicy.dueAt(kst("2026-10-20T01:00"), 1))).isEqualTo("2026-10-21T09:00");
        // 09:30 에 연습 → 다음 날 09:00 은 그대로(경계 포함)
        assertThat(kstText(PracticeReminderPolicy.dueAt(kst("2026-10-20T09:30"), 1))).isEqualTo("2026-10-21T09:00");
        // 22:59 는 밀지 않는다
        assertThat(kstText(PracticeReminderPolicy.dueAt(kst("2026-10-20T23:29"), 1))).isEqualTo("2026-10-21T22:59");
    }

    @Test
    @DisplayName("k 는 1~7 만 받는다")
    void kOutOfRangeIsRejected() {
        Instant first = kst("2026-10-20T20:00");
        assertThatThrownBy(() -> PracticeReminderPolicy.dueAt(first, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PracticeReminderPolicy.dueAt(first, 8)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("예정 시각 전에는 보내지 않고, 이후에는 k 를 돌려준다")
    void practiceDueOnlyAfterDueTime() {
        Instant first = kst("2026-10-20T20:00");
        LocalDate lastDay = LocalDate.of(2026, 10, 20);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T19:29"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T19:30"), first, lastDay)).contains(1);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T22:59"), first, lastDay)).contains(1);
    }

    @Test
    @DisplayName("k 는 한국 날짜 차이다: 자정을 넘기면 k 가 하나 는다")
    void kCountsKoreanCalendarDays() {
        Instant first = kst("2026-10-20T20:00");
        LocalDate lastDay = LocalDate.of(2026, 10, 20);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T19:30"), first, lastDay)).contains(2);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T19:29"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-27T19:30"), first, lastDay)).contains(7);
    }

    @Test
    @DisplayName("7일이 지나면 다시 연습할 때까지 보내지 않는다")
    void nothingAfterSeventhDay() {
        Instant first = kst("2026-10-20T20:00");
        LocalDate lastDay = LocalDate.of(2026, 10, 20);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-28T12:00"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-11-20T12:00"), first, lastDay)).isEmpty();
    }

    @Test
    @DisplayName("오늘 연습했다면(오늘이 D) 보내지 않는다 — 연습하면 처음부터 다시다")
    void practicingTodayResetsEverything() {
        Instant first = kst("2026-10-21T08:00");
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T22:00"), first, LocalDate.of(2026, 10, 21))).isEmpty();
    }

    @Test
    @DisplayName("새로 연습하면 D·F 가 바뀌어 k 가 1 부터 다시 센다")
    void newPracticeRestartsTheCount() {
        Instant oldFirst = kst("2026-10-10T20:00");
        Instant newFirst = kst("2026-10-20T07:00");
        Instant now = kst("2026-10-21T12:00");
        assertThat(PracticeReminderPolicy.practiceDue(now, oldFirst, LocalDate.of(2026, 10, 10))).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(now, newFirst, LocalDate.of(2026, 10, 20))).contains(1);
    }

    @Test
    @DisplayName("보내는 순간이 밤 시간이면 보내지 않는다")
    void doesNotSendInQuietHours() {
        Instant first = kst("2026-10-20T10:00");
        LocalDate lastDay = LocalDate.of(2026, 10, 20);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T23:05"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T08:59"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T09:00"), first, lastDay)).isEmpty();
        Optional<Integer> morning = PracticeReminderPolicy.practiceDue(kst("2026-10-22T09:30"), first, lastDay);
        assertThat(morning).contains(2);
    }

    @Test
    @DisplayName("F 가 23:30 이후라 보낼 시각이 하루 밀리면 밀린 날짜에 보낸다 — 매일 한 번, 7일 안에서")
    void lateNightFirstPracticeStillGetsOneReminderPerDay() {
        Instant first = kst("2026-10-20T23:40");
        LocalDate lastDay = LocalDate.of(2026, 10, 20);
        // 다음 날(k=1)은 밤이라 없다
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T12:00"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T23:30"), first, lastDay)).isEmpty();
        // 그다음 날 아침 9시에 1번째 알림이 가고 오늘 기준 k=2 이다
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T08:59"), first, lastDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-22T09:00"), first, lastDay)).contains(2);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-23T09:00"), first, lastDay)).contains(3);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-27T09:00"), first, lastDay)).contains(7);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-28T09:00"), first, lastDay)).isEmpty();
    }

    @Test
    @DisplayName("가입만 하고 연습이 없으면 가입 시각이 F, 그 날짜가 D 다")
    void neverPracticedUsesSignupAsFirstPractice() {
        Instant signup = kst("2026-10-18T10:00");
        LocalDate signupDay = PracticeReminderPolicy.kstDate(signup);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-19T09:29"), signup, signupDay)).isEmpty();
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-19T09:30"), signup, signupDay)).contains(1);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-21T12:00"), signup, signupDay)).contains(3);
        assertThat(PracticeReminderPolicy.practiceDue(kst("2026-10-26T12:00"), signup, signupDay)).isEmpty();
    }

    @Test
    @DisplayName("연속 일수는 앱의 practiceStreak 와 같다 — 오늘 안 했으면 어제까지의 연속을 센다")
    void streakMirrorsTheApp() {
        LocalDate today = LocalDate.of(2026, 10, 21);
        assertThat(PracticeReminderPolicy.streak(Set.of(), today)).isZero();
        assertThat(PracticeReminderPolicy.streak(Set.of(today.minusDays(1)), today)).isEqualTo(1);
        assertThat(PracticeReminderPolicy.streak(Set.of(today.minusDays(1), today.minusDays(2), today.minusDays(3)), today))
                .isEqualTo(3);
        // 오늘 했으면 오늘부터 센다
        assertThat(PracticeReminderPolicy.streak(Set.of(today, today.minusDays(1)), today)).isEqualTo(2);
        // 하루 걸러 있으면 끊긴다
        assertThat(PracticeReminderPolicy.streak(Set.of(today.minusDays(1), today.minusDays(3)), today)).isEqualTo(1);
        // 어제 안 했으면 오늘 안 한 연속은 0 이다
        assertThat(PracticeReminderPolicy.streak(Set.of(today.minusDays(2), today.minusDays(3)), today)).isZero();
    }

    @Test
    @DisplayName("연속 기록 알림: 2일 이상, 오늘 연습 전, 22시 이후(23시 전)")
    void streakDueRules() {
        assertThat(PracticeReminderPolicy.streakDue(kst("2026-10-21T22:00"), 2, false)).isTrue();
        assertThat(PracticeReminderPolicy.streakDue(kst("2026-10-21T21:59"), 5, false)).isFalse();
        assertThat(PracticeReminderPolicy.streakDue(kst("2026-10-21T22:30"), 1, false)).isFalse();
        assertThat(PracticeReminderPolicy.streakDue(kst("2026-10-21T22:30"), 5, true)).isFalse();
        assertThat(PracticeReminderPolicy.streakDue(kst("2026-10-21T23:00"), 5, false)).isFalse();
    }

    @Test
    void kstDateUsesSeoulCalendar() {
        // UTC 15:00 = 서울 다음 날 00:00
        assertThat(PracticeReminderPolicy.kstDate(Instant.parse("2026-10-20T14:59:59Z"))).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(PracticeReminderPolicy.kstDate(Instant.parse("2026-10-20T15:00:00Z"))).isEqualTo(LocalDate.of(2026, 10, 21));
        assertThat(ZonedDateTime.now(PracticeReminderPolicy.SEOUL).getZone().getId()).isEqualTo("Asia/Seoul");
    }

    @Test
    void signupNudgeWindowIsThirtyMinutesToTwoHoursOnTheSignupDayOutsideNight() {
        Instant signup = kst("2026-10-21T10:00");
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-21T10:29"), signup)).isFalse();
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-21T10:30"), signup)).isTrue();
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-21T11:59"), signup)).isTrue();
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-21T12:00"), signup)).isFalse();
        Instant late = kst("2026-10-21T22:40");
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-21T23:10"), late)).isFalse();
        Instant midnight = kst("2026-10-21T23:50");
        assertThat(PracticeReminderPolicy.firstNudgeDue(kst("2026-10-22T00:20"), midnight)).as("가입한 날이 아니다").isFalse();
    }

    @Test
    void holdoutIsStableAndAboutTheGivenShare() {
        int in = 0;
        for (int i = 0; i < 20000; i++) {
            UUID id = new UUID(0x1234_5678L * (i + 1), 0x9abc_def0L ^ (i * 7919L));
            boolean held = PracticeReminderPolicy.inHoldout(id, 10);
            assertThat(PracticeReminderPolicy.inHoldout(id, 10)).isEqualTo(held);
            if (held) in++;
        }
        assertThat(in).isBetween(1600, 2400);
        UUID any = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
        assertThat(PracticeReminderPolicy.inHoldout(any, 0)).isFalse();
        assertThat(PracticeReminderPolicy.inHoldout(any, 100)).isTrue();
    }
}
