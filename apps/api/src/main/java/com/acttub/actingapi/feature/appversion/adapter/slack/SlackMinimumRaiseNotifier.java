package com.acttub.actingapi.feature.appversion.adapter.slack;

import com.acttub.actingapi.feature.appversion.app.MinimumRaiseNotifier;
import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** 최소 판을 올렸다고 Slack 「#문의-신고」에 올린다. 어느 서버인지 {@code SITE_URL} 로 붙인다. */
@Component
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class SlackMinimumRaiseNotifier implements MinimumRaiseNotifier {

    private final SupportSlackChannel channel;
    private final String site;

    SlackMinimumRaiseNotifier(SupportSlackChannel channel, @Value("${SITE_URL:}") String site) {
        this.channel = channel;
        this.site = site == null ? "" : site.strip();
    }

    @Override
    public void raised(StorePlatform platform, AppVersion from, AppVersion to, AppVersion store) {
        channel.post(message(platform, from, to, store, site), "min-version " + platform.key() + " " + to);
    }

    static String message(StorePlatform platform, AppVersion from, AppVersion to, AppVersion store, String site) {
        String name = platform == StorePlatform.IOS ? "iOS" : "안드로이드";
        String shop = platform == StorePlatform.IOS ? "App Store" : "Play 스토어";
        return "*[앱 최소 판 · 자동]* " + name + " 최소 판을 " + (from == null ? "없음" : from) + " → " + to
                + " 으로 올렸어요(" + shop + " " + store + "). 이제 " + to + " 보다 낮은 " + name + " 앱은 업데이트 화면으로 가요."
                + (site.isEmpty() ? "" : " · " + site)
                + "\n끄려면 서버 .env 의 MIN_VERSION_AUTO_RAISE 를 지우고 다시 배포해요.";
    }
}
