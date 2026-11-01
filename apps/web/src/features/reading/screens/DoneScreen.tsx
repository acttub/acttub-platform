"use client";

import type { ComponentProps } from "react";
import { Page } from "@/features/reading/page-shell";
import { DoneBody } from "@/features/reading/screens/DoneBody";

/** 완료(D19). 본문은 DoneBody, 여기서는 화면 껍데기만 씌운다. */
export function DoneScreen(props: ComponentProps<typeof DoneBody>) {
  return (
    <Page>
      <DoneBody {...props} />
    </Page>
  );
}
