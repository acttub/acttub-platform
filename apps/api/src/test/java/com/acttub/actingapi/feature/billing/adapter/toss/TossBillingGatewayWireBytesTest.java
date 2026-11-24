package com.acttub.actingapi.feature.billing.adapter.toss;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.platform.http.RestClients;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * 토스로 나가는 요청 본문을 바이트 그대로 고정한다. JSON 라이브러리를 바꿔도 같은 바이트가 나가야 한다.
 * 키 순서까지 본다. 기존 테스트의 JSON 비교는 키 순서를 보지 않는다.
 */
class TossBillingGatewayWireBytesTest {
    private static final String SECRET = "test_sk_abcdefgh12345678";
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    private final RestClient.Builder issueBuilder = RestClients.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final RestClient.Builder approveBuilder = RestClients.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final MockRestServiceServer issueServer = MockRestServiceServer.bindTo(issueBuilder).build();
    private final MockRestServiceServer approveServer = MockRestServiceServer.bindTo(approveBuilder).build();
    private final TossBillingGateway gateway =
            new TossBillingGateway(() -> SECRET, issueBuilder.build(), approveBuilder.build(), false);
    private final List<byte[]> sent = new ArrayList<>();

    private void expect(MockRestServiceServer server, String path, String reply) {
        server.expect(requestTo(TossBillingGateway.BASE_URL + path))
                .andExpect(request -> sent.add(((MockClientHttpRequest) request).getBodyAsBytes()))
                .andRespond(withSuccess(reply, MediaType.APPLICATION_JSON));
    }

    @Test
    @DisplayName("빌링키 발급 본문은 authKey, customerKey 순서이고 null 도 키째 싣는다")
    void issueBody() {
        expect(issueServer, "/v1/billing/authorizations/issue", "{\"billingKey\":\"BK-1\"}");

        gateway.issueBillingKey(TRICKY, null);

        issueServer.verify();
        assertThat(sent.getFirst()).asString(StandardCharsets.UTF_8).isEqualTo("""
                {"authKey":"따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n탭\\t제어\\u001F 이모지😀","customerKey":null}""");
    }

    @Test
    @DisplayName("결제 승인 본문은 2의 53제곱을 넘는 금액도 정수 그대로 싣고 영수증 메일을 끝에 둔다")
    void approveBodyWithReceiptEmail() {
        expect(approveServer, "/v1/billing/BK-1", "{\"status\":\"DONE\",\"orderId\":\"o-1\",\"totalAmount\":1}");

        gateway.approve("BK-1", "pgr_고객-1", "o-1", 9_007_199_254_740_993L, TRICKY, " actor@example.com ", "idem-1");

        approveServer.verify();
        assertThat(sent.getFirst()).asString(StandardCharsets.UTF_8).isEqualTo("""
                {"customerKey":"pgr_고객-1","amount":9007199254740993,"orderId":"o-1",\
                "orderName":"따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n탭\\t제어\\u001F 이모지😀",\
                "customerEmail":"actor@example.com"}""");
    }

    @Test
    @DisplayName("결제 승인 본문은 customerKey 가 null 이면 키째 싣고 메일이 없으면 메일 키를 뺀다")
    void approveBodyWithoutReceiptEmail() {
        expect(approveServer, "/v1/billing/BK-2", "{\"status\":\"DONE\",\"orderId\":\"o-2\",\"totalAmount\":3900}");

        gateway.approve("BK-2", null, "o-2", 3900, "ACTTUB Pro", "idem-2");

        approveServer.verify();
        assertThat(sent.getFirst()).asString(StandardCharsets.UTF_8).isEqualTo("""
                {"customerKey":null,"amount":3900,"orderId":"o-2","orderName":"ACTTUB Pro"}""");
    }
}
