package com.acttub.actingapi.feature.consent.app;

import java.time.Instant;

/**
 * 새 판의 기존 회원 재동의를 언제부터 요구하는지. 배포에 든 manifest 의 {@code reconsentFrom} 이다.
 *
 * <p>현재 판은 발행하는 순간 바뀌고(새 가입은 바로 새 판), 이미 그 종류에 동의한 회원에게 새 판을
 * 다시 묻는 것만 이 시각까지 미룬다. 정해 둔 시각이 없으면 {@code null} 이다.
 */
public interface ReconsentSchedule {

    Instant reconsentFrom(String type, String version);
}
