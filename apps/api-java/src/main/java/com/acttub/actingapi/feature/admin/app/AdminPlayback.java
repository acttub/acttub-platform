package com.acttub.actingapi.feature.admin.app;

/**
 * admin 이 오브젝트 스토리지에 요구하는 것 — 녹화본을 볼 수 있는 한시적 주소 하나.
 *
 * <p><b>실패를 {@code null} 로 알린다</b>(ADR-018). 이 화면에서 재생 주소는 곁가지라, 스토리지가
 * 설정돼 있지 않거나 서명에 실패해도 목록 전체가 실패하지는 않는다 — {@code practice} 의
 * 재생 포트가 예외를 던지는 것과 갈리는 자리이며, 그쪽은 재생 주소가 응답의 본체다.
 */
public interface AdminPlayback {

    /** 만들 수 없으면 {@code null}. */
    String url(String objectKey, int expiresInSeconds);
}
