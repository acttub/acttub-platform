package com.acttub.actingapi.feature.appversion.app;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumRaise;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import com.acttub.actingapi.platform.security.RaisedMinimums;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 스토어에 마이너 이상 새 판이 나가면 그 플랫폼의 최소 판을 스스로 올린다(SOMA-1150). iOS 와 안드로이드는 따로 움직인다.
 *
 * <p>{@link #check()} 가 스토어를 보고 기록·올리기를 하고, {@link #refresh()} 가 올린 값을 메모리에 옮긴다. 요청마다
 * DB 를 읽지 않도록 {@code ClientVersionFilter} 는 메모리 값({@link #ios()}·{@link #android()})만 본다.
 */
public class MinimumVersionService implements RaisedMinimums {

    private static final Logger LOG = LoggerFactory.getLogger(MinimumVersionService.class);

    private final StoreVersions stores;
    private final MinimumVersionStore store;
    private final MinimumRaiseNotifier notifier;
    private final Duration settle;
    private final Clock clock;
    private volatile Map<StorePlatform, AppVersion> raised = Map.of();

    public MinimumVersionService(
            StoreVersions stores, MinimumVersionStore store, MinimumRaiseNotifier notifier, Duration settle, Clock clock) {
        this.stores = stores;
        this.store = store;
        this.notifier = notifier;
        this.settle = settle;
        this.clock = clock;
    }

    /** 올린 최소 판을 DB 에서 메모리로 옮긴다. */
    public void refresh() {
        Map<StorePlatform, AppVersion> next = new EnumMap<>(StorePlatform.class);
        store.load().forEach((platform, state) -> {
            if (state.minimum() != null) {
                next.put(platform, state.minimum());
            }
        });
        raised = Map.copyOf(next);
    }

    /** 두 스토어를 보고 새 판이면 기록하고, 때가 된 플랫폼의 최소 판을 올린다. 올린 플랫폼 수를 돌려준다. */
    public int check() {
        Instant now = clock.instant();
        Map<StorePlatform, MinimumVersionState> states = store.load();
        int count = 0;
        for (StorePlatform platform : StorePlatform.values()) {
            Optional<AppVersion> live = stores.live(platform);
            if (live.isPresent()) {
                MinimumVersionState state = states.getOrDefault(platform, MinimumVersionState.empty(platform));
                if (raise(platform, state, live.get(), now)) {
                    count++;
                }
            }
        }
        refresh();
        return count;
    }

    private boolean raise(StorePlatform platform, MinimumVersionState state, AppVersion live, Instant now) {
        Instant since = state.liveSince();
        if (!live.equals(state.storeVersion()) || since == null) {
            store.observe(platform, live, now);
            since = now;
            LOG.info("store version seen platform={} version={} previous={}", platform.key(), live, state.storeVersion());
        }
        Optional<AppVersion> next = MinimumRaise.next(state.minimum(), live, since, now, settle);
        if (next.isEmpty() || !store.raise(platform, state.minimum(), next.get(), now)) {
            return false;
        }
        LOG.warn("minimum app version raised platform={} from={} to={} store={}",
                platform.key(), state.minimum(), next.get(), live);
        notifier.raised(platform, state.minimum(), next.get(), live);
        return true;
    }

    @Override
    public String ios() {
        return text(StorePlatform.IOS);
    }

    @Override
    public String android() {
        return text(StorePlatform.ANDROID);
    }

    private String text(StorePlatform platform) {
        AppVersion version = raised.get(platform);
        return version == null ? "" : version.toString();
    }
}
