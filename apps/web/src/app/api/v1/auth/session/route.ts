import {
  getAuthContext,
  toAuthSessionDto,
} from "@/server/services/auth-context";
import { jsonResponse } from "../../http";

export async function GET() {
  const context = await getAuthContext();
  return NextResponse.json(toAuthSessionDto(context), { headers: privateNoStoreHeaders });
}
