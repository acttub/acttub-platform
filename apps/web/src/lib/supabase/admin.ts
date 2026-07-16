import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppConfig } from "@/lib/config/env";

function getSupabaseServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = getAppConfig();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!config.supabase.url || !serviceRoleKey) {
    return null;
  }

  return createClient(config.supabase.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
