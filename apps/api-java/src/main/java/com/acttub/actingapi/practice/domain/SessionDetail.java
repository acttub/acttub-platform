package com.acttub.actingapi.practice.domain;

/**
 * 저장된 그대로의 세션 상세 — 세션, 원본 미디어의 오브젝트 키, 최신 관찰 묶음, 최근 분석 오류.
 *
 * <p>{@code objectKey} 는 아직 재생 주소가 아니다. 서명 주소를 만드는 일은 바깥으로 나가는
 * 호출이라 {@link com.acttub.actingapi.practice.app.PracticePlayback} 포트가 맡고, 그 결과가
 * 붙은 형태는 {@link com.acttub.actingapi.practice.app.PlayableSession} 이다.
 *
 * <p>{@code summary} 는 요약 행이 없으면 {@code null} 이다. 세션이 분석 완료 상태가 아닐 때 이것을
 * 응답에 넣을지는 표현의 문제이므로 여기서 정하지 않는다.
 */
public record SessionDetail(
        PracticeSession session,
        String objectKey,
        ObservationPack summary,
        String errorCode) {
}
