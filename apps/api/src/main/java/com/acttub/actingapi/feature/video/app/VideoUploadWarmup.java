package com.acttub.actingapi.feature.video.app;

/**
 * 영상 올리기가 끝났다(SOMA-780). 코칭이 첫 질문용 영상 준비(소리 검사·Gemini 올리기·처리 대기)를 이때 뒤에서 시작한다.
 *
 * <p>배우는 올리기가 끝나고 '질문 받기'를 누르기까지 보통 몇십 초를 쓴다. 그 시간과 준비를 겹쳐 첫 질문의 기다림을 줄인다.
 * 부르는 쪽을 막지 않아야 하고, 실패해도 올리기 완료에는 영향이 없다 — 그때는 분석 작업이나 첫 질문이 직접 준비한다.
 */
public interface VideoUploadWarmup {
    /** 미리 준비하지 않는다. */
    VideoUploadWarmup NONE = (objectKey, etag, contentType) -> { };

    void uploaded(String objectKey, String etag, String contentType);
}
