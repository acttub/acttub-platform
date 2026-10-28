import { Noto_Serif_KR } from "next/font/google";

/**
 * 랜딩 제목용 명조(SOMA-918 2차). 대본·극장 느낌을 제목에만 쓰고 본문은 기존 프리텐다드를 둔다.
 * 한글은 글자 묶음별로 나뉜 파일을 쓰는 자리에서만 받아 오므로 미리 받지 않는다(preload: false).
 */
export const serifKr = Noto_Serif_KR({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-serif-kr",
});
