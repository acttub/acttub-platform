package com.acttub.actingapi.feature.portfolio.domain;

import java.util.List;
import java.util.UUID;

/**
 * 배우가 오디션에 내려고 직접 적는 것 — 소개글, 경력 여러 개, 사진 여러 장, 그리고 공유 링크 (ADR-030).
 *
 * <p><b>프로필과 다른 것이다.</b> 프로필은 코치가 읽는 입력이고 전부 필수다. 포트폴리오는 캐스팅하는 사람이
 * 읽는 산출물이고 전부 선택이라 빈 채로도 있다. 회원당 하나이고 처음 저장할 때 행이 생긴다 — 그 전에도
 * 조회는 빈 모양으로 답한다. 배열은 저장된 순서다.
 */
public record Portfolio(String intro, List<Credit> credits, List<Photo> photos, Share share) {

    /** 한 번도 편집하지 않은 회원의 포트폴리오. */
    public static final Portfolio EMPTY = new Portfolio(null, List.of(), List.of(), new Share(false, null));

    public Portfolio {
        credits = List.copyOf(credits);
        photos = List.copyOf(photos);
    }

    /** @param kind 저장 값이자 API 값 — film·drama·play·musical·ad·other */
    public record Credit(UUID id, String title, String role, int year, String kind) {
    }

    /** 올리기가 끝난 사진. 객체는 영상·프로필 사진과 같은 저장소에 두되 별개다. */
    public record Photo(UUID id, String objectKey) {
    }

    /**
     * 공유 링크. 기본은 꺼짐이다. slug 는 처음 켤 때 생기고 <b>꺼도 남는다</b> — 다시 켜면 같은 주소가
     * 열린다(이력서에 적어 둔 주소가 죽지 않게).
     */
    public record Share(boolean enabled, String slug) {
    }
}
