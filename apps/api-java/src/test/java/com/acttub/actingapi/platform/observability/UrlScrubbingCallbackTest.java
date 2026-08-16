package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.sentry.Breadcrumb;
import io.sentry.Hint;
import io.sentry.SentryEvent;
import io.sentry.protocol.Request;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Sentry 로 나가는 이벤트에서 식별자가 지워지는지 확인한다. 파이썬 원본의
 * {@code tests/test_observability.py} 를 그대로 옮긴 것이다.
 *
 * <p>방침 v3 7항이 "주소에 이용자의 연습 세션 식별자 등이 포함되는 경우 제거한 뒤 전송한다"고
 * 약속한다. 이 테스트가 그 약속을 지킨다.
 */
class UrlScrubbingCallbackTest {

    private final UrlScrubbingCallback callback = new UrlScrubbingCallback();

    @Test
    void queryIsDroppedEntirely() {
        assertThat(UrlScrubber.scrub("https://acttub.com/v2/profile?email=a@b.com"))
                .isEqualTo("https://acttub.com/v2/profile");
    }

    @Test
    void uuidInPathIsMasked() {
        assertThat(UrlScrubber.scrub("/v2/practice-sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427"))
                .isEqualTo("/v2/practice-sessions/<id>");
    }

    @Test
    void uppercaseUuidIsMasked() {
        assertThat(UrlScrubber.scrub("/v2/uploads/1B4E28BA-2FA1-11D2-883F-0016D3CCA427/complete"))
                .isEqualTo("/v2/uploads/<id>/complete");
    }

    @Test
    void fragmentIsDropped() {
        assertThat(UrlScrubber.scrub("/terms#privacy")).isEqualTo("/terms");
    }

    @Test
    void emptyUrlIsLeftAlone() {
        assertThat(UrlScrubber.scrub("")).isEmpty();
        assertThat(UrlScrubber.scrub(null)).isNull();
    }

    @Test
    void eventRequestIsScrubbed() {
        Request request = new Request();
        request.setUrl("https://acttub.com/v2/practice-sessions/9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
        request.setQueryString("session=9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
        SentryEvent event = new SentryEvent();
        event.setRequest(request);

        callback.execute(event, new Hint());

        assertThat(event.getRequest().getUrl())
                .isEqualTo("https://acttub.com/v2/practice-sessions/<id>");
        assertThat(event.getRequest().getQueryString()).isNull();
    }

    @Test
    void breadcrumbUrlsAreScrubbed() {
        Breadcrumb withUrl = new Breadcrumb();
        withUrl.setData("url", "/v2/reports/1b4e28ba-2fa1-11d2-883f-0016d3cca427");
        Breadcrumb withoutUrl = new Breadcrumb();
        withoutUrl.setData("status_code", 500);
        SentryEvent event = new SentryEvent();
        event.setBreadcrumbs(List.of(withUrl, withoutUrl, new Breadcrumb()));

        callback.execute(event, new Hint());

        List<Breadcrumb> crumbs = event.getBreadcrumbs();
        assertThat(crumbs.get(0).getData()).containsEntry("url", "/v2/reports/<id>");
        assertThat(crumbs.get(1).getData()).containsExactly(entryOf("status_code", 500));
    }

    @Test
    void eventWithoutRequestOrBreadcrumbsPassesThrough() {
        SentryEvent event = new SentryEvent();
        event.setMessage(messageOf("boom"));

        SentryEvent result = callback.execute(event, new Hint());

        assertThat(result).isSameAs(event);
        assertThat(result.getMessage().getFormatted()).isEqualTo("boom");
    }

    private static io.sentry.protocol.Message messageOf(String text) {
        io.sentry.protocol.Message message = new io.sentry.protocol.Message();
        message.setFormatted(text);
        return message;
    }

    private static java.util.Map.Entry<String, Object> entryOf(String key, Object value) {
        return java.util.Map.entry(key, value);
    }
}
