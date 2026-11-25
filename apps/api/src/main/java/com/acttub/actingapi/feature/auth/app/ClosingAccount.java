package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 닫히는 계정 하나. {@link AccountErasure} 의 구현이 자기 몫을 지울 때 받는다.
 *
 * @param retainMedia 영상·녹음을 남기는가(「탈퇴 후 영상·녹음 보관·활용」 현재 문서에 동의했고, 만 14세 미만 닫기가 아니다)
 * @param now 닫는 시각
 * @param today 한국 시간의 오늘. 생년월일을 연령대로 바꿀 때 쓴다
 */
public record ClosingAccount(UUID userId, boolean retainMedia, Instant now, LocalDate today) {
}
