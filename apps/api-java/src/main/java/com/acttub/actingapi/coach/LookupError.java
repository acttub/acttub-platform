package com.acttub.actingapi.coach;

/** Python 저장소의 {@code LookupError} 계약을 이름과 메시지까지 보존한다. */
public class LookupError extends RuntimeException {

    public LookupError(String message) {
        super(message);
    }
}
