package com.acttub.actingapi.feature.challenge.app;

import com.acttub.actingapi.feature.challenge.domain.ShareFrames;

/**
 * 참여작 영상에 공유 프레임을 씌우는 쪽 (challenge.entry 공유 프레임, SOMA-1156). 저장소의 {@code sourceKey} 영상을 읽어
 * 프레임을 입힌 결과를 {@code targetKey} 에 올린다. 트랜잭션 밖에서 부른다.
 */
public interface EntryShareFrames {
    /** 저장소 설정이 없으면 503 {@code storage_not_configured} 를 던진다. */
    void requireConfigured();

    /** 1080×1920 프레임 영상(H.264·AAC mp4)을 만들어 올린다. 원본의 소리와 길이를 그대로 둔다. 오래 걸린다. */
    void renderVideo(ShareFrames.Card card, String sourceKey, String targetKey);

    /** 영상 한 장면에 같은 프레임을 씌운 미리보기 JPEG(폭 {@value ShareFrames#PREVIEW_WIDTH})를 만들어 올린다. */
    void renderPreview(ShareFrames.Card card, String sourceKey, String targetKey);
}
