package com.acttub.actingapi.feature.auth.app;

/** 가입 제출에 실려 온 결정 하나. 아직 확인하지 않은 값이라 문서 식별자가 문자열이다. */
public record SignupDecision(String documentId, String action) {
}
