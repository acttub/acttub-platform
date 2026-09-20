package com.acttub.actingapi.feature.profile.domain;

import java.util.List;
import java.util.Map;

/**
 * 프로필의 저장 값을 사람이 읽는 말로 푼다 — 가입 화면(A0.2)의 선택지 그대로다
 * ({@code docs/requirements/01-account.md} account.profile 「데이터」).
 *
 * <p>저장 값({@code y1_to_3})은 DB 와 API 의 어휘이고, 코치와 노트의 모델에는 배우가 화면에서 고른
 * 말("1–3년")로 넘긴다. 어휘의 주인이 여기라서 표시말도 여기 한 벌만 둔다 — 읽는 쪽마다 따로 두면
 * 값 목록이 늘 때 한쪽이 빠진다. 모르는 값은 조용히 넘기지 않고 던진다.
 */
public final class ProfileLabels {

    private static final Map<String, String> GENDER = Map.of(
            "female", "여성",
            "male", "남성",
            "unspecified", "선택 안 함");

    private static final Map<String, String> DIRECTION = Map.of(
            "media", "매체(TV·영화)",
            "stage", "무대(연극·뮤지컬)");

    private static final Map<String, String> EXPERIENCE = Map.of(
            "before_start", "입문 전",
            "exam_prep", "입시생",
            "under_1y", "1년 미만",
            "y1_to_3", "1–3년",
            "y3_to_5", "3–5년",
            "over_5y", "5년 이상");

    private static final Map<String, String> GOAL = Map.of(
            "hobby", "취미",
            "audition", "공연·오디션",
            "professional", "전문 배우");

    private ProfileLabels() {
    }

    public static String gender(String value) {
        return label(GENDER, "gender", value);
    }

    public static List<String> directions(List<String> values) {
        return values.stream().map(value -> label(DIRECTION, "direction", value)).toList();
    }

    public static String experience(String value) {
        return label(EXPERIENCE, "experience", value);
    }

    public static String goal(String value) {
        return label(GOAL, "goal", value);
    }

    private static String label(Map<String, String> labels, String item, String value) {
        String label = labels.get(value);
        if (label == null) {
            throw new IllegalArgumentException("unknown profile " + item + ": " + value);
        }
        return label;
    }
}
