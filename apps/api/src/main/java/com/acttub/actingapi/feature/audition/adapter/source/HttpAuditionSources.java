package com.acttub.actingapi.feature.audition.adapter.source;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.feature.audition.app.AuditionSources;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 출처의 목록 페이지·RSS 를 HTTP 로 받아 {@link AuditionParsers} 로 읽는다(app.audition 「규칙·제약」).
 *
 * <ul>
 *   <li>목록 페이지·RSS 만 연다. 상세 페이지는 열지 않는다.</li>
 *   <li>같은 출처에 보내는 요청 사이에 2초를 둔다. 출처당 요청은 {@value #MAX_PAGES} 쪽 이하다.</li>
 *   <li>User-Agent 에 {@code ActtubBot} 과 서비스 주소를 밝힌다.</li>
 * </ul>
 */
@Component
class HttpAuditionSources implements AuditionSources {

    static final String USER_AGENT = "Mozilla/5.0 (compatible; ActtubBot/1.0; +https://acttub.com)";
    static final int MAX_PAGES = 3;
    static final Duration GAP = Duration.ofSeconds(2);
    private static final Duration TIMEOUT = Duration.ofSeconds(20);

    /** 목록 페이지 하나를 문자열로. 테스트는 네트워크 대신 이것을 바꿔 끼운다. */
    @FunctionalInterface
    interface PageFetcher {
        String fetch(URI uri);
    }

    @FunctionalInterface
    interface Pause {
        void sleep(Duration duration);
    }

    private final PageFetcher fetcher;
    private final Pause pause;
    private final ObjectMapper json;

    @Autowired
    HttpAuditionSources(ObjectMapper json) {
        this(jdkFetcher(), HttpAuditionSources::sleep, json);
    }

    HttpAuditionSources(PageFetcher fetcher, Pause pause, ObjectMapper json) {
        this.fetcher = fetcher;
        this.pause = pause;
        this.json = json;
    }

    @Override
    public List<AuditionPosting> read(String source, LocalDate today) {
        return switch (source) {
            case "shinsee" -> AuditionParsers.shinsee(
                    fetcher.fetch(URI.create("https://www.iseensee.com/Home/Community/Audition.aspx")));
            case "emk" -> AuditionParsers.emk(
                    fetcher.fetch(URI.create("https://emkmusical.com/wp-content/plugins/kboard/rss.php")));
            case "sejong" -> AuditionParsers.sejong(fetcher.fetch(
                    URI.create("https://www.sejongpac.or.kr/portal/bbs/B0000065/list.do?menuNo=200571")));
            case "plfil" -> plfil();
            case "otr" -> otr(today);
            default -> throw new IllegalArgumentException("unknown audition source: " + source);
        };
    }

    private List<AuditionPosting> plfil() {
        AuditionParsers.PlfilPage first = AuditionParsers.plfil(
                fetcher.fetch(URI.create("https://plfil.com/casting")), json);
        List<AuditionPosting> all = new ArrayList<>(first.postings());
        for (int page = 2; page <= Math.min(first.totalPages(), MAX_PAGES); page++) {
            pause.sleep(GAP);
            all.addAll(AuditionParsers.plfil(
                    fetcher.fetch(URI.create("https://plfil.com/casting?page=" + page)), json).postings());
        }
        return AuditionParsers.unique(all);
    }

    private List<AuditionPosting> otr(LocalDate today) {
        List<AuditionPosting> all = new ArrayList<>();
        for (int page = 1; page <= MAX_PAGES; page++) {
            if (page > 1) {
                pause.sleep(GAP);
            }
            all.addAll(AuditionParsers.otr(fetcher.fetch(
                    URI.create("https://otr.co.kr/audition/?mode=list&board_page=" + page)), today));
        }
        return AuditionParsers.unique(all);
    }

    private static PageFetcher jdkFetcher() {
        HttpClient client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        return uri -> {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(TIMEOUT)
                    .header("User-Agent", USER_AGENT)
                    .GET()
                    .build();
            try {
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 != 2) {
                    throw new AuditionSourceFailure(uri.getHost() + " answered HTTP " + response.statusCode());
                }
                return response.body();
            } catch (IOException unreachable) {
                throw new AuditionSourceFailure(uri.getHost() + " did not answer", unreachable);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new AuditionSourceFailure(uri.getHost() + " request was interrupted", interrupted);
            }
        };
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AuditionSourceFailure("audition collect was interrupted", interrupted);
        }
    }
}
