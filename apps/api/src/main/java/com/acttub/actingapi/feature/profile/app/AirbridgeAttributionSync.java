package com.acttub.actingapi.feature.profile.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.feature.profile.app.AirbridgeLookupStore.Lookup;
import com.acttub.actingapi.feature.profile.domain.SignupAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttributionClient;
import com.acttub.actingapi.integration.airbridge.AirbridgeUnavailable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 앱이 SDK 콜백으로 귀속을 못 보낸 계정의 유입 광고를 서버가 Airbridge 에서 가져온다(SOMA-643).
 * 앱이 넘긴 기기 ID 로 몇 번 묻고, 결과를 적거나 24시간이 지나면 기기 ID 를 지운다.
 *
 * <p>한 줄이 실패해도 나머지는 돈다. 실패는 재시도 간격만 늘리고 로그에는 개수만 남긴다 — 기기 ID·토큰은 싣지 않는다.
 */
@Service
public class AirbridgeAttributionSync {
    private static final Logger LOG = LoggerFactory.getLogger(AirbridgeAttributionSync.class);

    /** 기기 ID 를 들고 있는 최대 기간. */
    public static final Duration RETENTION = Duration.ofHours(24);
    static final int BATCH = 50;
    /** 시도 n 번째 실패 뒤의 대기. 마지막 값을 계속 쓴다. */
    private static final List<Duration> BACKOFF = List.of(
            Duration.ofMinutes(5), Duration.ofMinutes(15), Duration.ofHours(1), Duration.ofHours(3),
            Duration.ofHours(6));

    private final AirbridgeLookupStore store;
    private final AirbridgeAttributionClient airbridge;
    private final ProfileRepository profiles;
    private final Clock clock;

    public AirbridgeAttributionSync(
            AirbridgeLookupStore store, AirbridgeAttributionClient airbridge, ProfileRepository profiles, Clock clock) {
        this.store = store;
        this.airbridge = airbridge;
        this.profiles = profiles;
        this.clock = clock;
    }

    /** 한 번 돈 결과의 개수. */
    public record Result(int recorded, int pending, int dropped) {
    }

    public Result runOnce() {
        Instant now = clock.instant();
        int recorded = 0;
        int pending = 0;
        int dropped = 0;
        for (Lookup lookup : store.due(now, BATCH)) {
            if (lookup.createdAt().isBefore(now.minus(RETENTION)) || store.hasAttribution(lookup.userId())) {
                store.delete(lookup.userId());
                dropped++;
                continue;
            }
            Optional<AirbridgeAttribution> found;
            try {
                found = airbridge.lookup(lookup.deviceUuid());
            } catch (AirbridgeUnavailable unavailable) {
                found = Optional.empty();
            }
            if (found.isEmpty()) {
                store.retryAt(lookup.userId(), now.plus(backoff(lookup.attempts())));
                pending++;
                continue;
            }
            // 탈퇴해 적을 수 없는 계정이면 false — 그래도 기기 ID 는 지운다.
            if (profiles.recordSignupAttribution(lookup.userId(), attribution(lookup.platform(), found.get()))) {
                recorded++;
            } else {
                dropped++;
            }
            store.delete(lookup.userId());
        }
        if (recorded + pending + dropped > 0) {
            LOG.info("airbridge lookup: recorded={} pending={} dropped={}", recorded, pending, dropped);
        }
        return new Result(recorded, pending, dropped);
    }

    static Duration backoff(int attemptsSoFar) {
        return BACKOFF.get(Math.min(Math.max(attemptsSoFar, 0), BACKOFF.size() - 1));
    }

    private static SignupAttribution attribution(String platform, AirbridgeAttribution found) {
        return new SignupAttribution(
                SignupAttribution.AIRBRIDGE_SOURCE,
                platform,
                clip(found.channel()),
                null,
                clip(found.campaign()),
                clip(found.adGroup()),
                clip(found.adCreative()),
                clip(found.content()),
                clip(found.term()),
                clip(found.subPublisher()));
    }

    /** 앞뒤 공백을 걷고 {@link SignupAttribution#MAX_LENGTH} 글자(코드 포인트)로 자른다. 비면 {@code null}. */
    static String clip(String value) {
        if (value == null) {
            return null;
        }
        String stripped = value.strip();
        if (stripped.isEmpty()) {
            return null;
        }
        if (stripped.codePointCount(0, stripped.length()) <= SignupAttribution.MAX_LENGTH) {
            return stripped;
        }
        return stripped.substring(0, stripped.offsetByCodePoints(0, SignupAttribution.MAX_LENGTH));
    }
}
