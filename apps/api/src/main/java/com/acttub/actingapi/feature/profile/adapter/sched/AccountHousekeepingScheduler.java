package com.acttub.actingapi.feature.profile.adapter.sched;

import com.acttub.actingapi.feature.profile.app.AccountHousekeeping;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 하루 한 번, 한국 시간 새벽에 돈다. 일은 {@link AccountHousekeeping#runDaily} 가 하고 실패도 그쪽이 보고한다.
 * 테스트는 이 빈을 끄고 시계를 돌린 뒤 {@code runDaily} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "ACCOUNT_HOUSEKEEPING_ENABLED", havingValue = "true", matchIfMissing = true)
class AccountHousekeepingScheduler {
    private final AccountHousekeeping housekeeping;

    AccountHousekeepingScheduler(AccountHousekeeping housekeeping) {
        this.housekeeping = housekeeping;
    }

    @Scheduled(cron = "${ACCOUNT_HOUSEKEEPING_CRON:0 30 4 * * *}", zone = "Asia/Seoul")
    void run() {
        housekeeping.runDaily();
    }
}
