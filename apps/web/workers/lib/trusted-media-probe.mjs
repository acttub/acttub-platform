import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const ISO_BMFF_METADATA_VERSION = "iso-bmff-duration.v1";
const MP4_BRANDS = new Set(["avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom", "m4v ", "mp41", "mp42"]);

const mediaError = (code, message, properties = {}) => Object.assign(new Error(`${code}: ${message}`), { code, ...properties });

export function parseDurationMs(value) {
  const match = typeof value === "string" && /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) throw mediaError("source_video_metadata_invalid", "ffprobe duration is invalid", { definitive: true });
  const seconds = BigInt(match[1]);
  const fraction = match[2] ?? "";
  const millisecondDigits = `${fraction}000`.slice(0, 3);
  const remainder = fraction.slice(3);
  const roundedFraction = BigInt(millisecondDigits) + (/[1-9]/u.test(remainder) ? 1n : 0n);
  const duration = seconds * 1000n + roundedFraction;
  if (duration < 1n || duration > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw mediaError("source_video_metadata_invalid", "ffprobe duration is out of range", { definitive: true });
  }
  return Number(duration);
}

export function validateProbeMetadata(payload, metadata) {
  const hasVideo = Array.isArray(payload?.streams) && payload.streams.some((stream) => stream?.codec_type === "video");
  const format = payload?.format;
  const brand = typeof format?.tags?.major_brand === "string" ? format.tags.major_brand.toLowerCase() : "";
  const formatNames = typeof format?.format_name === "string" ? format.format_name.split(",") : [];
  const extension = path.extname(metadata.fileName).toLowerCase();
  const expectsMov = extension === ".mov" && metadata.mimeType === "video/quicktime";
  const expectsMp4 = extension === ".mp4" && metadata.mimeType === "video/mp4";
  const brandMatches = expectsMov ? brand.trim() === "qt" : expectsMp4 && MP4_BRANDS.has(brand);
  if (!hasVideo || !formatNames.includes("mov") || !formatNames.includes("mp4") || !brandMatches) {
    throw mediaError("source_video_metadata_invalid", "container, extension, MIME, or video stream mismatch", { definitive: true });
  }
  return { durationMs: parseDurationMs(format.duration), mediaMetadataVersion: ISO_BMFF_METADATA_VERSION };
}

export async function assertFfprobeAvailable(ffprobePath = "ffprobe") {
  try {
    const { stdout } = await execFileAsync(ffprobePath, ["-version"], { encoding: "utf8", timeout: 10_000 });
    if (!/^ffprobe version /u.test(stdout)) throw new Error("unexpected ffprobe version output");
  } catch (error) {
    throw mediaError("ffprobe_unavailable", "ffprobe boot check failed", { cause: error });
  }
}

export async function probeTrustedMedia({ filePath, fileName, mimeType, ffprobePath = "ffprobe" }) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.killed) {
      throw mediaError("media_probe_unavailable", "ffprobe execution failed", { cause: error, retryable: true });
    }
    throw mediaError("source_video_metadata_invalid", "ffprobe rejected the media", { cause: error, definitive: true });
  }
  let payload;
  try { payload = JSON.parse(stdout); }
  catch (error) { throw mediaError("source_video_metadata_invalid", "ffprobe returned invalid JSON", { cause: error, definitive: true }); }
  return validateProbeMetadata(payload, { fileName, mimeType });
}

export async function stageAndProbeMedia({ body, fileName, mimeType, ffprobePath = "ffprobe", tempDir = os.tmpdir(), maxBytes }) {
  const filePath = path.join(tempDir, `acttub-analysis-${randomUUID()}${path.extname(fileName)}`);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(mediaError("video_too_large", "source exceeds the configured limit", { definitive: true }));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body), counter, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
    const probe = await probeTrustedMedia({ filePath, fileName, mimeType, ffprobePath });
    return { ...probe, bytes, filePath, stream: () => Readable.toWeb(createReadStream(filePath)) };
  } catch (error) {
    await unlink(filePath).catch(() => {});
    if (["video_too_large", "source_video_metadata_invalid", "media_probe_unavailable"].includes(error?.code)) throw error;
    throw mediaError("media_probe_unavailable", "media staging failed", { cause: error, retryable: true });
  }
}

export async function removeStagedMedia(filePath) {
  if (filePath) await unlink(filePath).catch(() => {});
}
