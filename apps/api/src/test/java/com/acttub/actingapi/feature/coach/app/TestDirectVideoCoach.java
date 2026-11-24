package com.acttub.actingapi.feature.coach.app;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;

/**
 * 시험용 {@link DirectVideoCoach} 조립. 시험마다 생성자 인자 열 개를 늘어놓던 것을 모았다. 바꾸지 않은 협력자는 "없음"이다 —
 * 코치 성격 없음, 비교 모델 없음, 영상 캐시 없음, 1층 관찰 없음. 바꿀 것만 이름으로 고른다.
 *
 * <pre>{@code
 * TestDirectVideoCoach.of(model, videos, storage, failures, telemetry).personas(s -> "b1").compared(other, 100).build()
 * }</pre>
 */
public record TestDirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage, FailureReporter failures,
        LlmTelemetry telemetry, CoachPersonas personas, DirectVideoModel compared, int comparedShare, CoachVideoCache cache,
        CoachLayerOne layerOne) {

    public static TestDirectVideoCoach of(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry) {
        return new TestDirectVideoCoach(model, videos, storage, failures, telemetry, CoachPersonas.NONE, null, 0,
                CoachVideoCache.NONE, CoachLayerOne.NONE);
    }

    /** 코치 성격 배정(SOMA-622). */
    public TestDirectVideoCoach personas(CoachPersonas value) {
        return new TestDirectVideoCoach(model, videos, storage, failures, telemetry, value, compared, comparedShare, cache, layerOne);
    }

    /** 비교 모델과 새 대화 가운데 그 모델로 쓸 비율(SOMA-657). */
    public TestDirectVideoCoach compared(DirectVideoModel value, int share) {
        return new TestDirectVideoCoach(model, videos, storage, failures, telemetry, personas, value, share, cache, layerOne);
    }

    /** 한 대화 안에서 올린 영상을 다시 쓰는 캐시(SOMA-735). */
    public TestDirectVideoCoach cache(CoachVideoCache value) {
        return new TestDirectVideoCoach(model, videos, storage, failures, telemetry, personas, compared, comparedShare, value, layerOne);
    }

    /** 1층 관찰(SOMA-815). */
    public TestDirectVideoCoach layerOne(CoachLayerOne value) {
        return new TestDirectVideoCoach(model, videos, storage, failures, telemetry, personas, compared, comparedShare, cache, value);
    }

    public DirectVideoCoach build() {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, personas, compared, comparedShare, cache, layerOne);
    }
}
