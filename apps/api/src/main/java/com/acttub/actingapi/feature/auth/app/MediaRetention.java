package com.acttub.actingapi.feature.auth.app;

import java.util.UUID;

/**
 * 계정을 닫을 때 영상·녹음을 남겨도 되는가. 계정을 닫는 트랜잭션이 상태를 바꾼 뒤, 자료를 지우기 전에 묻는다
 * ({@link AccountErasureSequence#close}).
 */
public interface MediaRetention {

    /** 「탈퇴 후 영상·녹음 보관·활용」 문서의 현재 버전에 대한 마지막 결정이 동의인가. 답하지 않았으면 거절이다. */
    boolean granted(UUID userId);
}
