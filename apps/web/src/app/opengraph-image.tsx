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

// 앱 아이콘·스플래시와 같은 마스코트(SOMA-990). 글꼴 서브셋에 든 글자만 쓰므로 문구는 그대로 둔다.
const mascot = `data:image/png;base64,${readFileSync(
  path.join(process.cwd(), "src/lib/seo/og-mascot.png"),
).toString("base64")}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(160deg, #7CCBFF 0%, #3A97F5 50%, #1257D6 100%)",
        color: "#ffffff",
        display: "flex",
        fontFamily: "Noto Sans KR",
        gap: 56,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <img src={mascot} alt="" width={440} height={404} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 112, fontWeight: 700, letterSpacing: "-4px" }}>
          Acttub
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            marginTop: 20,
          }}
        >
          질문으로 다시 보는 연기 연습
        </div>
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
