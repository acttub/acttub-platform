import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonResponse } from "../../http";
import {
  TERMS_COOKIE_NAME,
  recordTermsAcceptance,
  requireApiAuthenticatedUser,
} from "@/server/services/auth-context";

type AcceptTermsBody = {
  requiredConsentAccepted?: unknown;
  aiProcessingConsentAccepted?: unknown;
  internalReviewConsent?: unknown;
};

async function readBody(request: NextRequest): Promise<AcceptTermsBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as AcceptTermsBody;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    return {
      requiredConsentAccepted: formData.get("requiredConsentAccepted") === "true",
      aiProcessingConsentAccepted: formData.get("aiProcessingConsentAccepted") === "true",
      internalReviewConsent: formData.get("internalReviewConsent") === "true",
    };
  }

  return {};
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuthenticatedUser();
    const body = await readBody(request);

    if (
      body.requiredConsentAccepted !== true ||
      body.aiProcessingConsentAccepted !== true ||
      (body.internalReviewConsent !== undefined &&
        typeof body.internalReviewConsent !== "boolean")
    ) {
      return jsonResponse(
        {
          error: "필수 서비스 약관과 외부 AI 처리 목적에 모두 동의해 주세요.",
        },
        { status: 400 },
      );
    }

    await recordTermsAcceptance(auth, body.internalReviewConsent === true);

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    const response = acceptsHtml
      ? NextResponse.redirect(new URL("/home", request.url), { status: 303 })
      : jsonResponse({
          accepted: true,
          requiredConsentAccepted: true,
          aiProcessingConsentAccepted: true,
          internalReviewConsent: body.internalReviewConsent === true,
          nextPath: "/home",
        });

    response.cookies.set(TERMS_COOKIE_NAME, auth.termsVersion, {
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
