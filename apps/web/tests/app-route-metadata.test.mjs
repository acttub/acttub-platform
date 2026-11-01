// 검색엔진에 싣지 않는 화면(연습·리딩·보관함·결제 심사 등)이 실제로 내보내는 메타데이터. 탭 제목은
// 화면마다 다르고, 색인과 링크 따라가기는 모두 막는다. seo-noindex-guard 가 소스 모양을 본다면
// 여기서는 페이지 모듈을 불러 Next 가 읽을 값 그대로를 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";
import "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (specifier.endsWith(".css")) {
      return { url: "data:text/javascript,export default {};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const PRIVATE_PAGES = [
  ["auditions/page.tsx", "오디션 공고"],
  ["login/page.tsx", "로그인"],
  ["signup/page.tsx", "가입하기"],
  ["account/page.tsx", "내 계정·계정 삭제 안내"],
  ["terms/page.tsx", "안전 약속"],
  ["p/page.tsx", "포트폴리오"],
  ["pg-review/page.tsx", "ACTTUB Pro 테스트 결제 (심사용)"],
  ["pg-review/result/page.tsx", "ACTTUB Pro 테스트 결제 결과 (심사용)"],
  ["go/[os]/[surface]/page.tsx", "스토어로 이동 중"],
  ["go/[os]/[surface]/[source]/page.tsx", "스토어로 이동 중"],
];

for (const [page, title] of PRIVATE_PAGES) {
  test(`${page} 는 탭 제목 "${title}" 로 뜨고 색인되지 않는다`, async () => {
    const { metadata } = await import(`../src/app/${page}`);

    assert.deepEqual(metadata, { title, robots: { index: false, follow: false } });
  });
}
