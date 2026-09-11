package com.acttub.actingapi.platform.observability;

/**
 * 모델 호출과 그 판정을 밖에 남기는 Port. 부르는 쪽은 무엇이 받는지 모른다.
 *
 * <p>{@link FailureReporter} 와 같은 자리·같은 계약이다(ADR-025) — 관측 대상이 Port 를
 * 직접 부르고, 바깥을 아는 구현은 하나만 둔다.
 *
 * <p><b>구현은 절대 던지지 않는다.</b> 관측이 죽어서 연습이 멈추는 것은 앞뒤가 바뀐
 * 일이다. 전송 실패는 구현이 삼키고 경고만 남긴다 — 부르는 쪽에 try/catch 를 흩뿌리지
 * 않기 위해 이 계약을 여기 적어 둔다. 설정이 비면 아무것도 하지 않는 구현이 꽂힌다.
 */
public interface LlmTelemetry {

    /** 끝난 호출 하나를 남긴다. */
    void record(LlmCall call);

    /** 기록에 판정을 붙인다. */
    void score(LlmScore score);
}
