package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 「만 14세 이상이에요」 확인 (account.consent). 계정 행의 칸({@code users.age_confirmed_at})이지만 뜻은 동의 제출의 일부라
 * {@code consent} 가 읽고 쓴다. 계정 행의 주인이 이 Port 로 내준다(ADR-040).
 */
public interface AgeConfirmation {

    boolean confirmed(UUID userId);

    /** 아직 확인하지 않은 계정에만 적는다 — 처음 확인한 시각을 지킨다. */
    void confirm(UUID userId, Instant now);
}
