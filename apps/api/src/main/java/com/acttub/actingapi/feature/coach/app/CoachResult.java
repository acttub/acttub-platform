package com.acttub.actingapi.feature.coach.app;

/** 생성 뒤 두 turn이 추가된 세션과 이번 공개 응답. */
public record CoachResult(CoachSessionSnapshot session, CoachReply reply) {
}
