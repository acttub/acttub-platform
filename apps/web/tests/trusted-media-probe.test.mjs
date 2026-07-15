import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertFfprobeAvailable,
  parseDurationMs,
  probeTrustedMedia,
  stageAndProbeMedia,
  validateProbeMetadata,
} from "../workers/lib/trusted-media-probe.mjs";

const fixtures = path.resolve(import.meta.dirname, "fixtures/media");

test("decimal duration parsing is conservative at the 180-second boundary", () => {
  assert.equal(parseDurationMs("180.000000"), 180_000);
  assert.equal(parseDurationMs("180.000001"), 180_001);
  assert.equal(parseDurationMs("180.001000"), 180_001);
  assert.equal(parseDurationMs("0.001000"), 1);
  assert.throws(() => parseDurationMs("NaN"), /source_video_metadata_invalid/);
});

test("temporary filesystem failures map to stable retryable media_probe_unavailable", async () => {
  await assert.rejects(
    stageAndProbeMedia({
      body: new Response(new Uint8Array([1])).body,
      fileName: "take.mp4",
      mimeType: "video/mp4",
      tempDir: path.join(fixtures, "missing-directory"),
      maxBytes: 10,
    }),
    (error) => error?.code === "media_probe_unavailable" && error?.retryable === true,
  );
});

test("metadata validation requires video and matching extension, MIME, and ISO-BMFF brand", () => {
  const base = {
    streams: [{ codec_type: "video" }],
    format: { duration: "179.999000", format_name: "mov,mp4,m4a,3gp,3g2,mj2", tags: { major_brand: "isom" } },
  };
  assert.deepEqual(validateProbeMetadata(base, { fileName: "take.mp4", mimeType: "video/mp4" }), {
    durationMs: 179_999,
    mediaMetadataVersion: "iso-bmff-duration.v1",
  });
  assert.throws(
    () => validateProbeMetadata(base, { fileName: "take.mov", mimeType: "video/quicktime" }),
    /source_video_metadata_invalid/,
  );
  assert.throws(
    () => validateProbeMetadata({ ...base, streams: [{ codec_type: "audio" }] }, { fileName: "take.mp4", mimeType: "video/mp4" }),
    /source_video_metadata_invalid/,
  );
});

test("pinned ffprobe probes real boundary, forged-duration, mismatch, and corrupt fixtures", {
  skip: process.env.G011_RUN_REAL_PROBE !== "1" && "set G011_RUN_REAL_PROBE=1 with ANALYSIS_WORKER_FFPROBE_PATH",
}, async () => {
  const ffprobePath = process.env.ANALYSIS_WORKER_FFPROBE_PATH;
  await assertFfprobeAvailable(ffprobePath);
  const exact = await probeTrustedMedia({ filePath: path.join(fixtures, "valid-180000ms.mp4"), fileName: "take.mp4", mimeType: "video/mp4", ffprobePath });
  assert.equal(exact.durationMs, 180_000);
  const over = await probeTrustedMedia({ filePath: path.join(fixtures, "valid-180001ms.mp4"), fileName: "take.mp4", mimeType: "video/mp4", ffprobePath });
  assert.equal(over.durationMs, 180_001);
  const forged = await probeTrustedMedia({ filePath: path.join(fixtures, "valid-600000ms.mp4"), fileName: "take.mp4", mimeType: "video/mp4", ffprobePath });
  assert.equal(forged.durationMs, 600_000);
  await assert.rejects(
    probeTrustedMedia({ filePath: path.join(fixtures, "mov-brand-as-mp4.mp4"), fileName: "take.mp4", mimeType: "video/mp4", ffprobePath }),
    /source_video_metadata_invalid/,
  );
  await assert.rejects(
    probeTrustedMedia({ filePath: path.join(fixtures, "mp4-brand-as-mov.mov"), fileName: "take.mov", mimeType: "video/quicktime", ffprobePath }),
    /source_video_metadata_invalid/,
  );
  await assert.rejects(
    probeTrustedMedia({ filePath: path.join(fixtures, "corrupt-truncated.mp4"), fileName: "take.mp4", mimeType: "video/mp4", ffprobePath }),
    /source_video_metadata_invalid/,
  );
});
