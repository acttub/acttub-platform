import { Readable } from "node:stream";

const encoder = new TextEncoder();
const escapeQuoted = (value) => value.replace(/["\\\r\n]/gu, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, "0")}`);

export function createMultipartStream({ fields, video, fileName, mimeType }) {
  const boundary = `acttub-${crypto.randomUUID()}`;
  async function* parts() {
    for (const [name, value] of Object.entries(fields)) {
      yield encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(name)}"\r\n\r\n${value}\r\n`);
    }
    yield encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${escapeQuoted(fileName)}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    for await (const chunk of Readable.fromWeb(video)) yield chunk;
    yield encoder.encode(`\r\n--${boundary}--\r\n`);
  }
  return { boundary, body: Readable.toWeb(Readable.from(parts())) };
}
