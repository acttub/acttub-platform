package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 코치가 묻는 「이 배우가 Pro 인가」(SOMA-900). Pro 코칭 고도화(상위 모델 관찰·회차를 넘는 기억·대사별 노트)를 켤지 정한다.
 *
 * <p>결제 기능이 꺼져 있거나 Pro 고도화 스위치({@code ACTTUB_COACH_PRO})가 꺼져 있으면 모두 무료로 본다. 구현은 결제
 * 쪽(billing adapter)에 있다 — 코치가 결제 도메인을 직접 보지 않게 한다.
 */
@FunctionalInterface
public interface CoachPro {
    boolean pro(UUID userId);

    /** 모두 무료(롤백·테스트용). */
    CoachPro NONE = userId -> false;

    /** 실패해도 코칭은 이어 간다 — Pro 판정이 깨지면 무료로 본다. */
    static boolean safe(CoachPro pro, UUID userId) {
        if (pro == null || userId == null) return false;
        try {
            return pro.pro(userId);
        } catch (RuntimeException failure) {
            return false;
        }
    }
}
