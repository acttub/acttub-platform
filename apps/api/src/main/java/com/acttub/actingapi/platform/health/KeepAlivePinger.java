package com.acttub.actingapi.platform.health;

import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.scheduling.annotation.Scheduled;

/** initialDelay가 Python 루프의 첫 sleep을, fixedDelay가 이후 sleep을 보존한다. */
final class KeepAlivePinger {
    private static final Logger LOGGER = Logger.getLogger(KeepAlivePinger.class.getName());

    private final String target;
    private final PingClient client;
    private final FailureReporter failureReporter;

    KeepAlivePinger(String url, PingClient client, FailureReporter failureReporter) {
        this.target = url.replaceAll("/+$", "") + "/health";
        this.client = client;
        this.failureReporter = failureReporter;
    }

    @Scheduled(
            fixedDelayString = "#{@keepAliveIntervalMillis}",
            initialDelayString = "#{@keepAliveIntervalMillis}")
    void ping() {
        try {
            client.get(target);
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "keep-alive ping failed: " + target, exception);
            failureReporter.report(
                    exception,
                    FailureKind.EXTERNAL,
                    new FailureContext("KeepAlivePinger.ping"));
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
