package com.acttub.actingapi.platform.security;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * IP 제한의 열쇠가 되는 <b>방문자 주소</b>를 구하는 한 자리 (account.guest · account.portfolio, SOMA-528 결정 I-8).
 *
 * <p>배포 경로는 방문자 → Cloudflare → cloudflared → web(Next rewrites) → api 다. api 가 보는 상대
 * ({@code getRemoteAddr})는 언제나 web 컨테이너라, 그것을 열쇠로 쓰면 모든 방문자가 한 칸을 나눠 쓴다 —
 * 서로 다른 방문자 열한 명 가운데 열한 번째가 "한 IP 에서 시간당 10개"에 걸린다.
 *
 * <p><b>규칙</b>: 연결한 상대가 <b>신뢰하는 프록시</b>일 때만 {@code X-Forwarded-For} 를 보고, 오른쪽부터
 * 신뢰하는 프록시를 건너뛴 첫 주소를 방문자로 본다. 그 밖에는 연결한 상대의 주소다.
 *
 * <ul>
 *   <li>방문자가 위조해 보낸 값은 프록시가 덧붙인 진짜 주소의 <b>왼쪽</b>에 온다. 오른쪽부터 읽으므로 위조한
 *       값으로 제한을 피하지도, 남의 주소를 막지도 못한다.</li>
 *   <li>신뢰하지 않는 상대가 직접 붙인 헤더는 보지 않는다.</li>
 *   <li>주소가 아닌 값은 <b>풀지 않는다</b>(이름 조회를 하지 않는다). 사슬이 끊긴 것으로 보고 연결한 상대로
 *       돌아간다. 헤더가 없을 때(로컬 개발)도 같다.</li>
 * </ul>
 *
 * <p>⚠ <b>web 은 헤더를 그대로 넘긴다</b> — Next 16.2.10 의 rewrite 는 {@code X-Forwarded-For} 를 덧붙이지도
 * 새로 만들지도 않는다(실측). 그래서 이 규칙이 서려면 <b>web 이 Cloudflare 를 거친 요청만 받아야 한다</b>
 * (Compose 는 web 의 포트를 밖으로 열지 않는다, docs/deploy/DEPLOY-HOME.md). web 을 직접 여는 길이 생기면 그
 * 길의 방문자는 헤더를 마음대로 쓸 수 있다.
 *
 * <p>Tomcat 의 {@code RemoteIpValve}({@code server.forward-headers-strategy}) 대신 여기서 구하는 까닭: 밸브는
 * 주소만이 아니라 scheme·host·port 까지 전달 헤더로 덮어 모든 요청에 영향을 주는데, 이 서버는 그것들을
 * 헤더로 판정하지 않기로 했다(apps/api/CONTRACT.md §6-4). 쓰임이 제한의 열쇠 하나라 영향 범위를 그만큼으로
 * 두고, MockMvc 계약 테스트가 그대로 이 규칙을 지난다(밸브는 실제 Tomcat 에서만 돈다).
 *
 * <p>{@code CF-Connecting-IP} 는 보지 않는다. Cloudflare 를 거친 요청에서는 {@code X-Forwarded-For} 의 맨
 * 오른쪽과 같은 값이고, 출처를 둘로 두면 Cloudflare 를 거치지 않는 길(로컬·다른 엣지)에서 믿을 헤더만 하나
 * 더 늘어난다.
 */
@Component
public class ClientAddress {
    /** 같은 호스트·같은 Docker 네트워크·사설망의 직전 홉. 공인 주소의 프록시는 설정으로 더한다. */
    private static final String PRIVATE_NETWORKS =
            "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,::1/128,fc00::/7,fe80::/10";

    private static final Pattern IPV4 = Pattern.compile("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");
    private static final Pattern IPV6 = Pattern.compile("[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*");
    private static final String FORWARDED_FOR = "X-Forwarded-For";

    private final List<Network> trustedProxies;

