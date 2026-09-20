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
     * 이 문서에 대한 마지막 행위가 <b>결정</b>인가.
     *
     * @param lastAction 이 판에 대한 <b>마지막</b> 행위. 한 번도 없었으면 {@code null}
     *
     * <p>동의는 언제나 결정이다. 거절은 <b>선택 문서에서만</b> 결정이다 — 필수 문서는 거절할 길이
     * 없고, 1.0.0 이전에 남은 필수 문서의 거절·철회 기록은 미결정과 같게 다룬다. 철회는 탈퇴 뒤
     * 운영자만 기록하므로 회원에게는 결정이 아니다.
     */
    public boolean decidedBy(String lastAction) {
        return "granted".equals(lastAction) || (!required && "declined".equals(lastAction));
    }
}
