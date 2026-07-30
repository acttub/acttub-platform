import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  isMeasuredHost,
  startAnalytics,
  toDurationBucket,
  toTrackedLocation,
  toTrackedPath,
  toTrackedQuery,
  toTrackedReferrer,
  trackPageView,
} = await import("../src/lib/analytics/ga.ts");

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

// GA4는 캠페인을 page_location 의 쿼리에서만 읽는다. 이걸 떨어뜨리면 서브프로젝트 6개가
// UTM 을 달아 보내도 전부 direct 로 잡혀 "어느 채널이 가입을 만들었나"를 못 센다.
// 방침 v2 6항이 수집 항목으로 "유입 경로(직전 사이트·캠페인 정보)"를 적어 둔 값이다.
test("캠페인 파라미터는 남긴다", () => {
  assert.equal(
    toTrackedQuery("?utm_source=instagram&utm_medium=social&utm_campaign=reels_r7"),
    "?utm_source=instagram&utm_medium=social&utm_campaign=reels_r7",
  );
  assert.equal(toTrackedQuery("?gclid=abc123"), "?gclid=abc123");
  assert.equal(toTrackedQuery("?gad_source=1"), "?gad_source=1");
  // 물음표가 있든 없든 같게 읽는다.
  assert.equal(toTrackedQuery("utm_source=bio"), "?utm_source=bio");
});

// fbclid·msclkid·ttclid 는 캠페인 이름이 아니라 클릭 하나를 가리키는 식별자이고 GA4 는
// 읽지도 않는다. 인스타에서 들어오면 fbclid 가 자동으로 붙으므로 실수로 넣기 쉽다 —
// 넣으면 얻는 것 없이 남의 클릭 식별자를 구글로 넘기게 된다.
test("남의 클릭 식별자는 통과시키지 않는다", () => {
  assert.equal(toTrackedQuery("?fbclid=IwAR0abc"), "");
  assert.equal(toTrackedQuery("?msclkid=abc"), "");
  assert.equal(toTrackedQuery("?ttclid=abc"), "");
  assert.equal(toTrackedQuery("?utm_source=instagram&fbclid=IwAR0abc"), "?utm_source=instagram");
});

// 허용 목록이라 모르는 이름은 전부 버린다 — 나중에 새 쿼리가 생겨도 자동으로 걸러진다.
test("캠페인이 아닌 파라미터는 버린다", () => {
  assert.equal(toTrackedQuery("?session=1f0c8a2e-0000-4aaa-bbbb-cccccccccccc"), "");
  assert.equal(toTrackedQuery("?next=/practice/history"), "");
  assert.equal(toTrackedQuery("?code=4/0AY0e&state=xyz"), "");
  assert.equal(toTrackedQuery(""), "");
  assert.equal(toTrackedQuery("?"), "");
});

// 섞여 들어오는 게 실제 상황이다: 인스타 링크로 들어와 로그인 리다이렉트를 거치면
// 캠페인과 내부 식별자가 한 주소에 같이 실린다.
test("섞여 있으면 캠페인만 남기고 식별자는 버린다", () => {
  assert.equal(
    toTrackedQuery("?utm_source=instagram&session=1f0c8a2e-0000-4aaa-bbbb-cccccccccccc&next=/home"),
    "?utm_source=instagram",
  );
});

test("보낼 주소는 씻은 경로에 캠페인만 붙인다", () => {
  const origin = "https://acttub.com";
  assert.equal(
    toTrackedLocation(origin, "/", "?utm_source=instagram&utm_medium=social"),
    "https://acttub.com/?utm_source=instagram&utm_medium=social",
  );
  assert.equal(
    toTrackedLocation(origin, "/practice/history", "?session=abc-123"),
    "https://acttub.com/practice/history",
  );
  assert.equal(toTrackedLocation(origin, "/home", ""), "https://acttub.com/home");
});

/** gtag 큐만 관찰할 수 있으면 되는 최소 브라우저. */
function withFakeBrowser(href, run) {
  const url = new URL(href);
  const fakeWindow = {
    location: {
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
    },
  };
  globalThis.window = fakeWindow;
  globalThis.document = {
    referrer: "",
    title: "테스트 화면",
    head: { appendChild() {} },
    createElement: () => ({}),
  };
  try {
    return run(fakeWindow);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

// 순수 함수만 검증하면 호출부가 주소를 다시 손으로 조립해도 테스트가 통과한다 —
// 이 버그가 생긴 경로가 정확히 그것이었다. 그래서 gtag 큐에 실제로 실린 값을 본다.
// startAnalytics 는 모듈 안에 "한 번만" 플래그가 있어 이 파일에서 여기서만 부른다.
test("config 와 page_view 가 실제로 씻은 주소를 싣는다", () => {
  withFakeBrowser(
    "https://acttub.com/?utm_source=instagram&session=1f0c8a2e-0000-4aaa-bbbb-cccccccccccc",
    (win) => {
      startAnalytics();
      trackPageView("/");

      const commands = win.dataLayer.map((args) => Array.from(args));
      const expected = "https://acttub.com/?utm_source=instagram";

      const config = commands.find(([command]) => command === "config");
      assert.ok(config, "config 명령이 큐에 있어야 한다");
      assert.equal(config[2].page_location, expected);

      const pageView = commands.find(
        ([command, name]) => command === "event" && name === "page_view",
      );
      assert.ok(pageView, "page_view 이벤트가 큐에 있어야 한다");
      assert.equal(pageView[2].page_location, expected);
      // 화면별 통계는 경로로만 센다.
      assert.equal(pageView[2].page_path, "/");
    },
  );
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
