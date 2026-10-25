package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/** Original media belonging to the visible, owned practice session. */
public interface CoachVideoSource {
    /**
     * @param faceMosaic 얼굴 가리기를 켠 회차(practice.start). 코치는 원본이 아니라 얼굴을 가린 사본을 모델에 올리고,
     *                   사본을 만들 수 없으면 원본으로 돌아가지 않는다
     */
    record Video(String objectKey, String mimeType, String etag, boolean faceMosaic) {
        /** 얼굴 가리기가 없던 때의 모양. */
        public Video(String objectKey, String mimeType, String etag) {
            this(objectKey, mimeType, etag, false);
        }
    }
    Video find(UUID userId, UUID practiceSessionId);
}
