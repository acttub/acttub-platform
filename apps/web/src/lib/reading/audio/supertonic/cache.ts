/**
 * 모델 가중치 캐시. 138MB 를 매번 받게 둘 수는 없다.
 *
 * onnxruntime 에 URL 을 넘기면 자기가 알아서 받지만 그러면 진행률도 캐시도 우리 손을 떠난다.
 * 그래서 직접 받아서 Cache API 에 넣고, 바이트를 런타임에 건네준다.
 */

const CACHE_NAME = "supertonic-3-int8-v1";

/** 캐시 API 가 없는 환경(사파리 사생활 보호 모드 등)에서도 그냥 네트워크로 동작해야 한다. */
async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export interface FetchProgress {
  /** 지금까지 받은 바이트 */
  loaded: number;
  /** 전체 바이트 — 서버가 알려주지 않으면 예상치 */
  total: number;
  /** 캐시에서 즉시 꺼냈으면 true (네트워크를 타지 않았다) */
  cached: boolean;
}

/**
 * 캐시에 있으면 캐시에서, 없으면 받으면서 진행률을 흘려보낸다.
 * 받은 것은 캐시에 넣지만, 캐시 쓰기가 실패해도(용량 초과 등) 데이터는 그대로 돌려준다.
 */
export async function fetchModel(
  url: string,
  expectedBytes: number,
  onProgress?: (p: FetchProgress) => void,
): Promise<Uint8Array> {
  const cache = await openCache();

  const hit = await cache?.match(url);
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, cached: true });
    return buf;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`모델을 받지 못했다 (${res.status}): ${url}`);

  const total = Number(res.headers.get("content-length")) || expectedBytes;
  const body = res.body;

  // 스트림을 못 쓰면 통째로 받는다 — 진행률만 잃고 결과는 같다.
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, cached: false });
    await put(cache, url, buf);
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, cached: false });
  }

  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }

  await put(cache, url, out);
  return out;
}

async function put(cache: Cache | null, url: string, bytes: Uint8Array) {
  if (!cache) return;
  try {
    // 복사본을 넘긴다 — 캐시가 원본 버퍼를 가져가면 런타임이 쓸 게 없어진다.
    await cache.put(url, new Response(bytes.slice().buffer));
  } catch {
    // 저장 공간이 없으면 캐시는 포기하고 이번 실행분으로 넘어간다.
  }
}

/** 받아 둔 모델이 있는지 — "다운로드 필요" 안내를 띄울지 판단하는 데 쓴다. */
export async function isCached(urls: string[]): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  const hits = await Promise.all(urls.map((u) => cache.match(u)));
  return hits.every(Boolean);
}

/** 사용자가 저장 공간을 되찾고 싶을 때. */
export async function clearModelCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // 지우지 못해도 알릴 것이 없다.
  }
}
