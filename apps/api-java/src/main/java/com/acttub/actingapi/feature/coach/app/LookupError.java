package com.acttub.actingapi.feature.coach.app;

/** Python 저장소의 {@code LookupError} 계약을 이름과 메시지까지 보존한다. */
public class LookupError extends RuntimeException {

    public LookupError(String message) {
        super(message);
    }
}
