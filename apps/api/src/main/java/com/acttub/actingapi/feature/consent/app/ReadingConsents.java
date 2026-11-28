package com.acttub.actingapi.feature.consent.app;

import java.util.UUID;

/**
 * 대본 리딩의 AI 처리 동의를 리딩이 묻는 자리 (reading.script, reading.session, ADR-040). 동의의 테이블은 {@code consent} 의 것이라
 * 리딩은 이 Port 로 묻는다. 답은 {@code granted}·{@code denied}·{@code undecided} 셋이다 — 거절과 철회는 모두 {@code denied} 다.
 *
 * <p>개인정보 수집·이용 동의 v9 이상에 동의했으면 두 처리의 동의가 그 안에 들어 있다(SOMA-726).
 */
public interface ReadingConsents {

    /** 「대본 나누기」 현재 문서(한국어 행)에 대한 마지막 결정. */
    String scriptSplit(UUID userId);

    /** 「대본 리딩 고품질 목소리」 현재 문서(한국어 행)에 대한 마지막 결정. */
    String cloudVoice(UUID userId);
}
