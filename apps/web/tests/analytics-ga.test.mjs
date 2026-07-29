import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { isMeasuredHost, toDurationBucket, toTrackedPath, toTrackedReferrer } = await import(
  "../src/lib/analytics/ga.ts"
);

// dev 서버가 같은 정적 빌드를 서빙한다. 가드가 풀리면 개발 트래픽이 실서비스 통계에 섞여
// "몇 명이 왔나"를 못 믿게 된다.
test("실서비스 호스트에서만 계측한다", () => {
  assert.equal(isMeasuredHost("acttub.com"), true);
  assert.equal(isMeasuredHost("www.acttub.com"), true);
  assert.equal(isMeasuredHost("voice.acttub.com"), true);

  assert.equal(isMeasuredHost("localhost"), false);
  assert.equal(isMeasuredHost("127.0.0.1"), false);
  assert.equal(isMeasuredHost("dev.acttub.com.evil.com"), false);
  assert.equal(isMeasuredHost("notacttub.com"), false);
});

// 개인정보처리방침 v2 6항이 "주소에 연습 세션 식별자 등이 포함되는 경우 제거한 뒤
// 전송한다"고 약속한다. 이 함수가 그 약속을 지키는 지점이다.
test("주소에서 쿼리와 해시를 떼고 경로만 남긴다", () => {
  assert.equal(toTrackedPath("/home?session=1f0c8a2e-0000-4aaa-bbbb-cccccccccccc"), "/home");
  assert.equal(toTrackedPath("/practice/new?from=1f0c8a2e"), "/practice/new");
  assert.equal(toTrackedPath("/practice/history?session=a&next=/home"), "/practice/history");
  assert.equal(toTrackedPath("/terms#privacy"), "/terms");
  assert.equal(toTrackedPath("/login?next=/home#top"), "/login");
});

test("경로만 들어오면 그대로 두고, 앞의 슬래시는 보정한다", () => {
  assert.equal(toTrackedPath("/"), "/");
  assert.equal(toTrackedPath("/home"), "/home");
  assert.equal(toTrackedPath("home"), "/home");
});

// GA4는 page_referrer를 생략하면 document.referrer를 직접 읽는다. refresh.ts가
// /practice/history?session=<uuid> 에서 /login 으로 하드 이동하므로, 씻지 않으면
// 그 주소가 통째로 구글에 실려 나간다.
test("우리 사이트에서 온 referrer는 쿼리를 뗀다", () => {
  const origin = "https://acttub.com";
  assert.equal(
    toTrackedReferrer("https://acttub.com/practice/history?session=abc-123", origin),
    "https://acttub.com/practice/history",
  );
  assert.equal(toTrackedReferrer("https://acttub.com/home#x", origin), "https://acttub.com/home");
});

test("외부에서 온 referrer는 그대로 둔다 — 유입 경로가 거기 있다", () => {
  const origin = "https://acttub.com";
  assert.equal(
    toTrackedReferrer("https://link.acttub.com/?utm_source=bio", origin),
    "https://link.acttub.com/?utm_source=bio",
  );
  assert.equal(toTrackedReferrer("https://www.instagram.com/", origin), "https://www.instagram.com/");
});

test("referrer가 없거나 주소가 아니면 빈 문자열", () => {
  const origin = "https://acttub.com";
  assert.equal(toTrackedReferrer("", origin), "");
  assert.equal(toTrackedReferrer("javascript:alert(1)", origin), "");
});

// 계측 쿠키는 "이 빌드가 기대하는 버전의 방침에 동의한 기록"이 있을 때만 켜진다.
// 방침을 개정하고 이 상수를 안 올리면, 옛 버전 동의자의 쿠키가 그대로 유지된다.
test("기대하는 방침 버전이 발행 매니페스트와 같다", async () => {
  const { EXPECTED_PRIVACY_VERSION } = await import(
    "../src/features/auth/pending-consents.ts"
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../api/acting-api/consent_docs/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const privacy = manifest.find((item) => item.type === "privacy");

  assert.ok(privacy, "매니페스트에 privacy 문서가 있어야 한다");
  assert.equal(EXPECTED_PRIVACY_VERSION, privacy.version);
});

// 영상 길이를 원본 그대로 보내면 특정 연습을 짚어낼 수 있는 값이 된다. 구간 경계가
// 밀리면 조용히 원본에 가까운 값이 나가므로 경계값을 못박아 둔다.
test("영상 길이를 구간으로 뭉갠다", () => {
  assert.equal(toDurationBucket(0), "<30s");
  assert.equal(toDurationBucket(29_999), "<30s");
  assert.equal(toDurationBucket(30_000), "30-60s");
  assert.equal(toDurationBucket(59_999), "30-60s");
  assert.equal(toDurationBucket(60_000), "60-180s");
  assert.equal(toDurationBucket(179_999), "60-180s");
  assert.equal(toDurationBucket(180_000), "180s+");
  assert.equal(toDurationBucket(3_600_000), "180s+");
});

// 길이를 못 읽은 영상이 0초로 둔갑하면 "30초 미만"이 부풀어 실제와 다른 그림이 된다.
test("길이를 못 읽으면 구간 대신 unknown 이다", () => {
  assert.equal(toDurationBucket(Number.NaN), "unknown");
  assert.equal(toDurationBucket(Number.POSITIVE_INFINITY), "unknown");
  assert.equal(toDurationBucket(-1), "unknown");
});
