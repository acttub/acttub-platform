package com.acttub.actingapi.feature.appversion.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 애플 공개 조회의 실제 응답 모양(11/25 확인 — 본문이 text/javascript)으로 본다. */
class AppStoreLookupTest {

    private HttpServer server;
    private final AtomicReference<String> query = new AtomicReference<>();
    private volatile int status = 200;
    private volatile String reply = "";

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/lookup", exchange -> {
            query.set(exchange.getRequestURI().getQuery());
            byte[] body = reply.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/javascript; charset=utf-8");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private AppStoreLookup lookup() {
        return new AppStoreLookup("http://127.0.0.1:" + server.getAddress().getPort() + "/lookup",
                "6793056855", "com.acttub.app", AppStoreLookup.builder());
    }

    @Test
    void 한국_App_Store_에_보이는_판을_읽는다() {
        reply = "\n\n\n{\n \"resultCount\":1,\n \"results\": [{\"bundleId\":\"com.acttub.app\",\"version\":\"1.1.2\","
                + "\"currentVersionReleaseDate\":\"2026-11-04T18:01:03Z\"}]\n}\n\n\n";

        assertThat(lookup().live()).contains(new AppVersion(1, 1, 2));
        assertThat(query.get()).isEqualTo("id=6793056855&country=kr");
    }

    @Test
    void 다른_앱이거나_결과가_하나가_아니거나_판을_못_읽으면_모른다() {
        reply = "{\"resultCount\":1,\"results\":[{\"bundleId\":\"com.other.app\",\"version\":\"9.0.0\"}]}";
        assertThat(lookup().live()).isEmpty();

        reply = "{\"resultCount\":0,\"results\":[]}";
        assertThat(lookup().live()).isEmpty();

        reply = "{\"resultCount\":1,\"results\":[{\"bundleId\":\"com.acttub.app\",\"version\":\"1.2 beta\"}]}";
        assertThat(lookup().live()).isEmpty();
    }

    @Test
    void 응답이_실패하거나_깨지면_모른다() {
        status = 503;
        reply = "{}";
        assertThat(lookup().live()).isEmpty();

        status = 200;
        reply = "<html>";
        assertThat(lookup().live()).isEmpty();
    }
}
