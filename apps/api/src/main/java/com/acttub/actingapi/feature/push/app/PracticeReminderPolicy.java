package com.acttub.actingapi.feature.push.app;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 연습 알림을 언제 보낼지의 순수 규칙(시계·DB 없음). 날짜는 모두 한국(Asia/Seoul) 기준이다.
 *
 * <ul>
 *   <li>D = 연습한 가장 최근 한국 날짜, F = D 의 첫 연습 시각. 연습한 적이 없으면 가입 시각이 F, 그 날짜가 D.</li>
 *   <li>k = D 로부터 지난 한국 날짜 수(오늘이 D+k). k 가 1~7 일 때만 보낸다. 7일이 지나면 다시 연습할 때까지 보내지 않는다.</li>
 *   <li>k 번째 보낼 시각 due_k = F + 23.5시간 + (k-1)×24시간. 밤 23시~아침 9시에 걸리면 다음 아침 9시로 민다.
 *       F 가 23:30 이후면 보정으로 하루 밀린 날짜에 보낸다({@link #practiceDue}).</li>
 *   <li>연속 기록 알림: 어제까지 연속 2일 이상, 오늘 아직 연습 안 함, 밤 22시 이후.</li>
 * </ul>
 */
public final class PracticeReminderPolicy {
    private PracticeReminderPolicy() {}

    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    public static final int MAX_SKIPPED_DAYS = 7;
    public static final int MIN_STREAK = 2;
    public static final LocalTime QUIET_START = LocalTime.of(23, 0);
    public static final LocalTime QUIET_END = LocalTime.of(9, 0);
    public static final LocalTime STREAK_FROM = LocalTime.of(22, 0);
    static final Duration FIRST_DELAY = Duration.ofMinutes(23 * 60 + 30);
    /** 가입 30분 알림(SOMA-870): 가입 뒤 이만큼 지나면 보내고, {@link #NUDGE_UNTIL} 이 지나면 늦었으니 보내지 않는다. */
    public static final Duration NUDGE_DELAY = Duration.ofMinutes(30);
    public static final Duration NUDGE_UNTIL = Duration.ofHours(2);
    /** 비교군 배정에 섞는 값. 바꾸면 회원들의 배정이 새로 섞인다. */
    static final String HOLDOUT_SALT = ":reminder-holdout-1";

    public static LocalDate kstDate(Instant instant) { return instant.atZone(SEOUL).toLocalDate(); }

    /** D 로부터 오늘까지 지난 한국 날짜 수. */
    public static int skippedDays(LocalDate lastPracticeDay, LocalDate today) {
        return (int) ChronoUnit.DAYS.between(lastPracticeDay, today);
    }

    /** k 번째 알림의 예정 시각(밤 시간 보정 포함). */
    public static Instant dueAt(Instant firstPracticeAt, int k) {
        if (k < 1 || k > MAX_SKIPPED_DAYS) throw new IllegalArgumentException("k 는 1~" + MAX_SKIPPED_DAYS + ": " + k);
        Instant raw = firstPracticeAt.plus(FIRST_DELAY).plus(Duration.ofHours(24L * (k - 1)));
        return shiftOutOfQuietHours(raw);
    }

    /** 23:00~09:00 에 걸리면 그다음 09:00 으로 민다. 그 밖이면 그대로다. */
    public static Instant shiftOutOfQuietHours(Instant instant) {
        ZonedDateTime local = instant.atZone(SEOUL);
        LocalTime time = local.toLocalTime();
        if (!time.isBefore(QUIET_START)) return local.toLocalDate().plusDays(1).atTime(QUIET_END).atZone(SEOUL).toInstant();
        if (time.isBefore(QUIET_END)) return local.toLocalDate().atTime(QUIET_END).atZone(SEOUL).toInstant();
        return instant;
    }

    public static boolean inQuietHours(Instant instant) {
        LocalTime time = instant.atZone(SEOUL).toLocalTime();
        return !time.isBefore(QUIET_START) || time.isBefore(QUIET_END);
    }

    /**
     * 지금 연습 권유를 보낼 때인가. 맞으면 k(오늘 기준 건너뛴 날 수)를 돌려준다.
     *
     * <p>오늘이 D 이면(오늘 연습함) k=0 이라 보내지 않고, 8일째부터는 보내지 않는다. 한국 날짜당 한 번은 보낸 기록(DB 선점)이 지킨다.
     * 보내는 순간이 밤 시간이면 늦게 돈 작업이 밤에 울리지 않도록 건너뛴다.
     *
     * <p>보낼 시각은 보통 D+j 날짜에 떨어지지만, F 가 23:30 이후면 23:00 보정으로 하루 밀려 D+j+1 날짜에 떨어진다.
     * 그러면 j 번째 알림이 영영 오늘이 아닌 날로 밀리기만 하므로, 오늘 날짜에 떨어지는 j(= k 또는 k-1)를 오늘의 알림으로 본다.
     * 두 경우는 F 의 시각으로 갈려 한 날에 둘이 겹치지 않는다.
     */
    public static Optional<Integer> practiceDue(Instant now, Instant firstPracticeAt, LocalDate lastPracticeDay) {
        LocalDate today = kstDate(now);
        int k = skippedDays(lastPracticeDay, today);
        if (k < 1 || k > MAX_SKIPPED_DAYS) return Optional.empty();
        if (inQuietHours(now)) return Optional.empty();
        for (int j = k; j >= Math.max(1, k - 1); j--) {
            Instant due = dueAt(firstPracticeAt, j);
            if (kstDate(due).equals(today) && !now.isBefore(due)) return Optional.of(k);
        }
        return Optional.empty();
    }

    /**
     * 가입 30분 알림을 보낼 때인가(SOMA-870). 연습한 적 없는 회원에게만 부른다. 가입한 한국 날짜가 오늘이고,
     * 가입 30분~2시간 사이이며, 밤 시간(23~9시)이 아닐 때다. 밤으로 밀지 않고 건너뛴다(다음 날 첫 연습 알림이 따로 있다).
     */
    public static boolean firstNudgeDue(Instant now, Instant signupAt) {
        if (!kstDate(signupAt).equals(kstDate(now))) return false;
        if (inQuietHours(now)) return false;
        return !now.isBefore(signupAt.plus(NUDGE_DELAY)) && now.isBefore(signupAt.plus(NUDGE_UNTIL));
    }

    /**
     * 연습 알림을 받지 않는 비교군인가(SOMA-870). 회원 id 로 정해져 늘 같은 쪽이다. percent 가 0 이하면 아무도 아니다.
     * 문자열 hashCode 는 자바 명세로 고정된 값이라 서버를 다시 띄워도 배정이 바뀌지 않는다.
     */
    public static boolean inHoldout(UUID userId, int percent) {
        if (percent <= 0) return false;
        return Math.floorMod((userId + HOLDOUT_SALT).hashCode(), 100) < percent;
    }

    /**
     * 연속 연습 일수. 앱 {@code practiceStreak}(apps/mobile/lib/practice/groups.ts)와 같은 셈이다:
     * 오늘부터 거슬러 세고, 오늘 아직 안 했으면 어제까지의 연속을 지킨다.
     */
    public static int streak(Set<LocalDate> practiceDays, LocalDate today) {
        int streak = 0;
        for (int i = 0; ; i++) {
            LocalDate day = today.minusDays(i);
            if (practiceDays.contains(day)) streak++;
            else if (i == 0) continue;
            else break;
        }
        return streak;
    }

    /** 연속 기록 알림을 보낼 때인가: 오늘 아직 연습 전, 어제까지 연속 2일 이상, 22:00 이후(밤 23시 전). */
    public static boolean streakDue(Instant now, int streak, boolean practicedToday) {
        if (practicedToday || streak < MIN_STREAK) return false;
        LocalTime time = now.atZone(SEOUL).toLocalTime();
        return !time.isBefore(STREAK_FROM) && time.isBefore(QUIET_START);
    }
}
