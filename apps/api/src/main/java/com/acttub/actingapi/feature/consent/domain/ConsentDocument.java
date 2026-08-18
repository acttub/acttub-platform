package com.acttub.actingapi.feature.consent.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 동의 문서 한 판. CONTEXT.md 가 말하는 Domain Model 이며 {@code consent_documents} 행을
 * 옮겨 담는다.
 *
 * <p>{@code type} 을 {@code ConsentType} 이 아니라 문자열로 들고 있다 — 그 열거형은
 * {@code jakarta.persistence.Converter} 를 끌고 있고, 값은 그대로 응답에 실려 나간다.
 */
public record ConsentDocument(
        UUID id,
        String type,
        String version,
        String title,
        String body,
        boolean required,
        Instant publishedAt) {

    /**
     * 이 사람이 아직 받아야 하는 문서인가.
     *
     * @param lastAction 이 문서에 대한 <b>마지막</b> 행위. 한 번도 없었으면 {@code null}
     *
     * <p>마지막 행위를 보는 것이 규칙의 전부다 — 동의했다가 철회한 사람은 다시 받아야 하고,
     * 철회했다가 동의한 사람은 아니다. 필수가 아닌 문서는 받지 않아도 통과한다.
     */
    public boolean stillNeededBy(String lastAction) {
        return required && !"granted".equals(lastAction);
    }
}
