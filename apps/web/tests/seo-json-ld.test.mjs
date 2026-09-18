import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  buildAdmissionsBreadcrumbJsonLd,
  buildAdmissionsWebPageJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildKeywordArticleJsonLd,
  buildMobileApplicationJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} = await import("../src/lib/seo/json-ld.ts");

const { AI_ACTING_COACHING } = await import(
  "../src/features/keyword-pages/content/ai-acting-coaching.ts"
);

const { APP_STORE_URL, GOOGLE_PLAY_URL } = await import(
  "../src/lib/app-download/store-links.ts"
);

const description =
  "AI 연기 코칭 앱 Acttub. 내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연기 연습 도구예요.";
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

test("키워드 FAQ는 화면 본문과 같은 문답을 모두 담는다", () => {
  const faq = buildFaqPageJsonLd(AI_ACTING_COACHING, siteUrl);

  assert.equal(faq["@id"], `${siteUrl}${AI_ACTING_COACHING.path}#faq`);
  assert.equal(faq.mainEntity.length, AI_ACTING_COACHING.faq.length);
  assert.deepEqual(faq.mainEntity[0], {
    "@type": "Question",
    name: AI_ACTING_COACHING.faq[0].question,
    acceptedAnswer: {
      "@type": "Answer",
      text: AI_ACTING_COACHING.faq[0].answer,
    },
  });
});

test("키워드 Article과 Breadcrumb는 페이지와 Organization을 잇는다", () => {
  assert.deepEqual(buildKeywordArticleJsonLd(AI_ACTING_COACHING, siteUrl), {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${siteUrl}${AI_ACTING_COACHING.path}#article`,
    headline: AI_ACTING_COACHING.h1,
    description: AI_ACTING_COACHING.description,
    inLanguage: "ko",
    dateModified: AI_ACTING_COACHING.updatedAt,
    mainEntityOfPage: `${siteUrl}${AI_ACTING_COACHING.path}`,
    author: { "@id": `${siteUrl}/#org` },
    publisher: { "@id": `${siteUrl}/#org` },
  });
  assert.deepEqual(buildBreadcrumbJsonLd(AI_ACTING_COACHING, siteUrl), {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${siteUrl}${AI_ACTING_COACHING.path}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: `${siteUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: AI_ACTING_COACHING.eyebrow,
        item: `${siteUrl}${AI_ACTING_COACHING.path}`,
      },
    ],
  });
});

test("JSON-LD 결과는 undefined 없이 직렬화된다", () => {
  const values = [
    buildOrganizationJsonLd(siteUrl),
    buildWebSiteJsonLd(siteUrl),
    buildSoftwareApplicationJsonLd(siteUrl),
    ...buildMobileApplicationJsonLd(siteUrl),
    buildFaqPageJsonLd(AI_ACTING_COACHING, siteUrl),
    buildKeywordArticleJsonLd(AI_ACTING_COACHING, siteUrl),
    buildBreadcrumbJsonLd(AI_ACTING_COACHING, siteUrl),
  ];

  for (const value of values) {
    assert.equal(containsUndefined(value), false);
    assert.doesNotThrow(() => JSON.stringify(value));
  }
});

test("입시 breadcrumb는 목록과 대학 상세 경로를 잇는다", () => {
  assert.deepEqual(
    buildAdmissionsBreadcrumbJsonLd(
      { id: "cau", name: "중앙대학교" },
      siteUrl,
    ).itemListElement,
    [
      { "@type": "ListItem", position: 1, name: "홈", item: `${siteUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "입시 정보",
        item: `${siteUrl}/admissions`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "중앙대학교",
        item: `${siteUrl}/admissions/cau`,
      },
    ],
  );
});

test("입시 상세 WebPage는 수정일과 WebSite 식별자를 담는다", () => {
  assert.deepEqual(
    buildAdmissionsWebPageJsonLd(
      {
        id: "cau",
        name: "중앙대학교 연기 입시 정보",
        description: "중앙대학교 입시 정보예요.",
        updatedAt: "2026-08-07",
      },
      siteUrl,
    ),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${siteUrl}/admissions/cau#webpage`,
      name: "중앙대학교 연기 입시 정보",
      description: "중앙대학교 입시 정보예요.",
      inLanguage: "ko",
      dateModified: "2026-08-07",
      url: `${siteUrl}/admissions/cau`,
      isPartOf: { "@id": `${siteUrl}/#website` },
      publisher: { "@id": `${siteUrl}/#org` },
    },
  );
});
