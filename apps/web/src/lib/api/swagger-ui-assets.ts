export const swaggerUiVersion = "5.32.8";
export const swaggerUiAssetBase = "/api/docs/assets";
export const swaggerUiUpstreamBase =
  "https://unpkg.com/swagger-ui-dist@" + swaggerUiVersion;

export const swaggerUiAssets = {
  "swagger-ui.css": {
    contentType: "text/css; charset=utf-8",
    sha384: "9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT",
  },
  "swagger-ui-bundle.js": {
    contentType: "text/javascript; charset=utf-8",
    sha384: "IKpAWwsTL0pcw7/Amtnt2eXF4P1BK64WNuY2E/RG15SWLUW5HXzFuyqCSAr/DP8C",
  },
  "swagger-ui-standalone-preset.js": {
    contentType: "text/javascript; charset=utf-8",
    sha384: "sm24U+dUFhSIgEfhSy6d7F66jTzh7YHwjwcdFANJ87OCxOWdQPERHk3xR2MtzMLa",
  },
} as const;

export type SwaggerUiAssetName = keyof typeof swaggerUiAssets;

export function isSwaggerUiAssetName(
  value: string,
): value is SwaggerUiAssetName {
  return Object.prototype.hasOwnProperty.call(swaggerUiAssets, value);
}
