import { NextResponse, type NextRequest } from "next/server";
import { getAppConfig } from "@/lib/config/env";
import { handleApiError, jsonResponse } from "../http";
import {
  TERMS_COOKIE_NAME,
  recordTermsAcceptance,
  requireApiAuthenticatedUser,
} from "@/server/services/auth-context";

type AcceptTermsBody = {
  termsVersion?: unknown;
};

async function readBody(request: NextRequest): Promise<AcceptTermsBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json().catch(() => ({}))) as AcceptTermsBody;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    return { termsVersion: formData.get("termsVersion") };
  }

  return {};
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuthenticatedUser();

    const config = getAppConfig();
    const body = await readBody(request);

    if (body.termsVersion !== config.termsVersion) {
      return jsonResponse(
        {
          error: "현재 약관 버전으로 다시 확인해 주세요.",
          requiredVersion: config.termsVersion,
        },
        { status: 400 },
      );
    }

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    await recordTermsAcceptance(auth);

    const response = acceptsHtml
      ? NextResponse.redirect(new URL("/practice", request.url), {
          status: 303,
        })
      : jsonResponse({
          accepted: true,
          termsVersion: config.termsVersion,
          nextPath: "/practice",
        });

    response.cookies.set(TERMS_COOKIE_NAME, config.termsVersion, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
