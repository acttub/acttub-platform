package com.acttub.actingapi.feature.audition.adapter.source;

import com.acttub.actingapi.platform.observability.ExternalFailure;

/** 출처가 답하지 않거나, 답했지만 목록을 읽을 수 없는 모양이다(구조가 바뀜). 둘 다 바깥 의존의 실패다. */
final class AuditionSourceFailure extends RuntimeException implements ExternalFailure {

    AuditionSourceFailure(String message) {
        super(message);
    }

    AuditionSourceFailure(String message, Throwable cause) {
        super(message, cause);
    }
}
