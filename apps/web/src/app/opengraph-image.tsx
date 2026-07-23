import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Acttub — 질문으로 다시 보는 연기 연습";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";
export const dynamic = "force-static";

const fontBytes = Uint8Array.from(
  readFileSync(
    path.join(process.cwd(), "src/lib/seo/fonts/og-font-subset.ttf"),
  ),
);

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#191f28",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Noto Sans KR",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: "-4px" }}>
        Acttub
      </div>
      <div
        style={{
          color: "#3182f6",
          fontSize: 46,
          fontWeight: 700,
          marginTop: 32,
        }}
      >
        질문으로 다시 보는 연기 연습
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Noto Sans KR",
          data: fontBytes.buffer,
          style: "normal",
          weight: 700,
        },
      ],
    },
  );
}
