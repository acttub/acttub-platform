import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = join(testDirectory, "..");
const apiV1Root = join(webRoot, "src", "app", "api", "v1");
const openApiPath = join(webRoot, "src", "lib", "api", "openapi.json");
const docsRoutePath = join(webRoot, "src", "app", "api", "docs", "route.ts");
const docsAssetRoutePath = join(
  webRoot,
  "src",
  "app",
  "api",
  "docs",
  "assets",
  "[asset]",
  "route.ts",
);
const documentRoutePath = join(
  webRoot,
  "src",
  "app",
  "api",
  "openapi.json",
  "route.ts",
);
const swaggerAssetConfigPath = join(
  webRoot,
  "src",
  "lib",
  "api",
  "swagger-ui-assets.ts",
);
const openApiDocument = JSON.parse(readFileSync(openApiPath, "utf8"));
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

function routePath(filePath) {
  const segments = relative(apiV1Root, dirname(filePath))
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[([^\]]+)\]$/, "{$1}"));

  return ["/api/v1", ...segments].join("/");
}

function exportedMethods(source) {
  const methods = new Set();
  const functionPattern =
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  const reexportPattern = /export\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(functionPattern)) methods.add(match[1]);

  for (const match of source.matchAll(reexportPattern)) {
    for (const name of match[1].split(",").map((item) => item.trim())) {
      if (httpMethods.has(name)) methods.add(name);
    }
  }

  return methods;
}

function resolveJsonPointer(document, pointer) {
  assert.match(pointer, /^#\//, "Only local OpenAPI references are allowed");
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, part) => value?.[part], document);
}

test("OpenAPI document covers every implemented v1 Route Handler method", () => {
  const implemented = new Set();

  for (const filePath of routeFiles(apiV1Root)) {
    const path = routePath(filePath);
    const source = readFileSync(filePath, "utf8");
    const methods = exportedMethods(source);

    assert.ok(methods.size > 0, "No exported HTTP method found in " + filePath);
    for (const method of methods) {
      const operation = openApiDocument.paths[path]?.[method.toLowerCase()];
      assert.ok(operation, method + " " + path + " is missing from OpenAPI");
      implemented.add(method + " " + path);
    }
  }

  for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
    for (const method of httpMethods) {
      if (pathItem[method.toLowerCase()]) {
        assert.ok(
          implemented.has(method + " " + path),
          "OpenAPI documents an unimplemented operation: " + method + " " + path,
        );
      }
    }
  }
});

test("OpenAPI operation IDs and local references are valid", () => {
  assert.equal(openApiDocument.openapi, "3.1.0");
  assert.deepEqual(openApiDocument.servers, [
    { url: "/", description: "현재 Acttub 출처" },
  ]);
  assert.deepEqual(openApiDocument.security, [
    { supabaseBrowserSession: [] },
  ]);
  assert.deepEqual(
    openApiDocument.paths["/api/v1/auth/session"].get.security,
    [],
  );
  assert.equal(
    openApiDocument.components.securitySchemes.supabaseBrowserSession.in,
    "cookie",
  );

  const operationIds = [];
  for (const pathItem of Object.values(openApiDocument.paths)) {
    for (const method of httpMethods) {
      const operation = pathItem[method.toLowerCase()];
      if (operation) operationIds.push(operation.operationId);
    }
  }

  assert.equal(new Set(operationIds).size, operationIds.length);

  const stack = [openApiDocument];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    if (typeof value.$ref === "string") {
      assert.ok(
        resolveJsonPointer(openApiDocument, value.$ref),
        "Broken ref: " + value.$ref,
      );
    }

    stack.push(...Object.values(value));
  }
});

test("compatibility API aliases are visibly deprecated", () => {
  const aliases = [
    ["/api/v1/practice-sessions/{sessionId}/summary", "post"],
    ["/api/v1/practice-sessions/{sessionId}/video-url", "get"],
    ["/api/v1/practice-sessions/{sessionId}/hide", "post"],
    ["/api/v1/sessions", "post"],
    ["/api/v1/sessions/{sessionId}", "get"],
    ["/api/v1/sessions/{sessionId}/observations/{observationId}", "patch"],
    ["/api/v1/sessions/{sessionId}/turns", "post"],
    ["/api/v1/sessions/{sessionId}/summary", "post"],
  ];

  for (const [path, method] of aliases) {
    const operation = openApiDocument.paths[path][method];
    assert.equal(operation.deprecated, true, method.toUpperCase() + " " + path);
    assert.deepEqual(operation.tags, ["호환 API"]);
  }
});

