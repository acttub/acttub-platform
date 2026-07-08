"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppConfig } from "@/lib/config/env";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const config = getAppConfig();

  if (!config.supabase.isConfigured) {
    return null;
  }

  browserClient ??= createBrowserClient(
    config.supabase.url,
    config.supabase.anonKey,
  );

  return browserClient;
}
