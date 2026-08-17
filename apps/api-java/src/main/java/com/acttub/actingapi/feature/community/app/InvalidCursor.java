package com.acttub.actingapi.feature.community.app;

/**
 * 목록 커서가 우리가 발급한 형태가 아니다.
 *
 * <p>🔎 {@link IllegalArgumentException} 을 그대로 올리면 안 된다. 던지는 곳이
 * {@code @Repository} 라서 스프링의 예외 변환이 {@code InvalidDataAccessApiUsageException} 으로
 * 감싸고, 그러면 받는 쪽 {@code catch} 가 빗나가 500 과 스프링 기본 오류 바디가 나간다
 * (/SPEC.md §6 #1 이 금지한 형태). 전용 예외는 변환 대상이 아니라 그대로 전달된다.
 */
public class InvalidCursor extends RuntimeException {
}
