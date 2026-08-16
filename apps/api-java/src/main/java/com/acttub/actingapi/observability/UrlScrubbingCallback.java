package com.acttub.actingapi.observability;

import io.sentry.Breadcrumb;
import io.sentry.Hint;
import io.sentry.SentryEvent;
import io.sentry.SentryOptions.BeforeSendCallback;
import io.sentry.protocol.Request;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 이벤트를 보내기 직전에 주소가 실릴 수 있는 자리를 훑는다. 파이썬 원본은
 * {@code observability.py:_scrub_event} 다.
 *
 * <p>{@code send-default-pii: false} 가 쿠키·헤더·클라이언트 IP 를 이미 막지만 <b>주소는 그
 * 대상이 아니다.</b> 연습 세션·업로드 식별자가 경로와 쿼리에 그대로 실려 오므로 여기서 직접
 * 지운다.
 *
 * <p>Sentry Spring Boot starter 가 {@code BeforeSendCallback} 타입 빈을 자동으로 물어 간다.
 * DSN 이 없어 SDK 가 꺼져 있으면 이 빈은 등록만 되고 호출되지 않는다.
 */
@Component
public class UrlScrubbingCallback implements BeforeSendCallback {

    @Override
    public SentryEvent execute(SentryEvent event, Hint hint) {
        Request request = event.getRequest();
        if (request != null) {
            if (request.getUrl() != null) {
                request.setUrl(UrlScrubber.scrub(request.getUrl()));
            }
            // 쿼리는 남겨서 얻을 것이 없다.
            request.setQueryString(null);
        }

        List<Breadcrumb> breadcrumbs = event.getBreadcrumbs();
        if (breadcrumbs != null) {
            for (Breadcrumb crumb : breadcrumbs) {
                Map<String, Object> data = crumb.getData();
                if (data != null && data.get("url") instanceof String url) {
                    crumb.setData("url", UrlScrubber.scrub(url));
                }
            }
        }

        return event;
    }
}
