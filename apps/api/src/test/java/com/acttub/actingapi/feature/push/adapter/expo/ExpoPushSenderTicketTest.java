package com.acttub.actingapi.feature.push.adapter.expo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 보낼 것이 없으면 Expo 를 부르지 않고, 보낸 것보다 많은 ticket 이나 data 가 아닌 답은 기기 이름이 되지 않는다. */
class ExpoPushSenderTicketTest {

    @SuppressWarnings("unchecked")
    private static HttpResponse<String> ok(String body) {
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn(body);
        return response;
    }

    @Test
    void nothingToSendMakesNoRequest() {
        List<Object> requests = new ArrayList<>();
        ExpoPushSender sender = new ExpoPushSender(new ObjectMapper(), "https://exp.host/--/api/v2/push/send",
                new RecordingFailureReporter(), request -> {
                    requests.add(request);
                    return ok("{\"data\":[]}");
                });

        assertThat(sender.send(List.of())).isEmpty();
        assertThat(requests).isEmpty();
    }

    @Test
    void extraTicketsBeyondTheMessagesAreIgnoredAndADataObjectIsUnreadable() {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        List<PushMessage> one = List.of(new PushMessage("ExponentPushToken[a]", "t", "b", Map.of()));
        ExpoPushSender extra = new ExpoPushSender(new ObjectMapper(), "https://exp.host/--/api/v2/push/send", reporter,
                request -> ok("""
                        {"data":[{"status":"ok"},{"status":"error","details":{"error":"DeviceNotRegistered"}}]}
                        """));
        ExpoPushSender objectData = new ExpoPushSender(new ObjectMapper(), "https://exp.host/--/api/v2/push/send",
                reporter, request -> ok("{\"data\":{\"status\":\"ok\"}}"));

        assertThat(extra.send(one)).isEmpty();
        assertThat(reporter.reports()).isEmpty();
        assertThat(objectData.send(one)).isEmpty();
        assertThat(reporter.contexts()).containsExactly("ExpoPushSender.tickets");
    }
}
