package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** 믿는 프록시 설정을 읽는 규칙과, 주소가 아닌 연결 상대·헤더의 처리. */
class ClientAddressConfigurationTest {

    private static MockHttpServletRequest from(String peer, String... forwarded) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(peer);
        for (String line : forwarded) {
            request.addHeader("X-Forwarded-For", line);
        }
        return request;
    }

    @Test
    void singleAddressWithoutAPrefixIsTrustedAsAHost() {
        ClientAddress address = new ClientAddress(" 203.0.113.7 ");

        assertThat(address.of(from("203.0.113.7", "198.51.100.1"))).isEqualTo("198.51.100.1");
        assertThat(address.of(from("203.0.113.8", "198.51.100.1"))).isEqualTo("203.0.113.8");
    }

    @Test
    void ipv6ProxyDoesNotMatchAnIpv4PeerAndNullConfigurationMeansPrivateNetworks() {
        ClientAddress ipv6Only = new ClientAddress("2001:db8::/32");
        ClientAddress defaults = new ClientAddress(null);

        assertThat(ipv6Only.of(from("10.0.0.1", "198.51.100.1"))).isEqualTo("10.0.0.1");
        assertThat(ipv6Only.of(from("2001:db8::5", "198.51.100.1"))).isEqualTo("198.51.100.1");
        assertThat(defaults.of(from("10.0.0.1", "198.51.100.1"))).isEqualTo("198.51.100.1");
    }

    @Test
    void peerThatIsNotAnAddressIsUsedAsItIs() {
        assertThat(new ClientAddress("").of(from("unix-socket"))).isEqualTo("unix-socket");
        assertThat(new ClientAddress("").of(from("999.1.1.1"))).isEqualTo("999.1.1.1");
    }

    @Test
    void configurationThatIsNotACidrOrHasAnOutOfRangePrefixFailsAtStartup() {
        assertThatThrownBy(() -> new ClientAddress("proxy.internal"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("CLIENT_IP_TRUSTED_PROXIES has a value that is not a CIDR: proxy.internal");
        assertThatThrownBy(() -> new ClientAddress("10.0.0.0/33"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("CLIENT_IP_TRUSTED_PROXIES has a prefix out of range: 10.0.0.0/33");
        assertThatThrownBy(() -> new ClientAddress("10.0.0.0/-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("CLIENT_IP_TRUSTED_PROXIES has a prefix out of range: 10.0.0.0/-1");
    }
}
