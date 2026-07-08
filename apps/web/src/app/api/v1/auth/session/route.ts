import { NextResponse } from "next/server";
import { privateNoStoreHeaders } from "@/server/http/cache";
import { getAuthContext, toAuthSessionDto } from "@/server/services/auth-context";

export async function GET() {
  const context = await getAuthContext();
  return NextResponse.json(toAuthSessionDto(context), { headers: privateNoStoreHeaders });
}
