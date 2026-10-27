package com.acttub.actingapi.feature.challenge.app;

/**
 * 공개 참여작을 검사하는 모델 (SOMA-907). 입력은 참여작 영상 하나와 지시문(챌린지 대사·캡션 포함)뿐이다 — 올린 사람의
 * 이름·id 는 실을 자리가 없다. 트랜잭션 밖에서 부른다.
 */
public interface EntryModerationModel {
    /** 저장소와 모델이 있는가. 없는 기동(로컬·일부 테스트)에서 워커는 아무것도 집지 않는다. */
    boolean available();

    Output judge(AiReportRepository.Video video, String instruction);

    record Output(String text, String model) { }
}