    /**
     * @param trustedProxies 쉼표로 가른 CIDR({@code CLIENT_IP_TRUSTED_PROXIES}). 비어 있으면 사설 대역과 루프백,
     *        {@code none} 이면 아무도 믿지 않는다(언제나 연결한 상대의 주소)
     */
    public ClientAddress(@Value("${CLIENT_IP_TRUSTED_PROXIES:}") String trustedProxies) {
        String configured = trustedProxies == null ? "" : trustedProxies.strip();
        if ("none".equalsIgnoreCase(configured)) {
            this.trustedProxies = List.of();
            return;
        }
        List<Network> networks = new ArrayList<>();
        for (String cidr : (configured.isEmpty() ? PRIVATE_NETWORKS : configured).split(",")) {
            networks.add(Network.parse(cidr.strip()));
        }
        this.trustedProxies = List.copyOf(networks);
    }

    /** 제한의 열쇠로 쓸 방문자 주소. 같은 주소의 다른 표기는 같은 값이 된다. */
    public String of(HttpServletRequest request) {
        String peerText = request.getRemoteAddr();
        if (peerText == null) {
            return "unknown";
        }
        InetAddress peer = literal(peerText);
        if (peer == null) {
            return peerText;
        }
        if (!trusted(peer)) {
            return peer.getHostAddress();
        }
        List<String> hops = forwardedFor(request);
        for (int index = hops.size() - 1; index >= 0; index--) {
            InetAddress hop = literal(hops.get(index));
            if (hop == null) {
                break;
            }
            if (!trusted(hop)) {
                return hop.getHostAddress();
            }
        }
        return peer.getHostAddress();
    }

    /** 헤더가 여러 줄이어도 받은 순서대로 한 사슬이다. */
    private static List<String> forwardedFor(HttpServletRequest request) {
        Enumeration<String> lines = request.getHeaders(FORWARDED_FOR);
        if (lines == null) {
            return List.of();
        }
        List<String> hops = new ArrayList<>();
        for (String line : Collections.list(lines)) {
            for (String hop : line.split(",", -1)) {
                hops.add(hop.strip());
            }
        }
        return hops;
    }

    private boolean trusted(InetAddress address) {
        return trustedProxies.stream().anyMatch(network -> network.contains(address));
    }

    /**
     * 주소 글자만 읽는다. {@link InetAddress#getByName} 은 주소가 아닌 글자를 <b>이름으로 조회</b>하므로, 모양을
     * 먼저 확인해 방문자가 보낸 값으로 DNS 를 부르는 일이 없게 한다.
     */
    private static InetAddress literal(String text) {
        var ipv4 = IPV4.matcher(text);
        boolean shaped = ipv4.matches()
                ? java.util.stream.IntStream.rangeClosed(1, 4).allMatch(group -> Integer.parseInt(ipv4.group(group)) <= 255)
                : IPV6.matcher(text).matches();
        if (!shaped) {
            return null;
        }
        try {
            return InetAddress.getByName(text);
        } catch (UnknownHostException malformed) {
            return null;
        }
    }

    private record Network(byte[] prefix, int bits) {

        static Network parse(String cidr) {
            int slash = cidr.indexOf('/');
            InetAddress base = literal(slash < 0 ? cidr : cidr.substring(0, slash));
            if (base == null) {
                throw new IllegalArgumentException("CLIENT_IP_TRUSTED_PROXIES has a value that is not a CIDR: " + cidr);
            }
            int width = base.getAddress().length * 8;
            int bits = slash < 0 ? width : Integer.parseInt(cidr.substring(slash + 1));
            if (bits < 0 || bits > width) {
                throw new IllegalArgumentException("CLIENT_IP_TRUSTED_PROXIES has a prefix out of range: " + cidr);
            }
            return new Network(base.getAddress(), bits);
        }

        boolean contains(InetAddress address) {
            byte[] candidate = address.getAddress();
            if (candidate.length != prefix.length) {
                return false;
            }
            for (int bit = 0; bit < bits; bit++) {
                int mask = 0x80 >> (bit % 8);
                if ((candidate[bit / 8] & mask) != (prefix[bit / 8] & mask)) {
                    return false;
                }
            }
            return true;
        }
    }
}
