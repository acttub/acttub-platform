package com.acttub.actingapi.feature.challenge.app;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 이 기능 전에 검사가 끝난 공개 참여작의 얼굴 여부를 채운다 (SOMA-1066). {@code CHALLENGE_FACE_BACKFILL} 을 켰을 때만
 * 돈다. 같은 모델에 얼굴 여부만 묻고 face_visible 만 붙인다 — 판정(moderation_*)은 다시 묻지도 바꾸지도 않는다.
 *
 * <p>한 번에 {@link #BATCH} 개를 집는다(얼굴 시도 수를 올려 커밋). 실패한 참여작은 보고하고 건너뛰며, 다음 주기에 다시
 * 집히되 {@link #MAX_ATTEMPTS} 번 시도한 뒤에는 더 집지 않는다. 검사 스케줄러가 검사 일감을 비운 뒤 부른다.
 */
@Service
public class EntryFaceBackfill {
    static final int BATCH = 10;
    static final int MAX_ATTEMPTS = 3;

    private final EntryModerationRepository moderations;
    private final EntryModerationModel model;
    private final FailureReporter failures;
    private final boolean enabled;

    public EntryFaceBackfill(EntryModerationRepository moderations, EntryModerationModel model, FailureReporter failures,
                             @Value("${CHALLENGE_FACE_BACKFILL:false}") boolean enabled) {
        this.moderations = moderations; this.model = model; this.failures = failures; this.enabled = enabled;
    }

    /** @return 집은 참여작 수(성공·실패와 무관). 꺼졌거나 검사할 수 없는 기동이면 0 */
    public int runOnce() {
        if (!enabled || !model.available()) return 0;
        var jobs = moderations.claimFaces(BATCH, MAX_ATTEMPTS);
        for (var job : jobs) {
            try {
                var output = model.judge(job.video(), EntryModerationPrompt.faceOnly());
                moderations.faceSeen(job.entryId(), EntryModerationParser.parseFace(output.text()));
            } catch (RuntimeException failure) {
                failures.report(failure, new FailureContext("EntryFaceBackfill.judge", job.entryId()));
            }
        }
        return jobs.size();
    }
}
