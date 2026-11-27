package com.acttub.actingapi.feature.message.domain;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

/**
 * 1:1 메시지의 값 규칙 (docs/specs/community/messages.md). 한도와 길이, 하루를 자르는 시각, 푸시 간격이 여기 있다.
 */
public final class MessageRules {
    /** 본문은 앞뒤 공백을 걷은 뒤 1~1000자(코드 포인트)다. DB CHECK 도 같은 수다. */
    public static final int BODY_MAX = 1000;
    /** 한 사람이 한국 날짜 하루에 새로 여는 대화 수. 넘으면 429 {@code daily_conversation_limit}. */
    public static final int DAILY_CONVERSATIONS = 20;
    /** 한 사람이 한국 날짜 하루에 보내는 메시지 수. 넘으면 429 {@code daily_message_limit}. */
    public static final int DAILY_MESSAGES = 300;
    /** 같은 대화의 새 메시지 푸시는 받는 사람마다 이 간격에 한 번이다. */
    public static final Duration PUSH_GAP = Duration.ofMinutes(1);
    /** 신고 메모는 게시판 신고와 같은 500자까지다. */
    public static final int REPORT_DETAIL_MAX = 500;
    public static final int DEFAULT_PAGE = 30;
    public static final int MAX_PAGE = 50;
    /** 탈퇴한 상대의 이름. 게시판 글·댓글과 같은 말이다(docs/specs/common.md 「탈퇴·삭제」). */
    public static final String WITHDRAWN_NAME = "탈퇴한 사용자";
    /** 공개 이름이 비었을 때의 이름. 게시판과 같다. */
    public static final String DEFAULT_NAME = "배우";

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private MessageRules() {
    }

    /** 앞뒤 공백을 걷는다. {@code null} 은 {@code null} 이다. */
    public static String trim(String value) {
        return value == null ? null : value.strip();
    }

    /** 걷은 본문이 1~{@value #BODY_MAX}자인가. */
    public static boolean bodyLength(String trimmed) {
        if (trimmed == null || trimmed.isEmpty()) {
            return false;
        }
        return trimmed.codePointCount(0, trimmed.length()) <= BODY_MAX;
    }

    /** {@code now} 가 속한 한국 날짜의 0시. 하루 한도를 세는 시작이다. */
    public static Instant koreanMidnight(Instant now) {
        return now.atZone(SEOUL).toLocalDate().atStartOfDay(SEOUL).toInstant();
    }

    /** 페이지 크기. 비면 {@value #DEFAULT_PAGE}, 1~{@value #MAX_PAGE} 로 자른다. */
    public static int pageSize(Integer limit) {
        if (limit == null) {
            return DEFAULT_PAGE;
        }
        return Math.max(1, Math.min(limit, MAX_PAGE));
    }

    /**
     * 화면에 적을 상대 이름. 탈퇴했으면 {@value #WITHDRAWN_NAME}, 이름이 비었으면 {@value #DEFAULT_NAME}.
     */
    public static String displayName(String name, boolean withdrawn) {
        if (withdrawn) {
            return WITHDRAWN_NAME;
        }
        return name == null || name.isBlank() ? DEFAULT_NAME : name;
    }

    /** 목록에 보일 마지막 메시지의 앞부분. 80자(코드 포인트)를 넘으면 자른다. */
    public static String preview(String body) {
        if (body == null) {
            return null;
        }
        int limit = 80;
        if (body.codePointCount(0, body.length()) <= limit) {
            return body;
        }
        return body.substring(0, body.offsetByCodePoints(0, limit));
    }
}
