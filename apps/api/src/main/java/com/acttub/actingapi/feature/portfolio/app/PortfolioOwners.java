package com.acttub.actingapi.feature.portfolio.app;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 공개 페이지에 포트폴리오와 함께 보이는 주인의 정보 — 이름·프로필 사진·성별·만 나이. 프로필의 것이라
 * {@code profile} 이 구현한다(간선은 {@code profile} → {@code portfolio.app} 한 방향, ADR-017). 추구하는
 * 방향·경력 구간·목표는 공개하지 않으므로 이 포트에 없다.
 */
public interface PortfolioOwners {

    /** 프로필이 완성돼 있지 않으면(탈퇴로 이름이 지워진 계정 포함) {@code null}. */
    Owner ownerOf(UUID userId);

    /** 한국 시간의 오늘. 경력 연도의 "내년"과 만 나이가 같은 날짜를 본다. */
    LocalDate today();

    /**
     * @param photoKey 프로필 사진의 객체 키. 없으면 {@code null}
     * @param gender 저장 값 그대로({@code female}·{@code male}·{@code unspecified})
     * @param age 읽은 날의 만 나이
     */
    record Owner(String name, String photoKey, String gender, int age) {
    }
}
