import openApiDocument from "@/lib/api/openapi.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json(openApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
