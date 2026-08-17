package com.acttub.actingapi.feature.practice.domain;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 막힘 갈래의 허용 값과 조합 규칙.
 *
 * <p>목록과 조합이 두 곳에 흩어져 있었다 — 컨트롤러가 개별 값의 허용 여부를, 빈 검증
 * 애노테이션이 둘의 조합을 각각 들고 있었다. 같은 규칙이므로 한 곳에 모은다.
 *
 * <p>조합은 {@code ck_practice_sessions_blockage_branch} CHECK 제약과 같은 내용이다. DB 가 거부할
 * 값을 애플리케이션이 먼저 걸러 422 로 답한다.
 */
public final class BlockageBranch {

    /** {@code blockage_kind} 허용 값. 순서가 422 메시지의 나열 순서다. */
    public static final List<String> KINDS = List.of("분석", "표현", "그 외");

    /** {@code sub_branch} 허용 값. 순서가 422 메시지의 나열 순서다. */
    public static final List<String> SUB_BRANCHES = List.of(
            "캐릭터 분석", "대사 분석", "감정", "움직임", "화술", "표정", "그 외");

    private static final Map<String, Set<String>> ALLOWED = Map.of(
            "분석", Set.of("캐릭터 분석", "대사 분석", "그 외"),
            "표현", Set.of("감정", "움직임", "화술", "표정", "그 외"),
            "그 외", Set.of("그 외"));

    private BlockageBranch() {
    }

    /**
     * 두 값이 함께 성립하는 조합인지.
     *
     * <p>어느 한쪽이 비었거나 kind 자체가 허용 값이 아니면 참을 돌려준다 — 그 경우는 값 하나짜리
     * 검사가 먼저 답해야 하고, 여기서 겹쳐 잡으면 오류 메시지가 둘 나간다.
     */
    public static boolean pairs(String kind, String subBranch) {
        if (kind == null || subBranch == null) {
            return true;
        }
        Set<String> allowed = ALLOWED.get(kind);
        return allowed == null || allowed.contains(subBranch);
    }
}
