package com.acttub.actingapi.coach;

/** 코치 세션의 저장 단위인 공개 가능한 전체 turn 값. */
public record CoachTurnSnapshot(String role, String text) {
}
