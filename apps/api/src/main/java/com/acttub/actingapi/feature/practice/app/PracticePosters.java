package com.acttub.actingapi.feature.practice.app;

/**
 * practice 가 회차 응답에 싣는 포스터 주소 (practice.library). 포스터는 보관함 영상의 첫 장면 JPEG 이고 키는
 * {@code videos.poster_key} 에 있다 — 여기서는 그 키에 서명만 한다.
 */
public interface PracticePosters {

    /** 포스터의 서명 GET 주소. 스토리지가 없는 기동이면 {@code null}. */
    String url(String posterKey);
}
