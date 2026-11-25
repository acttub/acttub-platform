package com.acttub.actingapi.feature.appversion.adapter.slack;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.Test;

class SlackMinimumRaiseNotifierTest {

    @Test
    void 알림은_플랫폼_바뀐_판_스토어_판_서버와_끄는_법을_싣는다() {
        String text = SlackMinimumRaiseNotifier.message(StorePlatform.ANDROID, new AppVersion(1, 1, 0),
                new AppVersion(1, 2, 0), new AppVersion(1, 2, 1), "https://acttub.com");

        assertThat(text).contains("안드로이드 최소 판을 1.1.0 → 1.2.0", "Play 스토어 1.2.1", "https://acttub.com",
                "MIN_VERSION_AUTO_RAISE");
        assertThat(SlackMinimumRaiseNotifier.message(
                StorePlatform.IOS, null, new AppVersion(1, 1, 0), new AppVersion(1, 1, 2), ""))
                .contains("iOS 최소 판을 없음 → 1.1.0", "App Store 1.1.2")
                .doesNotContain("https://");
    }

    @Test
    void 웹후크가_없으면_조용히_넘어간다() {
        SlackMinimumRaiseNotifier notifier = new SlackMinimumRaiseNotifier(new SupportSlackChannel(""), null);

        Assertions.assertThatCode(() -> notifier.raised(StorePlatform.IOS, null, new AppVersion(1, 2, 0),
                new AppVersion(1, 2, 0))).doesNotThrowAnyException();
    }
}
