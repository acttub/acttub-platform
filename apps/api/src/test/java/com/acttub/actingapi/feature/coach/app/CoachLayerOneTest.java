package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.observation.LayerOneObserver;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CoachLayerOneTest {
    @TempDir
    Path dir;

    @Test
    void armIsStableAndRoughlyHalf() {
        try (var layer = new CoachLayerOne((v, m, s, p, u) -> "", 50, null)) {
            int on = 0;
            for (int i = 0; i < 2000; i++) {
                UUID id = UUID.randomUUID();
                assertThat(layer.arm(id)).isEqualTo(layer.arm(id));
                if (CoachLayerOne.ON.equals(layer.arm(id))) on++;
            }
            assertThat(on).isBetween(850, 1150);
        }
    }

    @Test
    void zeroShareOrNoObserverIsOff() {
        UUID id = UUID.randomUUID();
        try (var none = new CoachLayerOne(null, 50, null); var zero = new CoachLayerOne((v, m, s, p, u) -> "x", 0, null)) {
            assertThat(none.arm(id)).isEqualTo(CoachLayerOne.OFF);
            assertThat(zero.arm(id)).isEqualTo(CoachLayerOne.OFF);
            assertThat(CoachLayerOne.NONE.ready(id)).isEmpty();
        }
    }

    @Test
    void readyOnlyAfterObservationFinishesAndCopyIsRemoved() throws Exception {
        Path video = Files.writeString(dir.resolve("v.mp4"), "video");
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        Path[] seen = new Path[1];
        LayerOneObserver observer = (v, mime, scene, practice, user) -> {
            calls.incrementAndGet();
            seen[0] = v;
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return "## 1층 관찰\n" + scene;
        };
        try (var layer = new CoachLayerOne(observer, 100, null)) {
            UUID id = UUID.randomUUID();
            layer.start(id, null, video, "video/mp4", new CoachLayerOne.Scene("상황", ".", "목표"));
            layer.start(id, null, video, "video/mp4", null);
            assertThat(layer.ready(id)).isEmpty();
            assertThat(layer.pending(id)).isTrue();
            release.countDown();
            for (int i = 0; i < 100 && layer.ready(id).isEmpty(); i++) Thread.sleep(20);
            assertThat(layer.ready(id)).isEqualTo("## 1층 관찰\n상황 / 목표");
            assertThat(calls).hasValue(1);
            assertThat(seen[0]).isNotEqualTo(video).doesNotExist();
            assertThat(video).exists();
        }
    }

    @Test
    void failureGivesEmptyBlock() throws Exception {
        Path video = Files.writeString(dir.resolve("v.mp4"), "video");
        try (var layer = new CoachLayerOne((v, m, s, p, u) -> { throw new IllegalStateException("boom"); }, 100, null)) {
            UUID id = UUID.randomUUID();
            layer.start(id, null, video, "video/mp4", null);
            for (int i = 0; i < 100 && layer.pending(id); i++) Thread.sleep(20);
            assertThat(layer.pending(id)).isFalse();
            assertThat(layer.ready(id)).isEmpty();
        }
    }

    @Test
    void proActorGetsLayerOneEvenWhenShareIsZero() throws Exception {
        java.util.UUID proUser = java.util.UUID.randomUUID();
        java.util.UUID freeUser = java.util.UUID.randomUUID();
        CoachPro pro = proUser::equals;
        try (var layer = new CoachLayerOne((v, m, s, p, u) -> "## 1층 관찰\nseen", 0, null, pro)) {
            java.util.UUID practice = java.util.UUID.randomUUID();
            assertThat(layer.arm(practice, proUser)).isEqualTo(CoachLayerOne.PRO);
            assertThat(layer.arm(practice, freeUser)).isEqualTo(CoachLayerOne.OFF);
            assertThat(CoachLayerOne.on(CoachLayerOne.PRO)).isTrue();
            assertThat(CoachLayerOne.on(CoachLayerOne.OFF)).isFalse();
            java.nio.file.Path video = java.nio.file.Files.createTempFile("pro-layer1-", ".mp4");
            try {
                layer.start(practice, proUser, video, "video/mp4", null);
                java.util.UUID other = java.util.UUID.randomUUID();
                layer.start(other, freeUser, video, "video/mp4", null);
                long until = System.nanoTime() + 5_000_000_000L;
                while (layer.ready(practice).isEmpty() && System.nanoTime() < until) Thread.sleep(20);
                assertThat(layer.ready(practice)).contains("1층 관찰");
                assertThat(layer.pending(other)).isFalse();
                assertThat(layer.ready(other)).isEmpty();
            } finally {
                java.nio.file.Files.deleteIfExists(video);
            }
        }
    }

    @Test
    void brokenProCheckCountsAsFree() {
        CoachPro broken = userId -> { throw new IllegalStateException("db down"); };
        try (var layer = new CoachLayerOne((v, m, s, p, u) -> "x", 0, null, broken)) {
            assertThat(layer.arm(java.util.UUID.randomUUID(), java.util.UUID.randomUUID())).isEqualTo(CoachLayerOne.OFF);
        }
    }
}
