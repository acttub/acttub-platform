package com.acttub.actingapi.feature.push.app;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.CRC32;

import com.acttub.actingapi.feature.push.app.ReminderTemplates.Template;

/**
 * 어떤 알림을 어떤 문구로 보낼지 고르는 순수 로직. 모델을 부르지 않는다.
 *
 * <p>연습 권유의 종류는 처음 맞는 것 하나다: 하루 지난 열린 코칭이면 이어 하기 → 올려 두고 코칭 안 한 영상이 있으면
 * pending_video → 넣어 두고 리딩 안 한 대본이 있으면 unread_script → 가입만 하고 연습 전이면 첫 연습 →
 * 정해 둔 다음 촬영이 있으면 숙제 → 마지막 연습이 리딩이면 리딩 → 그 밖에는 일반.
 * pending_video·unread_script 는 같은 종류를 최근 7일에 {@link #MAX_PER_KIND_PER_WEEK}번 보냈거나 14일 안에 쓰지
 * 않은 문구가 없으면 건너뛰고 다음 순서로 넘어간다.
 */
public final class ReminderContent {
    private ReminderContent() {}

    /** 같은 문구를 다시 보내지 않는 기간(일). */
    public static final int NO_REPEAT_DAYS = 14;

    /** 하루 지난 열린 코칭 대화: 마지막 메시지가 코치 질문인 것. {@code sensitive} 는 질문에서 지울 말. */
    public record Resume(UUID conversationId, UUID practiceId, boolean actorAnswered, String lastCoachText,
                         List<String> sensitive) {}

    /** 가장 최근 노트가 다음 촬영 지시를 가진 action 이다. {@code sensitive} 는 지시에서 지울 말. */
    public record Homework(UUID practiceId, String nextTake, List<String> sensitive) {}

    /** 같은 종류(pending_video·unread_script)를 한 회원에게 최근 7일 안에 보낼 수 있는 최대 횟수. */
    public static final int MAX_PER_KIND_PER_WEEK = 2;

    /**
     * 연습 권유를 고르는 데 필요한 입력.
     *
     * @param pendingVideoId  최근 7일에 올렸지만 코칭·참여작에 쓰지 않은 가장 최근 영상. 없으면 null
     * @param unreadScriptId  최근 7일에 넣었지만 리딩을 시작하지 않은 가장 최근 (예시가 아닌) 대본. 없으면 null
     * @param sentThisWeek    최근 7일에 보낸 종류별 횟수(kind 의 wire 값 → 횟수)
     */
    public record PracticeInput(UUID userId, LocalDate today, int skippedDays, boolean neverPracticed,
                                boolean lastWasReading, Resume resume, Homework homework, boolean korean,
                                UUID pendingVideoId, UUID unreadScriptId, Map<String, Integer> sentThisWeek) {
        public PracticeInput(UUID userId, LocalDate today, int skippedDays, boolean neverPracticed,
                             boolean lastWasReading, Resume resume, Homework homework, boolean korean) {
            this(userId, today, skippedDays, neverPracticed, lastWasReading, resume, homework, korean, null, null, Map.of());
        }
    }

    public static ReminderCopy practice(PracticeInput in, Map<String, LocalDate> recentUse) {
        if (!in.neverPracticed() && in.skippedDays() == 1 && in.resume() != null) return resume(in);
        if (in.pendingVideoId() != null && available(ReminderKind.PENDING_VIDEO, in, recentUse)) {
            return fromPool(ReminderKind.PENDING_VIDEO, in, recentUse, null);
        }
        if (in.unreadScriptId() != null && available(ReminderKind.UNREAD_SCRIPT, in, recentUse)) {
            return fromPool(ReminderKind.UNREAD_SCRIPT, in, recentUse, null);
        }
        if (in.neverPracticed()) return fromPool(ReminderKind.FIRST_PRACTICE, in, recentUse, null);
        if (in.homework() != null) return fromPool(ReminderKind.HOMEWORK, in, recentUse, in.homework());
        if (in.lastWasReading()) return fromPool(ReminderKind.READING, in, recentUse, null);
        return fromPool(ReminderKind.GENERAL, in, recentUse, null);
    }

    /** 가입 30분 알림(first_nudge, SOMA-870). 연습한 적 없는 가입 당일 회원에게 한 번. */
    public static ReminderCopy firstNudge(UUID userId, LocalDate today, boolean korean, Map<String, LocalDate> recentUse) {
        List<Template> pool = ReminderTemplates.pool(ReminderKind.FIRST_NUDGE, 0, korean);
        Template template = pick(pool, userId, today, ReminderKind.FIRST_NUDGE.slot(), recentUse);
        return new ReminderCopy(ReminderKind.FIRST_NUDGE, 0, template.id(), template.title(), template.body(), null, null);
    }

