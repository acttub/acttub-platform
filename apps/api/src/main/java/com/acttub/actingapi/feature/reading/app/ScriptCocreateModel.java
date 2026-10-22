package com.acttub.actingapi.feature.reading.app;

/**
 * 찍을 대사 같이 만들기(SOMA-721)의 모델 — 프롬프트 하나를 보내고 JSON 글 하나를 받는다.
 *
 * <p>막힘(안전 필터)·빈 답·연결 실패는 예외로 던진다. 답의 모양은 부르는 쪽이 검사한다.
 */
public interface ScriptCocreateModel {

    /** @param maxOutputTokens 답의 상한. 긴 분량일수록 크게 준다 */
    Reply generate(String prompt, int maxOutputTokens);

    record Reply(String text, String model) {
    }
}
