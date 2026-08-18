package com.acttub.actingapi.platform.health;

import java.util.logging.Level;
import java.util.logging.Logger;

import org.springframework.scheduling.annotation.Scheduled;

/** initialDelay가 Python 루프의 첫 sleep을, fixedDelay가 이후 sleep을 보존한다. */
final class KeepAlivePinger {
    private static final Logger LOGGER = Logger.getLogger(KeepAlivePinger.class.getName());

    private final String target;
    private final PingClient client;

    KeepAlivePinger(String url, PingClient client) {
        this.target = url.replaceAll("/+$", "") + "/health";
        this.client = client;
    }

    @Scheduled(
            fixedDelayString = "#{@keepAliveIntervalMillis}",
            initialDelayString = "#{@keepAliveIntervalMillis}")
    void ping() {
        try {
            client.get(target);
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "keep-alive ping failed: " + target, exception);
        }
    }

    String target() {
        return target;
    }

    @FunctionalInterface
    interface PingClient {
        void get(String target);
    }
}
