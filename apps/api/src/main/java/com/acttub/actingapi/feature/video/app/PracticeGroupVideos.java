package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 연습 삭제가 그 묶음의 영상에서 하는 일 (practice.library 「연습 삭제」, SOMA-985).
 *
 * <p>영상 행은 지우지 않는다. 배우의 보관함에서 빼려고 주인을 「지운 연습 보관 계정」으로 바꾸고, 보관 동의가 없으면 파일을
 * 파기한 것으로 적는다. 어느 영상을 넘기고 파기할지는 부르는 쪽(연습 삭제)이 정한다. 구현은 <b>트랜잭션을 열지 않는다.</b>
 */
public interface PracticeGroupVideos {

    /** 잠근 영상 한 줄. */
    record GroupVideo(UUID id, String objectKey, String posterKey, boolean purged) {

        /** 파일 저장소에서 지울 객체 키(영상과 포스터). */
        public List<String> objectKeys() {
            Set<String> keys = new LinkedHashSet<>();
            keys.add(objectKey);
            if (posterKey != null) {
                keys.add(posterKey);
            }
            return List.copyOf(keys);
        }
    }

    /**
     * 이 묶음의 회차가 쓰는 이 사람의 영상을 id 순으로 잠근다. 회차보다 먼저 잡아야 한다 — 회차 시작·이어하기도 영상 행을 먼저
     * 잡으므로 겹쳐도 순서가 정해진다.
     */
    List<GroupVideo> lockOf(UUID userId, UUID rootId);

    /** 파일만 파기와 같다(practice.library): 받아쓰기를 지우고 파기 시각을 찍는다. 객체 삭제는 부르는 쪽이 장부에 올린다. */
    void purgeFile(UUID videoId, Instant now);

    /** 영상을 보관 계정에 넘긴다. 즐겨찾기도 푼다. */
    void handOver(UUID videoId, UUID keeper, Instant now);
}
