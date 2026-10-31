package com.acttub.actingapi.feature.support.app;

import java.util.List;
import java.util.Set;

/** 웹 문의하기의 값 규칙 (app.support-inquiry). */
public final class SupportInquiryRules {
    private SupportInquiryRules() {
    }

    public static final List<String> CATEGORIES =
            List.of("account", "billing", "refund", "usage", "bug", "report", "other");
    public static final Set<String> STATUSES = Set.of("open", "closed");
    public static final int EMAIL_MAX_CHARS = 254;
    public static final int BODY_MIN_CHARS = 10;
    public static final int BODY_MAX_CHARS = 3000;
    public static final int CLIENT_MAX_CHARS = 100;
    /** 한 IP 가 창 안에 보낼 수 있는 문의 수. */
    public static final int PER_IP_LIMIT = 5;
    public static final int WINDOW_MINUTES = 10;
    public static final int ADMIN_DEFAULT_LIMIT = 50;
    public static final int ADMIN_MAX_LIMIT = 200;
    /** 점 있는 도메인이 붙은 주소만 받는다. 실제로 닿는지는 확인하지 않는다(메일을 보내지 않는다). */
    public static final String EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

    /** 앞뒤 공백을 걷어 낸다. */
    public static String normalize(String raw) {
        return raw == null ? null : raw.strip();
    }

    /** 내 문의 목록에서 보여 줄 첫 줄 요약의 길이. */
    public static final int SUMMARY_CHARS = 40;
    public static final int MINE_LIMIT = 20;

    /** 줄바꿈과 겹친 공백을 한 칸으로 줄여 앞 40자만 남기고, 잘렸으면 말줄임표를 붙인다. */
    public static String summarize(String body) {
        String flat = body.strip().replaceAll("\\s+", " ");
        if (length(flat) <= SUMMARY_CHARS) {
            return flat;
        }
        return flat.substring(0, flat.offsetByCodePoints(0, SUMMARY_CHARS)) + "…";
    }

    public static int length(String text) {
        return text.codePointCount(0, text.length());
    }
}
