package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 클라이언트 버전 헤더를 로그·지표 값으로 줄이는 규칙. 정해진 꼴만 그대로이고 나머지는 두 값으로 모인다. */
class ClientLabelTest {

    @Test
    void appAndWebVersionsStayAsTheyAre() {
        assertThat(ClientLabel.of("app/1.1.2")).isEqualTo("app/1.1.2");
        assertThat(ClientLabel.of("app/0.1.0")).isEqualTo("app/0.1.0");
        assertThat(ClientLabel.of("web/0.1.0")).isEqualTo("web/0.1.0");
        assertThat(ClientLabel.of("app/99")).isEqualTo("app/99");
        assertThat(ClientLabel.of("web")).isEqualTo("web");
    }

    @Test
    void missingOrBlankIsNone() {
        assertThat(ClientLabel.of((String) null)).isEqualTo(ClientLabel.NONE);
        assertThat(ClientLabel.of("")).isEqualTo(ClientLabel.NONE);
        assertThat(ClientLabel.of("   ")).isEqualTo(ClientLabel.NONE);
    }

    @Test
    void anythingElseIsOtherSoArbitraryTextNeverReachesLogsOrLabels() {
        for (String header : new String[] {
                "web/snapshot", "app/1.2.3.4", "app/12345.0.0", "ios/1.0.0", "APP/1.0.0", "app/1.0.0 ",
                "app/1.0.0\n\"user_id\":\"forged\"", "app/", "app/1..2", "curl/8.4.0", "actor@example.com"}) {
            assertThat(ClientLabel.of(header)).as(header).isEqualTo(ClientLabel.OTHER);
        }
    }
}
