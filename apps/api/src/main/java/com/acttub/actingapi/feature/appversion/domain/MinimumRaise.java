package com.acttub.actingapi.feature.appversion.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * 스토어에 나간 판을 보고 최소 판을 올릴지 정한다(SOMA-1150).
 *
 * <ul>
 *   <li><b>마이너 이상이 바뀌었을 때만</b> 올린다. 올리는 값은 스토어 판의 x.y.0 이라, 잔판(패치)만 바뀌면 값이 같아
 *       그대로다. 그래서 올린 값은 스토어 판보다 높을 수 없다.</li>
 *   <li>스토어 판을 처음 본 뒤 {@code settle} 이 지나야 올린다 — 스토어 앱마다 새 판이 보이는 데 시간이 걸려, 바로
 *       올리면 받을 판이 안 보이는 사람이 업데이트 화면에 갇힌다.</li>
 *   <li>내리지 않는다. 스토어 판이 내려가 보여도(공개 조회의 캐시) 그대로 둔다.</li>
 * </ul>
 */
public final class MinimumRaise {

    private MinimumRaise() {
    }

    /**
     * @param current 지금 서버가 올려 둔 최소 판(없으면 null)
     * @param store 지금 그 스토어에서 누구나 받을 수 있는 판
     * @param liveSince {@code store} 를 처음 본 시각(모르면 null — 그러면 올리지 않는다)
     */
    public static Optional<AppVersion> next(
            AppVersion current, AppVersion store, Instant liveSince, Instant now, Duration settle) {
        if (store == null || liveSince == null || now.isBefore(liveSince.plus(settle))) {
            return Optional.empty();
        }
        AppVersion target = store.minorFloor();
        if (current != null && target.compareTo(current) <= 0) {
            return Optional.empty();
        }
        return Optional.of(target);
    }
}
