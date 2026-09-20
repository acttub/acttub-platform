"use client";

import type { ComponentProps } from "react";
import { Page } from "@/features/reading/page-shell";
import { InputBody } from "@/features/reading/screens/InputBody";

export { UNREADABLE_FILE_COPY } from "@/features/reading/screens/InputBody";

/** 대본 넣기(D13). 본문은 InputBody, 여기서는 화면 껍데기만 씌운다. */
export function InputScreen(props: ComponentProps<typeof InputBody>) {
  return (
    <Page>
      <InputBody {...props} />
    </Page>
  );
}
