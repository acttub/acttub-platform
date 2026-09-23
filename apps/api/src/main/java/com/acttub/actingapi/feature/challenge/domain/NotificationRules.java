package com.acttub.actingapi.feature.challenge.domain;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.UUID;

/**
 * 챌린지 알림의 시각 규칙 (challenge.notification). 좋아요·댓글은 수신자·종류·참여작·10분 구간으로 묶고, 묶음마다 첫
 * 사건은 곧바로, 그 뒤 사건은 구간 끝에 요약으로 보낸다. 한국 시간 21시~09시의 푸시는 예외 없이 09시로 미룬다.
 */
public final class NotificationRules {
    public static final Duration WINDOW = Duration.ofMinutes(10);
    public static final Duration RETENTION = Duration.ofDays(90);
    public static final int PAGE = 20;
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final LocalTime NIGHT_STARTS = LocalTime.of(21, 0);
    private static final LocalTime MORNING = LocalTime.of(9, 0);

    private NotificationRules() { }

    /** 사건이 속한 10분 구간의 시작. */
    public static Instant windowStart(Instant at) {
        long size = WINDOW.getSeconds();
        return Instant.ofEpochSecond(Math.floorDiv(at.getEpochSecond(), size) * size);
    }

    /** 수신자·종류·대상(참여작, 없으면 챌린지)·10분 구간. */
    public static String groupKey(UUID recipient, String kind, UUID target, Instant at) {
        return recipient + "|" + kind + "|" + target + "|" + windowStart(at).getEpochSecond();
    }

    /**
     * 푸시를 보낼 시각. 묶음의 첫 사건은 지금, 뒤따르는 사건은 구간 끝(요약)이고, 그 시각이 밤이면 다음 09시다.
     */
    public static Instant pushAfter(Instant at, boolean firstInGroup) {
        Instant due = firstInGroup ? at : windowStart(at).plus(WINDOW);
        return outsideNight(due);
    }

    /** 밤 시간(21시~09시)이면 다음 09시로 미룬다. */
    public static Instant outsideNight(Instant at) {
        ZonedDateTime local = at.atZone(SEOUL);
        LocalTime time = local.toLocalTime();
        if (!time.isBefore(MORNING) && time.isBefore(NIGHT_STARTS)) return at;
        ZonedDateTime morning = local.toLocalDate().atTime(MORNING).atZone(SEOUL);
        return (time.isBefore(MORNING) ? morning : morning.plusDays(1)).toInstant();
    }

    /** 잠금 화면에 보일 일반 문구. 이름·본문을 넣지 않는다. */
    public static String pushBody(String kind) {
        return switch (kind) {
            case "entry_liked", "entry_commented" -> "내 참여작에 새 반응이 있어요";
            case "challenge_ended" -> "참여한 챌린지가 끝났어요";
            default -> "AI 리포트가 준비됐어요";
        };
    }
}
