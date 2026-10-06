package com.acttub.actingapi.feature.reading.domain;

import java.util.UUID;

/** 진행 저장에 실린 한 줄 (reading.session). 말한 것을 보내면 서버가 정하고, 옛 앱·웹은 결과를 정해 보낸다. */
public sealed interface LineReport {
    UUID lineId();

    record Said(UUID lineId, String said) implements LineReport {
    }

    record Reported(UUID lineId, String outcome, int misses) implements LineReport {
    }
}
