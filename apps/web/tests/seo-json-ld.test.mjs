import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  buildMobileApplicationJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} = await import("../src/lib/seo/json-ld.ts");

const { APP_STORE_URL, GOOGLE_PLAY_URL } = await import(
  "../src/lib/app-download/store-links.ts"
);

const description =
  "내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연습 도구예요.";
const siteUrl = "https://example.com";

function containsUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsUndefined);
  }
  return false;
}

test("Organization은 고정 식별자와 공식 연락처를 제공한다", () => {
  const organization = buildOrganizationJsonLd(`${siteUrl}/`);

  assert.deepEqual(organization, {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#org`,
    name: "Acttub",
    url: `${siteUrl}/`,
    sameAs: [
      "https://www.instagram.com/acttub_com/",
      APP_STORE_URL,
      GOOGLE_PLAY_URL,
    ],
    email: "acttub0527@gmail.com",
  });
});

test("WebSite과 SoftwareApplication은 Organization 식별자를 publisher로 공유한다", () => {
  const website = buildWebSiteJsonLd(siteUrl);
  const application = buildSoftwareApplicationJsonLd(siteUrl);

  assert.deepEqual(website, {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: "Acttub",
    url: `${siteUrl}/`,
    inLanguage: "ko",
    publisher: { "@id": `${siteUrl}/#org` },
  });
  assert.deepEqual(application, {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#app`,
    name: "Acttub",
    url: `${siteUrl}/`,
    description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "KRW",
    },
    publisher: { "@id": `${siteUrl}/#org` },
  });
});

test("MobileApplication은 스토어별로 하나씩, 설치 주소를 달고 나온다", () => {
  const [ios, android] = buildMobileApplicationJsonLd(siteUrl);

  assert.equal(buildMobileApplicationJsonLd(siteUrl).length, 2);
  assert.deepEqual(ios, {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": `${siteUrl}/#app-ios`,
    name: "Acttub",
    url: `${siteUrl}/app`,
    description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "iOS",
    installUrl: APP_STORE_URL,
    downloadUrl: APP_STORE_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "KRW",
    },
    publisher: { "@id": `${siteUrl}/#org` },
  });
  assert.equal(android["@id"], `${siteUrl}/#app-android`);
  assert.equal(android.operatingSystem, "Android");
  assert.equal(android.installUrl, GOOGLE_PLAY_URL);
  assert.equal(android.downloadUrl, GOOGLE_PLAY_URL);
});

test("JSON-LD 결과는 undefined 없이 직렬화된다", () => {
  const values = [
    buildOrganizationJsonLd(siteUrl),
    buildWebSiteJsonLd(siteUrl),
    buildSoftwareApplicationJsonLd(siteUrl),
    ...buildMobileApplicationJsonLd(siteUrl),
  ];

  for (const value of values) {
    assert.equal(containsUndefined(value), false);
    assert.doesNotThrow(() => JSON.stringify(value));
  }
});
