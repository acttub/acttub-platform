import { headers } from "next/headers";
import { cache } from "react";

import { entryShareMetadata } from "@/features/entry-share/entry-share";
import { EntrySharePage } from "@/features/entry-share/entry-share-page";
import { getPublicEntry } from "@/lib/api/v2/public-entry";

// 참여작 공유 링크(challenge.share). 앱이 공유하는 주소 <사이트>/e/<참여작 id> 를 메신저(카카오톡·iMessage)가
// 미리보기로 펼친다. 수집기는 JS 를 돌리지 않으므로 이 페이지만은 **요청마다 서버에서 렌더**한다 — 다른
// 화면처럼 프리렌더한 껍데기를 두면 og 태그에 참여작 정보가 실리지 않는다. 서버 로직은 없고 API 를 부를 뿐이다.
export const dynamic = "force-dynamic";

const API_TIMEOUT_MS = 3000;

// generateMetadata 와 page 가 같은 요청에서 한 번만 부르게 묶는다.
const lookupEntry = cache(async (id: string) => {
  const forwardedFor = (await headers()).get("x-forwarded-for");
  return getPublicEntry(id, {
    forwardedFor,
    // 수집기는 오래 기다리지 않는다. API 가 늦으면 공통 미리보기로 낸다.
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
});

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  return entryShareMetadata(id, await lookupEntry(id));
}

export default async function EntryShareRoute({ params }: Params) {
  const { id } = await params;
  return <EntrySharePage entryId={id} lookup={await lookupEntry(id)} />;
}
