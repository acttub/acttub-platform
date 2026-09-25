package com.acttub.actingapi.feature.challenge.app;

/** 참여작 영상의 파일 쪽 — 실제 길이 확인과 재생 주소 (challenge.entry). 객체 저장소 호출은 트랜잭션 밖이다. */
public interface EntryMedia {
    /** 저장된 객체를 직접 읽어 잰 길이(밀리초). 읽을 수 없으면 422 video_not_ready 를 던진다. */
    int durationMs(String objectKey);

    /** 재생용 주소. 저장소가 없으면 {@code null}. */
    String playbackUrl(String objectKey);
}
