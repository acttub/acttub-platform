package com.acttub.actingapi.feature.appversion.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class MinimumVersionServiceTest {

    private static final Instant T0 = Instant.parse("2026-12-01T00:00:00Z");
    private static final Duration SETTLE = Duration.ofHours(6);

    private final Map<StorePlatform, AppVersion> live = new EnumMap<>(StorePlatform.class);
    private final FakeStore store = new FakeStore();
    private final List<String> notices = new ArrayList<>();
    private Instant now = T0;

    private MinimumVersionService service() {
        Clock clock = new Clock() {
            @Override
            public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                return now;
            }
        };
        return new MinimumVersionService(platform -> Optional.ofNullable(live.get(platform)), store,
                (platform, from, to, storeVersion) -> notices.add(platform.key() + " " + from + "->" + to + " store=" + storeVersion),
                SETTLE, clock);
    }

    private static AppVersion v(String text) {
        return AppVersion.parse(text).orElseThrow();
    }

    @Test
    void 새_마이너_판은_처음_본_뒤_정한_시간이_지나야_그_플랫폼만_올린다() {
        MinimumVersionService service = service();
        store.put(StorePlatform.IOS, v("1.1.0"), v("1.1.3"), T0.minus(Duration.ofDays(3)));
        store.put(StorePlatform.ANDROID, v("1.1.0"), v("1.1.3"), T0.minus(Duration.ofDays(3)));
        live.put(StorePlatform.IOS, v("1.2.0"));
        live.put(StorePlatform.ANDROID, v("1.1.3"));

        assertThat(service.check()).isZero();
        assertThat(store.state(StorePlatform.IOS).storeVersion()).isEqualTo(v("1.2.0"));
        assertThat(store.state(StorePlatform.IOS).liveSince()).isEqualTo(T0);
        assertThat(service.ios()).isEqualTo("1.1.0");

        now = T0.plus(SETTLE).minusSeconds(1);
        assertThat(service.check()).isZero();

        now = T0.plus(SETTLE);
        assertThat(service.check()).isEqualTo(1);
        assertThat(service.ios()).isEqualTo("1.2.0");
        assertThat(service.android()).isEqualTo("1.1.0");
        assertThat(notices).containsExactly("ios 1.1.0->1.2.0 store=1.2.0");
    }

    @Test
    void 패치만_나가면_올리지_않고_기다린_시간도_다시_센다() {
        MinimumVersionService service = service();
        store.put(StorePlatform.ANDROID, v("1.2.0"), v("1.2.0"), T0.minus(Duration.ofDays(3)));
        live.put(StorePlatform.ANDROID, v("1.2.1"));

        now = T0.plus(Duration.ofDays(2));
        assertThat(service.check()).isZero();
        assertThat(store.state(StorePlatform.ANDROID).storeVersion()).isEqualTo(v("1.2.1"));
        assertThat(store.state(StorePlatform.ANDROID).liveSince()).isEqualTo(now);
        assertThat(service.android()).isEqualTo("1.2.0");
        assertThat(notices).isEmpty();
    }

    @Test
    void 스토어_판을_모르면_아무것도_바꾸지_않는다() {
        MinimumVersionService service = service();
        store.put(StorePlatform.IOS, v("1.1.0"), v("1.1.3"), T0.minus(Duration.ofDays(3)));

        now = T0.plus(Duration.ofDays(30));
        assertThat(service.check()).isZero();
        assertThat(store.state(StorePlatform.IOS)).isEqualTo(
                new MinimumVersionState(StorePlatform.IOS, v("1.1.0"), v("1.1.3"), T0.minus(Duration.ofDays(3))));
        assertThat(store.state(StorePlatform.ANDROID)).isNull();
        assertThat(service.ios()).isEqualTo("1.1.0");
        assertThat(service.android()).isEmpty();
    }

    @Test
    void 처음_켜면_지금_스토어_판의_x_y_0까지만_올린다() {
        MinimumVersionService service = service();
        live.put(StorePlatform.IOS, v("1.1.2"));

        assertThat(service.check()).isZero();
        now = T0.plus(SETTLE);
        assertThat(service.check()).isEqualTo(1);
        assertThat(service.ios()).isEqualTo("1.1.0");
        assertThat(notices).containsExactly("ios null->1.1.0 store=1.1.2");
    }

    @Test
    void 다른_서버가_먼저_올렸으면_알리지_않는다() {
        MinimumVersionService service = service();
        store.put(StorePlatform.IOS, v("1.1.0"), v("1.2.0"), T0);
        live.put(StorePlatform.IOS, v("1.2.0"));
        store.lostRace = true;

        now = T0.plus(SETTLE);
        assertThat(service.check()).isZero();
        assertThat(notices).isEmpty();
    }

    /** {@code app_min_versions} 를 흉내 낸다. {@code raise} 는 DB 처럼 {@code from} 이 맞을 때만 바꾼다. */
    private static final class FakeStore implements MinimumVersionStore {

        private final Map<StorePlatform, MinimumVersionState> rows = new EnumMap<>(StorePlatform.class);
        private boolean lostRace;

        void put(StorePlatform platform, AppVersion minimum, AppVersion storeVersion, Instant since) {
            rows.put(platform, new MinimumVersionState(platform, minimum, storeVersion, since));
        }

        MinimumVersionState state(StorePlatform platform) {
            return rows.get(platform);
        }

        @Override
        public Map<StorePlatform, MinimumVersionState> load() {
            return new EnumMap<>(rows);
        }

        @Override
        public void observe(StorePlatform platform, AppVersion storeVersion, Instant now) {
            MinimumVersionState old = rows.getOrDefault(platform, MinimumVersionState.empty(platform));
            rows.put(platform, new MinimumVersionState(platform, old.minimum(), storeVersion, now));
        }

        @Override
        public boolean raise(StorePlatform platform, AppVersion from, AppVersion to, Instant now) {
            MinimumVersionState old = rows.getOrDefault(platform, MinimumVersionState.empty(platform));
            if (lostRace || !Objects.equals(old.minimum(), from)) {
                return false;
            }
            rows.put(platform, new MinimumVersionState(platform, to, old.storeVersion(), old.liveSince()));
            return true;
        }
    }
}
