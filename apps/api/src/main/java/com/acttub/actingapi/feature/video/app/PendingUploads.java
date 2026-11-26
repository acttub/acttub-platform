package com.acttub.actingapi.feature.video.app;

import java.util.UUID;

/**
 * 올리기 예약({@code upload_intents})을 다른 기능이 묻는 자리 (practice.record, ADR-040).
 */
public interface PendingUploads {

    /** 이 사람의 그 예약이 아직 영상으로 확정되지 않았는가. */
    boolean pending(UUID ownerId, UUID intentId);
}
