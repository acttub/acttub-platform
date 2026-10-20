package com.acttub.actingapi.feature.profile.adapter.sched;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import com.acttub.actingapi.feature.profile.app.AccountHousekeeping;
import org.junit.jupiter.api.Test;

/** 계정 정리 예약은 하루 작업을 그대로 부르고, 실패를 삼키지 않는다(보고는 작업 안에서 한다). */
class AccountHousekeepingSchedulerTest {
    @Test void runsTheDailyHousekeepingAndLetsItsFailureThrough() {
        AccountHousekeeping housekeeping = mock(AccountHousekeeping.class);
        doThrow(new IllegalStateException("daily failed")).when(housekeeping).runDaily();
        assertThatThrownBy(() -> new AccountHousekeepingScheduler(housekeeping).run()).hasMessage("daily failed");
    }
}
