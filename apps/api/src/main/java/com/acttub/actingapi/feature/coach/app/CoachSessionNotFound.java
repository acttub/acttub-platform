package com.acttub.actingapi.feature.coach.app;

/**
 * 배우가 준 코치 세션 ID 로 아무것도 찾지 못했을 때 — 없거나, 남의 것이거나, 숨긴 연습의 것이다.
 *
 * <p>{@link LookupError} 와 다르다. 저쪽은 <b>이미 소유권 확인이 끝난</b> 세션이나 원장 작업이
 * 사라진 자리라 불변식 위반(500)이고, 이쪽은 배우가 처음 건네준 값이 맞지 않는 자리(404)다.
 * 예외 하나로 합치면 그 둘이 같은 응답을 받게 된다.
 */
public class CoachSessionNotFound extends RuntimeException {

    public CoachSessionNotFound(String message) {
        super(message);
    }
}
