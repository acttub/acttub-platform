package com.acttub.actingapi.feature.challenge.app;

import java.time.Clock;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 얼굴 모자이크를 켠 참여작의 모자이크본을 뒤에서 만든다 (challenge.entry 얼굴 모자이크).
 *
 * <p>한 번은 <b>집기(시도 수를 올려 커밋) · 만들기(받기·얼굴 찾기·가리기·올리기) · 붙이기</b>다. 바깥 호출은 트랜잭션
 * 밖이다(§5-4). 얼굴을 하나도 찾지 못하면 다시 해도 같으므로 곧바로 실패로 닫는다. 그 밖의 실패는 보고하고 다음 주기에
 * 다시 집히며, {@link ChallengeRules#MOSAIC_MAX_ATTEMPTS} 번째 실패에서 닫는다. 실패한 참여작은 다른 사람에게 보이지
 * 않는다(fail-closed) — 본인은 모자이크를 다시 켜 재시도하거나 끄고 원본으로 공개할 수 있다.
 */
@Service
public class EntryMosaicWorker {
    private final EntryRepository entries;
    private final EntryMosaics mosaics;
    private final VideoObjectCleanup cleanup;
    private final FailureReporter failures;
    private final Clock clock;

    public EntryMosaicWorker(EntryRepository entries, EntryMosaics mosaics, VideoObjectCleanup cleanup,
                             FailureReporter failures, Clock clock) {
        this.entries = entries; this.mosaics = mosaics; this.cleanup = cleanup; this.failures = failures; this.clock = clock;
    }

    /** @return 참여작을 집었으면 {@code true}(성공·실패와 무관). 할 일이 없거나 만들 수 없는 기동이면 {@code false} */
    public boolean runOnce() {
        if (!mosaics.available()) return false;
        var job = entries.claimMosaic(ChallengeRules.MOSAIC_MAX_ATTEMPTS, clock.instant());
        if (job == null) return false;
        String key = ChallengeRules.mosaicKey(job.objectKey(), job.entryId());
        try {
            if (!mosaics.render(job.objectKey(), key)) {
                entries.failMosaic(job, clock.instant());
                return true;
            }
            cleanup.attemptObjectDelete(entries.attachMosaic(job, key, clock.instant()));
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryMosaicWorker.render", job.entryId()));
            if (job.attempts() >= ChallengeRules.MOSAIC_MAX_ATTEMPTS) entries.failMosaic(job, clock.instant());
        }
        return true;
    }
}
