import {
  swaggerUiAssetBase,
  swaggerUiAssets,
} from "@/lib/api/swagger-ui-assets";

const developmentSubmitMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

export const dynamic = "force-dynamic";

export function GET() {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isProduction = process.env.NODE_ENV === "production";
  const supportedSubmitMethods = isProduction ? [] : developmentSubmitMethods;
  const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'nonce-" + nonce + "' 'self'",
    "style-src 'unsafe-inline' 'self'",
    "img-src data: 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(isProduction ? ["frame-ancestors 'none'"] : []),
    "object-src 'none'",
  ].join("; ");

  const html = [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Acttub API Docs</title>",
    '  <link rel="stylesheet" href="' +
      swaggerUiAssetBase +
      '/swagger-ui.css" integrity="' +
      "sha384-" +
      swaggerUiAssets["swagger-ui.css"].sha384 +
      '" crossorigin="anonymous">',
    '  <style nonce="' + nonce + '">',
    "    html { box-sizing: border-box; overflow-y: scroll; }",
    "    *, *::before, *::after { box-sizing: inherit; }",
    "    body { margin: 0; background: #fafafa; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="swagger-ui"></div>',
    '  <script nonce="' +
      nonce +
      '" src="' +
      swaggerUiAssetBase +
      '/swagger-ui-bundle.js" integrity="' +
      "sha384-" +
      swaggerUiAssets["swagger-ui-bundle.js"].sha384 +
      '" crossorigin="anonymous"></script>',
    '  <script nonce="' +
      nonce +
      '" src="' +
      swaggerUiAssetBase +
      '/swagger-ui-standalone-preset.js" integrity="' +
      "sha384-" +
      swaggerUiAssets["swagger-ui-standalone-preset.js"].sha384 +
      '" crossorigin="anonymous"></script>',
    '  <script nonce="' + nonce + '">',
    "    window.ui = SwaggerUIBundle({",
    '      url: "/api/openapi.json",',
    '      dom_id: "#swagger-ui",',
    "      deepLinking: true,",
    "      displayRequestDuration: true,",
    "      filter: true,",
    "      persistAuthorization: false,",
    "      queryConfigEnabled: false,",
    "      validatorUrl: null,",
    "      supportedSubmitMethods: " + JSON.stringify(supportedSubmitMethods) + ",",
    "      requestInterceptor: function (request) {",
    '        request.credentials = "same-origin";',
    "        return request;",
    "      },",
    "      presets: [",
    "        SwaggerUIBundle.presets.apis,",
    "        SwaggerUIStandalonePreset",
    "      ],",
    '      layout: "StandaloneLayout"',
    "    });",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");

  return new Response(html, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": "text/html; charset=utf-8",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...(isProduction ? { "X-Frame-Options": "DENY" } : {}),
    },
  });
}
