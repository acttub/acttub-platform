"use client";

import type { ComponentProps } from "react";
import { Page } from "@/features/reading/page-shell";
import { MemorizationBody } from "@/features/reading/screens/MemorizationBody";

/** 암기 화면(R04·R04.1 대응). 본문은 MemorizationBody, 여기서는 화면 껍데기만 씌운다. */
export function MemorizationScreen(props: ComponentProps<typeof MemorizationBody>) {
  return (
    <Page>
      <MemorizationBody {...props} />
    </Page>
  );
}
