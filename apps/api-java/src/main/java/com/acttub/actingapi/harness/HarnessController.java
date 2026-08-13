package com.acttub.actingapi.harness;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

import com.acttub.actingapi.analysis.AnalysisWorker;
import com.acttub.actingapi.auth.FixedWindowRateLimiter;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Hidden
@RestController
@Profile("contract")
@RequestMapping("/__harness")
public class HarnessController {
    private final OffsettableClock clock;
    private final FixedWindowRateLimiter rateLimiter;
    private final DbProjectionService projection;
    private final AnalysisWorker worker;
    private final ContractStubState stubs;

    public HarnessController(
            OffsettableClock clock,
            FixedWindowRateLimiter rateLimiter,
            DbProjectionService projection,
            ObjectProvider<AnalysisWorker> worker,
            ContractStubState stubs) {
        this.clock = clock;
        this.rateLimiter = rateLimiter;
        this.projection = projection;
        this.worker = worker.getIfAvailable();
        this.stubs = stubs;
    }

    @PostMapping("/{name}")
    public ResponseEntity<Map<String, Object>> control(
            @PathVariable String name,
            @RequestBody(required = false) Map<String, Object> payload,
            HttpServletRequest request) {
        if (!isLoopback(request.getRemoteAddr())) {
            return ResponseEntity.status(404).body(Map.of("detail", "not found"));
        }
        Map<String, Object> body = payload == null ? Map.of() : payload;
        return switch (name) {
            case "run-worker-once" -> ResponseEntity.ok(
                    Map.of("processed", worker != null && worker.runOnce() ? 1 : 0));
            case "run-sweep" -> ResponseEntity.ok(runSweep());
            case "stub-state" -> ResponseEntity.ok(stubs.control(body));
            case "advance-clock" -> ResponseEntity.ok(advanceClock(body));
            case "db-projection" -> ResponseEntity.ok(
                    projection.project(asCollection(body.get("include"))));
            case "reset-state" -> ResponseEntity.ok(resetState());
            default -> ResponseEntity.status(404).body(
                    Map.of("detail", "unknown control: " + name));
        };
    }

    private Map<String, Object> runSweep() {
        if (worker == null) {
            return Map.of("expired_uploads", 0, "exhausted_operations", 0);
        }
        AnalysisWorker.SweepResult result = worker.sweep();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expired_uploads", result.expiredUploads());
        payload.put("exhausted_operations", result.exhaustedOperations());
        return payload;
    }

    private Map<String, Object> advanceClock(Map<String, Object> payload) {
        Object raw = payload.getOrDefault("seconds", 0);
        double seconds = ((Number) raw).doubleValue();
        long before = clock.offsetNanos();
        double offset = clock.advance(seconds);
        rateLimiter.advanceContractClock(clock.offsetNanos() - before);
        return Map.of("offset_sec", offset);
    }

    private Map<String, Object> resetState() {
        clock.reset();
        rateLimiter.reset();
        // 스텁 관측 상태도 함께 되돌린다. java 는 한 프로세스가 전 시나리오를 받으므로
        // 이것이 없으면 호출 수가 누적돼 baseline(시나리오마다 새 앱)과 어긋난다.
        stubs.reset();
        return Map.of("reset", true);
    }

    private static Collection<?> asCollection(Object value) {
        return value instanceof Collection<?> collection ? collection : null;
    }

    private static boolean isLoopback(String address) {
        try {
            return InetAddress.getByName(address).isLoopbackAddress();
        } catch (UnknownHostException exception) {
            return false;
        }
    }
}
