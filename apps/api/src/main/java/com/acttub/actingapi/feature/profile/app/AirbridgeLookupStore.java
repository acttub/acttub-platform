package com.acttub.actingapi.feature.profile.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 기기 ID 를 잠깐 두는 표({@code user_airbridge_device_lookups}, V43)의 조회·재시도·삭제.
 * 넣는 쪽은 {@link ProfileRepository#recordAirbridgeDevice} 다.
 */
public interface AirbridgeLookupStore {

    /** 기기 ID 는 로그에 싣지 않는다 — 이 레코드를 문자열로 찍지 않는다. */
    record Lookup(UUID userId, String platform, String deviceUuid, Instant createdAt, int attempts) {
        @Override
        public String toString() {
            return "Lookup[attempts=" + attempts + "]";
        }
    }

    /** 다음 시도 시각이 {@code now} 이전인 줄을 오래된 순으로. */
    List<Lookup> due(Instant now, int limit);

    /** 이 계정이 이미 유입 기록(어느 출처든)을 갖는가. */
    boolean hasAttribution(UUID userId);

    void delete(UUID userId);

    /** 시도 횟수를 올리고 다음 시도 시각을 정한다. */
    void retryAt(UUID userId, Instant nextAttemptAt);
}
