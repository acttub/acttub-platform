package com.acttub.actingapi.feature.message.app;

import java.util.UUID;

/**
 * 메시지가 읽는 사람의 공개 정보 — 이름·사진과 계정 상태. 이름과 사진은 profile 의 것이고 profile 이 이 Port 를 구현한다
 * ({@code profile → message.app}, ADR-040). 메시지 저장소는 {@code users}·{@code user_profiles} 를 읽지 않는다.
 */
public interface MessagePeople {

    /** 계정이 없으면 {@code null}. */
    Person find(UUID userId);

    /**
     * @param name 공개 이름(없으면 {@code null}). 탈퇴했으면 파기돼 {@code null} 이다
     * @param photoUrl 프로필 사진을 볼 짧은 주소. 사진이 없거나 스토리지가 없으면 {@code null}
     * @param active 계정이 활성인가(탈퇴하면 거짓)
     * @param member 게스트가 아닌 회원인가
     */
    record Person(UUID id, String name, String photoUrl, boolean active, boolean member) {
    }
}
