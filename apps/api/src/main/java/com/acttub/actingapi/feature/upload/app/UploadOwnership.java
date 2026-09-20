package com.acttub.actingapi.feature.upload.app;

import java.util.UUID;

/**
 * 올린 영상의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest, ADR-028).
 * 객체는 그대로 두고 행의 주인만 바꾼다. <b>부르는 쪽의 트랜잭션에 참여한다.</b>
 */
public interface UploadOwnership {

    void reassign(UUID from, UUID to);
}
