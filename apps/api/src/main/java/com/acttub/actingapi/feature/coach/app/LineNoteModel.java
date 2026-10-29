package com.acttub.actingapi.feature.coach.app;

/** 「대사별로 본 것」을 쓰는 글 모델 한 번 호출(SOMA-900). 영상 없이 글만 보낸다. 실패는 예외로 던진다. */
@FunctionalInterface
public interface LineNoteModel {

    /** @return 모델이 낸 원문(JSON 이어야 한다) */
    String generate(String prompt);
}
