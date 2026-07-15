// @ts-expect-error Node's direct TypeScript loader requires the source extension.
import { PRACTICE_INPUT_LIMITS } from "../../lib/practice/input-limits.ts";

export class BoundedJsonError extends Error {
  readonly status = 413;
  readonly code = "payload_too_large";

  constructor() {
    super("JSON request body must not exceed 64 KiB.");
    this.name = "BoundedJsonError";
  }
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > PRACTICE_INPUT_LIMITS.jsonBodyBytes) {
      await reader.cancel();
      throw new BoundedJsonError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
