import "server-only";
import { Readable } from "node:stream";

const encoder = new TextEncoder();
const escapeQuoted = (value: string) => value.replace(/["\\\r\n]/gu, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, "0")}`);

export function createMultipartStream(input: { fields: Record<string, string>; video: ReadableStream<Uint8Array>; fileName: string; mimeType: string }) {
  const boundary = `acttub-${crypto.randomUUID()}`;
  async function* parts() {
    for (const [name, value] of Object.entries(input.fields)) {
      yield encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(name)}"\r\n\r\n${value}\r\n`);
    }
    yield encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${escapeQuoted(input.fileName)}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`);
    for await (const chunk of Readable.fromWeb(input.video as never)) yield chunk as Uint8Array;
    yield encoder.encode(`\r\n--${boundary}--\r\n`);
  }
  return { boundary, body: Readable.toWeb(Readable.from(parts())) as ReadableStream<Uint8Array> };
}
