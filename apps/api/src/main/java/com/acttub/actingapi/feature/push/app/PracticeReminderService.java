package com.acttub.actingapi.feature.push.app;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository.Candidate;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 개인화 연습 알림(SOMA-720). 10분마다 돌며, 지금 보낼 때가 된 회원에게 연습 권유와 연속 기록 알림을 보낸다.
 * 규칙의 정본은 account.notification 이다. 한국 날짜마다 칸(practice·streak)별로 한 번, 하루 최대 둘.
 */
@Service
public class PracticeReminderService {
    private static final int STREAK_LOOKBACK_DAYS = 400;
    /** 올려 둔 영상·넣어 둔 대본을 찾는 기간과, 같은 종류 횟수를 세는 기간(일). */
    private static final java.time.Duration PENDING_WINDOW = java.time.Duration.ofDays(7);
    private static final int WEEK_DAYS = 7;
    private static final String CONTEXT = "PracticeReminderService.sendDue";

    private final PracticeReminderRepository reminders;
    private final PushTokenRepository tokens;
    private final PushSender sender;
    private final FailureReporter failures;
    private final Clock clock;
    private final String minimumVersion;
    /** 연습 알림을 받지 않는 비교군 비율(%, SOMA-870). 0 이면 비교군 없음. */
    private final int holdoutPercent;

    public PracticeReminderService(PracticeReminderRepository reminders, PushTokenRepository tokens, PushSender sender,
            FailureReporter failures, Clock clock,
            @Value("${EVENING_REMINDER_MIN_APP_VERSION:0.1.2}") String minimumVersion,
            @Value("${PRACTICE_REMINDER_HOLDOUT_PERCENT:10}") int holdoutPercent) {
        this.reminders = reminders; this.tokens = tokens; this.sender = sender;
        this.failures = failures; this.clock = clock; this.minimumVersion = minimumVersion;
        this.holdoutPercent = holdoutPercent;
    }

    public void sendDue() {
        try {
            Instant now = clock.instant();
            LocalDate today = PracticeReminderPolicy.kstDate(now);
            Instant windowStart = today.minusDays(PracticeReminderPolicy.MAX_SKIPPED_DAYS)
                    .atStartOfDay(PracticeReminderPolicy.SEOUL).toInstant();
            List<PushMessage> messages = new ArrayList<>();
            for (Candidate candidate : reminders.candidates(today, windowStart, minimumVersion)) {
                try {
                    messages.addAll(forCandidate(candidate, now, today));
                } catch (RuntimeException failure) {
                    failures.report(failure, new FailureContext(CONTEXT));
                }
            }
            if (!messages.isEmpty()) sender.send(messages).forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext(CONTEXT));
        }
    }

    private List<PushMessage> forCandidate(Candidate c, Instant now, LocalDate today) {
        List<PushMessage> out = new ArrayList<>();
        if (c.practicedToday()) return out;

        if (!c.sentToday().contains("practice")) {
            Optional<Integer> due = PracticeReminderPolicy.practiceDue(now, c.firstPracticeAt(), c.lastPracticeDay());
            if (due.isPresent()) {
                Map<String, LocalDate> recent = reminders.recentTemplates(c.userId(), today.minusDays(ReminderContent.NO_REPEAT_DAYS));
                int k = due.get();
                ReminderContent.Resume resume = !c.neverPracticed() && k == 1 ? reminders.latestOpenQuestion(c.userId()) : null;
                ReminderContent.Homework homework = c.neverPracticed() ? null : reminders.latestHomework(c.userId());
                java.util.UUID pendingVideo = reminders.latestPendingVideo(c.userId(), now.minus(PENDING_WINDOW));
                java.util.UUID unreadScript = reminders.latestUnreadScript(c.userId(), now.minus(PENDING_WINDOW));
                Map<String, Integer> sentThisWeek = reminders.sentCountsByKind(c.userId(), today.minusDays(WEEK_DAYS - 1));
                deliver(c, today, out, korean -> ReminderContent.practice(new ReminderContent.PracticeInput(
                        c.userId(), today, k, c.neverPracticed(), c.lastWasReading(), resume, homework, korean,
                        pendingVideo, unreadScript, sentThisWeek, c.examPrep(), c.examDate()), recent));
            } else if (c.neverPracticed() && PracticeReminderPolicy.firstNudgeDue(now, c.firstPracticeAt())) {
                Map<String, LocalDate> recent = reminders.recentTemplates(c.userId(), today.minusDays(ReminderContent.NO_REPEAT_DAYS));
                deliver(c, today, out, korean -> ReminderContent.firstNudge(c.userId(), today, korean, recent));
            }
        }

        if (!c.sentToday().contains("streak") && PracticeReminderPolicy.streakDue(now, Integer.MAX_VALUE, false)) {
            Set<LocalDate> days = reminders.countedPracticeDays(c.userId(), today.minusDays(STREAK_LOOKBACK_DAYS));
            int streak = PracticeReminderPolicy.streak(days, today);
            if (PracticeReminderPolicy.streakDue(now, streak, days.contains(today))) {
                Map<String, LocalDate> used = reminders.recentTemplates(c.userId(), today.minusDays(ReminderContent.NO_REPEAT_DAYS));
                deliver(c, today, out, korean -> ReminderContent.streak(c.userId(), today, streak, korean, used));
            }
        }
        return out;
    }

    /** 첫 기기의 언어로 고른 문구를 선점하고, 선점에 성공하면 모든 기기에 각자 언어의 문구로 보낸다. */
    private void deliver(Candidate c, LocalDate today, List<PushMessage> out,
                         java.util.function.Function<Boolean, ReminderCopy> compose) {
        ReminderCopy primary = compose.apply(c.targets().getFirst().korean());
        if (PracticeReminderPolicy.inHoldout(c.userId(), holdoutPercent)) {
            // 비교군: 보낼 때였다는 사실과 보냈을 문구만 남기고 보내지 않는다. 같은 날 같은 칸은 이 기록이 막는다.
            reminders.claim(c.userId(), today, primary.asHoldout());
            return;
        }
        if (!reminders.claim(c.userId(), today, primary)) return;
        ReminderCopy korean = null;
        ReminderCopy other = null;
        for (PushTarget target : c.targets()) {
            ReminderCopy copy;
            if (target.korean() == c.targets().getFirst().korean()) copy = primary;
            else if (target.korean()) copy = korean != null ? korean : (korean = compose.apply(true));
            else copy = other != null ? other : (other = compose.apply(false));
            out.add(copy.messageTo(target.token()));
        }
    }
}
