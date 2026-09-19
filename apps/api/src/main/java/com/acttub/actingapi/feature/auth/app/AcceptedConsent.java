package com.acttub.actingapi.feature.auth.app;

import java.util.UUID;

/** 확인을 통과한 가입 결정 하나. 계정과 같은 트랜잭션에서 {@code user_consents} 행이 된다. */
public record AcceptedConsent(UUID documentId, String action) {
}
