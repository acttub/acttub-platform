package com.acttub.actingapi.feature.community.domain;

import java.util.UUID;

/** 글에 붙은 사진 한 장. 보는 주소는 객체 키로 그때그때 서명한다(웹 계층이 저장소 포트로). */
public record PostImage(UUID id, String objectKey) {
}
