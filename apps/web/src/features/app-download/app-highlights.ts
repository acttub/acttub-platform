// 앱을 받을 이유. 랜딩과 /app 이 같은 문장을 쓰도록 여기 한 곳에 둔다.
//
// 웹이 못 하는 것만 적는다 — 셋 다 코드에서 확인한 차이다.
// 1) 영상은 폰으로 찍는다. 앱에서는 옮기는 단계가 없다.
// 2) 마이크 입력은 앱에만 있다(`apps/mobile/components/mic-button.tsx`, 웹에는 없음).
// 3) 운영 앱은 웹과 같은 백엔드를 본다(`apps/mobile/eas.json` production 의
//    EXPO_PUBLIC_API_URL = https://acttub.com) — 계정과 지난 연습이 그대로 이어진다.
export const APP_HIGHLIGHTS: readonly { title: string; body: string }[] = [
  {
    title: "찍은 자리에서 바로",
    body: "연습실에서 찍은 영상을 컴퓨터로 옮기지 않고 폰에서 그대로 올려요.",
  },
  {
    title: "말로 답해도 돼요",
    body: "질문에 타자 대신 마이크로 답할 수 있어요. 앱에만 있는 방식이에요.",
  },
  {
    title: "쓰던 계정 그대로",
    body: "웹에서 쓰던 계정으로 들어오면 지난 연습이 그대로 이어져요.",
  },
];
