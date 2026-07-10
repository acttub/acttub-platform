import { createHash } from "node:crypto";
import {
  isSwaggerUiAssetName,
  swaggerUiAssets,
  swaggerUiUpstreamBase,
} from "@/lib/api/swagger-ui-assets";

type RouteContext = {
  params: Promise<{
    asset: string;
  }>;
};

const assetError = (status: 404 | 502, message: string) =>
  new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(_request: Request, context: RouteContext) {
  const { asset: assetName } = await context.params;

  if (!isSwaggerUiAssetName(assetName)) {
    return assetError(404, "Swagger UI asset was not found.");
  }

  const asset = swaggerUiAssets[assetName];

  try {
    const upstreamResponse = await fetch(
      swaggerUiUpstreamBase + "/" + assetName,
      {
        cache: "force-cache",
        next: { revalidate },
      },
    );

    if (!upstreamResponse.ok) {
      return assetError(502, "Swagger UI asset is temporarily unavailable.");
    }

    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    const digest = createHash("sha384").update(body).digest("base64");

    if (digest !== asset.sha384) {
      return assetError(502, "Swagger UI asset integrity check failed.");
    }

    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Content-Length": String(body.byteLength),
        "Content-Type": asset.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: '"' + asset.sha384 + '"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return assetError(502, "Swagger UI asset is temporarily unavailable.");
  }
}