test("documented runtime edge cases match the current services", () => {
  const createSession =
    openApiDocument.paths["/api/v1/practice-sessions"].post;
  assert.match(
    createSession.description,
    /저장 상태가 `created`인 검증된 업로드 인텐트/,
  );

  const signedVideoOperations = [
    openApiDocument.paths[
      "/api/v1/practice-sessions/{sessionId}/signed-video-url"
    ].get,
    openApiDocument.paths[
      "/api/v1/practice-sessions/{sessionId}/video-url"
    ].get,
  ];

  for (const operation of signedVideoOperations) {
    assert.deepEqual(operation.responses["400"], {
      $ref: "#/components/responses/BadRequest",
    });
  }
});

test("Swagger-visible documentation is written in Korean", () => {
  const korean = /[가-힣]/;
  const documentationKeys = new Set(["title", "summary", "description"]);
  const stack = [openApiDocument];

  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    for (const [key, nestedValue] of Object.entries(value)) {
      if (documentationKeys.has(key) && typeof nestedValue === "string") {
        assert.match(nestedValue, korean, `${key}: ${nestedValue}`);
      }

      stack.push(nestedValue);
    }
  }

  for (const tag of openApiDocument.tags) {
    assert.match(tag.name, korean, `tag: ${tag.name}`);
  }

  for (const pathItem of Object.values(openApiDocument.paths)) {
    for (const method of httpMethods) {
      const operation = pathItem[method.toLowerCase()];
      if (!operation) continue;

      for (const tag of operation.tags) {
        assert.match(tag, korean, `operation tag: ${tag}`);
      }
    }
  }
});

test("Swagger UI is pinned, same-origin, and production-safe", () => {
  const docsRoute = readFileSync(docsRoutePath, "utf8");
  const docsAssetRoute = readFileSync(docsAssetRoutePath, "utf8");
  const documentRoute = readFileSync(documentRoutePath, "utf8");
  const swaggerAssetConfig = readFileSync(swaggerAssetConfigPath, "utf8");

  assert.match(swaggerAssetConfig, /swaggerUiVersion = "5\.32\.8"/);
  assert.match(swaggerAssetConfig, /https:\/\/unpkg\.com\/swagger-ui-dist@/);
  assert.match(swaggerAssetConfig, /sha384: "[A-Za-z0-9+/=]+"/);
  assert.match(docsRoute, /swagger-ui-standalone-preset\.js/);
  assert.match(docsRoute, /SwaggerUIStandalonePreset/);
  assert.match(docsRoute, /swaggerUiAssetBase/);
  assert.doesNotMatch(docsRoute, /https:\/\/unpkg\.com/);
  assert.match(docsRoute, /crossorigin="anonymous"/);
  assert.match(docsRoute, /url: "\/api\/openapi\.json"/);
  assert.match(docsRoute, /request\.credentials = "same-origin"/);
  assert.match(docsRoute, /validatorUrl: null/);
  assert.match(docsRoute, /queryConfigEnabled: false/);
  assert.match(docsRoute, /isProduction = process\.env\.NODE_ENV === "production"/);
  assert.match(docsRoute, /isProduction \? \[\] : developmentSubmitMethods/);
  assert.match(docsRoute, /isProduction \? \["frame-ancestors 'none'"\] : \[\]/);
  assert.match(docsRoute, /isProduction \? \{ "X-Frame-Options": "DENY" \} : \{\}/);
  assert.match(docsRoute, /Content-Security-Policy/);
  assert.match(docsRoute, /style-src 'unsafe-inline'/);
  assert.match(docsAssetRoute, /createHash\("sha384"\)/);
  assert.match(docsAssetRoute, /cache: "force-cache"/);
  assert.match(docsAssetRoute, /digest !== asset\.sha384/);
  assert.match(docsAssetRoute, /Cross-Origin-Resource-Policy/);
  assert.match(documentRoute, /dynamic = "force-static"/);
  assert.match(documentRoute, /openapi\.json/);
});
