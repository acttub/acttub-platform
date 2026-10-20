import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, render, screen } = await import("@testing-library/react");
const { AppDownloadButton } = await import("../src/features/app-download/app-download-button.tsx");

afterEach(cleanup);

test("데스크톱에서는 두 스토어를 고르는 /app 으로 보낸다", () => {
  render(react.createElement(AppDownloadButton, { surface: "landing_hero" }));
  const link = screen.getByRole("link", { name: "앱 다운받기" });
  assert.equal(link.getAttribute("href"), "/app");
});
