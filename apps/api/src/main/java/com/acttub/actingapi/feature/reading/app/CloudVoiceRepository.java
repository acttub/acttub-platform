package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;

public interface CloudVoiceRepository {
    record CacheEntry(String hash, String objectKey) {}
    String consent(UUID userId);
    int dailyUsage(UUID userId, LocalDate day);
    int monthlyUsage(YearMonth month);
    int monthlyUsage(UUID userId, YearMonth month);
    /** 이 회차가 이 회원이 가장 먼저 시작한 리딩 회차인가(대본과 상관없이 계정당 하나, SOMA-1060). 내 회차가 아니거나 없으면 false. 중간에 그만둔 회차도 센다. */
    boolean firstReadingSession(UUID userId, UUID sessionId);
    /** 내 대본이고 이 회원의 리딩 회차가 아직 하나도 없는가(SOMA-1060) — 곧 시작할 회차가 계정의 첫 회차가 된다. */
    boolean firstReadingScript(UUID userId, UUID scriptId);
    CacheEntry findCache(String hash);

    /** 모두 저장돼 있는지(SOMA-1056). 빈 목록은 {@code false}. */
    default boolean allCached(java.util.Collection<String> hashes) {
        if (hashes.isEmpty()) return false;
        for (String hash : hashes) if (findCache(hash) == null) return false;
        return true;
    }
    /** 계정별 월 한도를 같은 계정의 기록과 직렬화해 검사한다. 캐시가 이미 있으면 차감 없이 성공한다. */
    boolean recordSuccessWithinMonthlyCap(UUID userId, LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now, int cap);
    void recordSuccess(UUID userId, LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now);
}
