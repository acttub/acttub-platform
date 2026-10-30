package com.acttub.actingapi.feature.ads.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 한 사람에게 광고가 너무 자주 뜨지 않게 하는 빈도 상한(SOMA-876) — {@code ad_settings}·{@code ad_serves} (V78).
 * "windowMinutes 분 동안 windowCap 개까지", 가입 24시간 이내(첫날)는 firstDayCap 개까지.
 */
public interface AdFrequency {

    record Limits(int windowMinutes, int windowCap, int firstDayCap) {
        public static final int MAX_WINDOW_MINUTES = 1440;
        public static final int MAX_CAP = 100;

        public boolean valid() {
            return windowMinutes >= 1 && windowMinutes <= MAX_WINDOW_MINUTES
                    && inRange(windowCap) && inRange(firstDayCap);
        }

        private static boolean inRange(int cap) {
            return cap >= 0 && cap <= MAX_CAP;
        }
    }

    /** 상한을 두지 않는 구현 — 기록도 하지 않는다. 빈도 저장소가 없는 조립(테스트)에서 쓴다. */
    AdFrequency UNLIMITED = new AdFrequency() {
        @Override
        public Limits limits() {
            return new Limits(10, Limits.MAX_CAP, Limits.MAX_CAP);
        }

        @Override
        public Limits update(Limits limits, Instant now) {
            return limits;
        }

        @Override
        public int servedSince(UUID userId, Instant since) {
            return 0;
        }

        @Override
        public Optional<Instant> signedUpAt(UUID userId) {
            return Optional.empty();
        }

        @Override
        public void recordServe(UUID userId, Instant at) {
        }

        @Override
        public int purgeBefore(Instant before) {
            return 0;
        }
    };

    Limits limits();

    Limits update(Limits limits, Instant now);

    /** since 이후 이 사람에게 내보낸 광고 수(NONE 은 기록하지 않으므로 세지 않는다). */
    int servedSince(UUID userId, Instant since);

    Optional<Instant> signedUpAt(UUID userId);

    void recordServe(UUID userId, Instant at);

    int purgeBefore(Instant before);
}
