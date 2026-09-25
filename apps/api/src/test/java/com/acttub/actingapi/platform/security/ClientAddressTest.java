package com.acttub.actingapi.platform.security;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * IP 제한의 열쇠가 되는 방문자 주소. 배포 경로는 방문자 → Cloudflare → cloudflared → web(Next rewrites) → api 라서
 * api 가 보는 상대는 언제나 web 컨테이너다. Next 의 rewrite 는 {@code X-Forwarded-For} 를 <b>그대로 넘긴다</b>
 * (덧붙이지도 새로 만들지도 않는다 — Next 16.2.10 에서 실측). 그래서 api 가 받는 값은 Cloudflare 가 만든 것이고,
 * 방문자가 위조해 보낸 값은 Cloudflare 가 덧붙인 진짜 주소의 <b>왼쪽</b>에 온다.
 */
class ClientAddressTest {
    private static final String WEB_CONTAINER = "172.18.0.5";

    private final ClientAddress addresses = new ClientAddress("");

    @Test
    @DisplayName("account.guest: 헤더 없이 온 요청(로컬 개발)은 연결한 상대의 주소다")
    void withoutAForwardedHeaderTheAddressIsThePeer() {
        assertThat(addresses.of(request("127.0.0.1"))).isEqualTo("127.0.0.1");
        assertThat(addresses.of(request(WEB_CONTAINER))).isEqualTo(WEB_CONTAINER);
        assertThat(addresses.of(request(null))).isEqualTo("unknown");
    }

    @Test
    @DisplayName("account.guest: 신뢰하는 프록시가 전한 요청은 그 프록시가 붙인 방문자 주소다")
    void aTrustedProxyHandsOverTheVisitor() {
        assertThat(addresses.of(request(WEB_CONTAINER, "203.0.113.7"))).isEqualTo("203.0.113.7");
    }

    @Test
    @DisplayName("account.guest: 방문자가 위조해 보낸 X-Forwarded-For 로는 제한을 피하지도 남의 주소를 막지도 못한다 — 맨 오른쪽의 신뢰하지 않는 주소만 본다")
    void aForgedHeaderFromTheVisitorIsIgnored() {
        // 방문자가 "198.51.100.9" 를 실어 보냈고, Cloudflare 가 진짜 주소를 그 오른쪽에 덧붙였다.
        assertThat(addresses.of(request(WEB_CONTAINER, "198.51.100.9, 203.0.113.7"))).isEqualTo("203.0.113.7");
        assertThat(addresses.of(request(WEB_CONTAINER, "10.0.0.1, 127.0.0.1, 203.0.113.7")))
                .as("사설 대역을 흉내 낸 위조도 같다").isEqualTo("203.0.113.7");
        assertThat(addresses.of(request(WEB_CONTAINER, "198.51.100.9", "203.0.113.7")))
                .as("헤더가 두 줄로 와도 순서는 같다").isEqualTo("203.0.113.7");
    }

    @Test
    @DisplayName("account.guest: 신뢰하는 프록시가 아닌 상대가 직접 붙인 헤더는 믿지 않는다")
    void aHeaderFromAnUntrustedPeerIsNotBelieved() {
        assertThat(addresses.of(request("198.51.100.20", "203.0.113.7"))).isEqualTo("198.51.100.20");
    }

    @Test
    @DisplayName("account.guest: 여러 홉을 지나온 요청은 신뢰하는 홉을 건너뛰고 그 앞의 주소를 본다")
    void trustedHopsAreSkipped() {
        assertThat(addresses.of(request(WEB_CONTAINER, "203.0.113.7, 10.0.3.4, 172.18.0.4"))).isEqualTo("203.0.113.7");
        assertThat(addresses.of(request(WEB_CONTAINER, "10.0.3.4, 172.18.0.4")))
                .as("전부 신뢰하는 홉이면 방문자를 알 수 없다 — 연결한 상대로 돌아간다").isEqualTo(WEB_CONTAINER);
    }

    @Test
    @DisplayName("account.guest: 주소가 아닌 값은 풀지 않는다(이름 조회 없음) — 사슬이 끊긴 것으로 보고 연결한 상대로 돌아간다")
    void valuesThatAreNotAddressesAreNeverResolved() {
        assertThat(addresses.of(request(WEB_CONTAINER, "203.0.113.7, attacker.example"))).isEqualTo(WEB_CONTAINER);
        assertThat(addresses.of(request(WEB_CONTAINER, "unknown"))).isEqualTo(WEB_CONTAINER);
        assertThat(addresses.of(request(WEB_CONTAINER, "203.0.113.7:51234"))).isEqualTo(WEB_CONTAINER);
        assertThat(addresses.of(request(WEB_CONTAINER, ""))).isEqualTo(WEB_CONTAINER);
    }

    @Test
    @DisplayName("account.guest: IPv6 방문자도 같은 규칙이고, 같은 주소의 다른 표기는 한 열쇠가 된다")
    void ipv6VisitorsShareOneKeyPerAddress() {
        String compact = addresses.of(request(WEB_CONTAINER, "2001:db8::1"));

        assertThat(compact).isEqualTo(addresses.of(request(WEB_CONTAINER, "2001:0DB8:0:0:0:0:0:1")));
        assertThat(addresses.of(request(WEB_CONTAINER, "::ffff:203.0.113.7"))).isEqualTo("203.0.113.7");
        assertThat(addresses.of(request("::1", "2001:db8::1"))).as("루프백·ULA 도 신뢰하는 홉이다").isEqualTo(compact);
        assertThat(addresses.of(request("fd00::5", "2001:db8::1"))).isEqualTo(compact);
    }

    @Test
    @DisplayName("account.guest: 신뢰하는 프록시는 설정으로 좁히거나 끌 수 있다")
    void trustedProxiesAreConfigurable() {
        assertThat(new ClientAddress("none").of(request(WEB_CONTAINER, "203.0.113.7"))).isEqualTo(WEB_CONTAINER);
        ClientAddress onlyTheWebSubnet = new ClientAddress("172.18.0.0/16");
        assertThat(onlyTheWebSubnet.of(request(WEB_CONTAINER, "203.0.113.7"))).isEqualTo("203.0.113.7");
        assertThat(onlyTheWebSubnet.of(request("10.0.0.9", "203.0.113.7"))).isEqualTo("10.0.0.9");
    }

    @Test
    @DisplayName("account.guest: IP 를 구하는 자리는 하나다 — feature 는 연결한 상대의 주소를 직접 읽지 않는다")
    void featuresNeverReadThePeerAddressThemselves() {
        noClasses().that().resideInAPackage("com.acttub.actingapi.feature..")
                .should().callMethod(jakarta.servlet.ServletRequest.class, "getRemoteAddr")
                .orShould().callMethod(HttpServletRequest.class, "getRemoteAddr")
                .because("방문자 주소는 platform/security/ClientAddress 하나가 구한다")
                .allowEmptyShould(false)
                .check(new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.acttub.actingapi.feature"));
    }

    private static HttpServletRequest request(String peer, String... forwardedFor) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/auth/guest");
        request.setRemoteAddr(peer);
        for (String line : forwardedFor) {
            request.addHeader("X-Forwarded-For", line);
        }
        return request;
    }
}
