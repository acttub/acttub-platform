// 리딩 페이지 테스트가 바꿔 끼우는 모듈들. 라우터 이동·음성 재생·목소리 준비를 기록하고 테스트가 정한 값을 낸다.
import { createElement, useEffect } from "react";

export const nav = { pushed: [], replaced: [], pathname: "/reading" };
export const router = {
  push: (to) => nav.pushed.push(to),
  replace: (to) => nav.replaced.push(to),
  back: () => nav.pushed.push("back"),
};
export const useRouter = () => router;
export const usePathname = () => nav.pathname;
export const useSearchParams = () => new URLSearchParams();

export const spoken = [];
export const unlockTts = () => {};
export const speak = async (text, voice) => {
  spoken.push({ text, voice });
};
export const deviceStyles = (names) => Object.fromEntries(names.map((n, i) => [n, { pitch: i }]));

export const voiceSetup = { ready: true, partnerVoice: "device" };
export function VoiceSetup({ onChange }) {
  useEffect(() => {
    onChange({ ready: voiceSetup.ready, partnerVoice: voiceSetup.partnerVoice });
  }, [onChange]);
  return createElement("p", null, "상대 목소리 설정");
}

export const AppRail = () => null;

export default function Link({ href, children, ...rest }) {
  return createElement("a", { href, ...rest }, children);
}
