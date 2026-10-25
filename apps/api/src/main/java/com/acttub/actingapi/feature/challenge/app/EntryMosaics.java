package com.acttub.actingapi.feature.challenge.app;

/**
 * 참여작 영상의 얼굴 모자이크본을 만드는 쪽 (challenge.entry 얼굴 모자이크). 원본을 받아 얼굴을 찾아 가린 사본을 저장소에
 * 올린다. 트랜잭션 밖에서 부른다.
 */
public interface EntryMosaics {
    /** 저장소와 ffmpeg 가 있는가. 없는 기동(로컬·일부 테스트)에서 워커는 아무것도 집지 않는다. */
    boolean available();

    /**
     * {@code objectKey} 원본으로 모자이크본을 만들어 {@code mosaicKey} 에 올린다.
     *
     * @return 영상에서 얼굴을 하나도 찾지 못했으면 {@code false}(아무것도 올리지 않았다). 다시 해도 같다
     */
    boolean render(String objectKey, String mosaicKey);
}