    public static ReminderCopy streak(UUID userId, LocalDate today, int streak, boolean korean,
                                      Map<String, LocalDate> recentUse) {
        List<Template> pool = ReminderTemplates.pool(ReminderKind.STREAK, 0, korean);
        Template template = pick(pool, userId, today, ReminderKind.STREAK.slot(), recentUse);
        String n = Integer.toString(streak);
        return new ReminderCopy(ReminderKind.STREAK, 0, template.id(),
                template.title().replace(ReminderTemplates.COUNT, n), template.body().replace(ReminderTemplates.COUNT, n),
                null, null);
    }

    /** 최근 7일에 2번을 채우지 않았고, 14일 안에 쓰지 않은 문구가 남아 있다. */
    private static boolean available(ReminderKind kind, PracticeInput in, Map<String, LocalDate> recentUse) {
        if (in.sentThisWeek().getOrDefault(kind.wire(), 0) >= MAX_PER_KIND_PER_WEEK) return false;
        LocalDate cutoff = in.today().minusDays(NO_REPEAT_DAYS);
        return ReminderTemplates.pool(kind, in.skippedDays(), in.korean()).stream().anyMatch(t -> {
            LocalDate used = recentUse.get(t.id());
            return used == null || used.isBefore(cutoff);
        });
    }

    private static ReminderCopy resume(PracticeInput in) {
        Resume resume = in.resume();
        Optional<String> question = ReminderTextTrimmer.question(resume.lastCoachText(), resume.sensitive(), in.korean());
        boolean answered = resume.actorAnswered();
        Template template;
        String body;
        if (question.isPresent()) {
            template = in.korean()
                    ? (answered ? ReminderTemplates.RESUME_ANSWERED_KO : ReminderTemplates.RESUME_UNANSWERED_KO)
                    : (answered ? ReminderTemplates.RESUME_ANSWERED_EN : ReminderTemplates.RESUME_UNANSWERED_EN);
            body = template.body().replace(ReminderTemplates.QUESTION, question.get());
        } else {
            template = in.korean()
                    ? (answered ? ReminderTemplates.RESUME_ANSWERED_PLAIN_KO : ReminderTemplates.RESUME_UNANSWERED_PLAIN_KO)
                    : (answered ? ReminderTemplates.RESUME_ANSWERED_PLAIN_EN : ReminderTemplates.RESUME_UNANSWERED_PLAIN_EN);
            body = template.body();
        }
        return new ReminderCopy(ReminderKind.RESUME, in.skippedDays(), template.id(), template.title(), body,
                resume.conversationId(), resume.practiceId());
    }

    private static ReminderCopy fromPool(ReminderKind kind, PracticeInput in, Map<String, LocalDate> recentUse,
                                         Homework homework) {
        List<Template> pool = ReminderTemplates.pool(kind, in.skippedDays(), in.korean());
        Template template = pick(pool, in.userId(), in.today(), kind.slot(), recentUse);
        String body = template.body();
        UUID practiceId = null;
        if (homework != null) {
            body = body.replace(ReminderTemplates.TAKE,
                    ReminderTextTrimmer.nextTake(homework.nextTake(), homework.sensitive(), in.korean()));
            practiceId = homework.practiceId();
        }
        UUID videoId = kind == ReminderKind.PENDING_VIDEO ? in.pendingVideoId() : null;
        UUID scriptId = kind == ReminderKind.UNREAD_SCRIPT ? in.unreadScriptId() : null;
        return new ReminderCopy(kind, in.skippedDays(), template.id(), template.title(), body, null, practiceId,
                videoId, scriptId);
    }

    /**
     * 돌려쓰기: 14일 안에 이 회원에게 보낸 id 를 빼고 고른다. 다 썼으면 가장 오래전에 쓴 것 가운데에서 고른다.
     * 고르는 것은 회원·날짜·칸으로 정해져 같은 입력이면 늘 같은 결과다(테스트가 안정적이다).
     */
    public static Template pick(List<Template> pool, UUID userId, LocalDate today, String slot,
                                Map<String, LocalDate> recentUse) {
        if (pool.isEmpty()) throw new IllegalArgumentException("문구 목록이 비어 있다");
        LocalDate cutoff = today.minusDays(NO_REPEAT_DAYS);
        List<Template> fresh = pool.stream()
                .filter(t -> {
                    LocalDate used = recentUse.get(t.id());
                    return used == null || used.isBefore(cutoff);
                })
                .toList();
        List<Template> candidates = fresh;
        if (fresh.isEmpty()) {
            LocalDate oldest = pool.stream().map(t -> recentUse.getOrDefault(t.id(), LocalDate.MIN))
                    .min(Comparator.naturalOrder()).orElseThrow();
            candidates = pool.stream().filter(t -> recentUse.getOrDefault(t.id(), LocalDate.MIN).equals(oldest)).toList();
        }
        return candidates.get((int) (hash(userId, today, slot) % candidates.size()));
    }

    static long hash(UUID userId, LocalDate day, String slot) {
        CRC32 crc = new CRC32();
        crc.update((userId + "|" + day + "|" + slot).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return crc.getValue();
    }
}
