export const MAX_VIDEO_DURATION_MS = 300_000;

export type MediaDurationErrorCode =
  | "INVALID_MEDIA_METADATA"
  | "UNSUPPORTED_MEDIA_METADATA"
  | "VIDEO_DURATION_REQUIRED"
  | "VIDEO_DURATION_EXCEEDED";

export class MediaDurationError extends Error {
  readonly code: MediaDurationErrorCode;

  constructor(code: MediaDurationErrorCode, message: string) {
    super(message);
    this.name = "MediaDurationError";
    this.code = code;
  }
}

type Box = { type: string; payloadStart: number; end: number };

const invalid = (message = "Media metadata is invalid."): never => {
  throw new MediaDurationError("INVALID_MEDIA_METADATA", message);
};

const unsupported = (): never => {
  throw new MediaDurationError(
    "UNSUPPORTED_MEDIA_METADATA",
    "Media metadata version is unsupported.",
  );
};

const readUint64 = (view: DataView, offset: number): bigint => {
  const high = BigInt(view.getUint32(offset));
  const low = BigInt(view.getUint32(offset + 4));
  return (high << BigInt(32)) | low;
};

const readBoxes = function* (
  bytes: Uint8Array,
  start: number,
  end: number,
): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;

  while (offset < end) {
    if (end - offset < 8) invalid();
    const size32 = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    let size: bigint;

    if (size32 === 1) {
      if (end - offset < 16) invalid();
      headerSize = 16;
      size = readUint64(view, offset + 8);
    } else if (size32 === 0) {
      size = BigInt(end - offset);
    } else {
      size = BigInt(size32);
    }

    if (size < BigInt(headerSize) || size > BigInt(end - offset)) invalid();
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
    const boxEnd = offset + Number(size);
    yield { type, payloadStart: offset + headerSize, end: boxEnd };
    offset = boxEnd;
  }
};

const durationFromMovieHeader = (bytes: Uint8Array, box: Box): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const available = box.end - box.payloadStart;
  if (available < 4) invalid();
  const version = view.getUint8(box.payloadStart);
  let timescale = 0;
  let duration = BigInt(0);

  if (version === 0) {
    if (available < 20) invalid();
    timescale = view.getUint32(box.payloadStart + 12);
    duration = BigInt(view.getUint32(box.payloadStart + 16));
  } else if (version === 1) {
    if (available < 32) invalid();
    timescale = view.getUint32(box.payloadStart + 20);
    duration = readUint64(view, box.payloadStart + 24);
  } else {
    return unsupported();
  }

  if (timescale === 0) invalid("Media timescale must be positive.");
  const scale = BigInt(timescale);
  const milliseconds =
    (duration * BigInt(1000) + scale / BigInt(2)) / scale;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(milliseconds);
};

export const parseIsoBmffDurationMs = (input: Uint8Array | ArrayBuffer): number => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 8) invalid();

  for (const box of readBoxes(bytes, 0, bytes.byteLength)) {
    if (box.type !== "moov") continue;
    for (const child of readBoxes(bytes, box.payloadStart, box.end)) {
      if (child.type === "mvhd") return durationFromMovieHeader(bytes, child);
    }
    invalid("Movie header metadata is missing.");
  }
  return invalid("Movie metadata is missing.");
};

export const validateVideoDurationMs = (
  durationMs: number,
  maximumMs = MAX_VIDEO_DURATION_MS,
): number => {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new MediaDurationError(
      "VIDEO_DURATION_REQUIRED",
      "A readable positive video duration is required.",
    );
  }
  if (durationMs > maximumMs) {
    throw new MediaDurationError(
      "VIDEO_DURATION_EXCEEDED",
      "Video duration exceeds the allowed limit.",
    );
  }
  return durationMs;
};
