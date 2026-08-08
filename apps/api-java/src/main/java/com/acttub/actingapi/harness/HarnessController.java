package com.acttub.actingapi.harness;

import java.util.Collection;
import java.util.Map;

import com.acttub.actingapi.auth.FixedWindowRateLimiter;
import io.swagger.v3.oas.annotations.Hidden;
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

    public HarnessController(
            OffsettableClock clock,
            FixedWindowRateLimiter rateLimiter,
            DbProjectionService projection) {
        this.clock = clock;
        this.rateLimiter = rateLimiter;
        this.projection = projection;
    }

    @PostMapping("/{name}")
    public ResponseEntity<Map<String, Object>> control(
            @PathVariable String name,
            @RequestBody(required = false) Map<String, Object> payload) {
        Map<String, Object> body = payload == null ? Map.of() : payload;
        return switch (name) {
            case "advance-clock" -> ResponseEntity.ok(advanceClock(body));
            case "db-projection" -> ResponseEntity.ok(
                    projection.project(asCollection(body.get("include"))));
            case "reset-state" -> ResponseEntity.ok(resetState());
            default -> ResponseEntity.status(404).body(
                    Map.of("detail", "unknown control: " + name));
        };
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
        return Map.of("reset", true);
    }

    private static Collection<?> asCollection(Object value) {
        return value instanceof Collection<?> collection ? collection : null;
    }
}
