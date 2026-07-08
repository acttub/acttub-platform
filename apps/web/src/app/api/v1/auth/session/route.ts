import {
  getAuthContext,
  toAuthSessionDto,
} from "@/server/services/auth-context";

export async function GET() {
  const context = await getAuthContext();
  return jsonResponse(toAuthSessionDto(context));
}
