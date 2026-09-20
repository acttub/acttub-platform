// 이 파일을 import 한 스위트는 게스트가 이미 있는 뒤의 길을 본다. 토큰이 없으면 공용
// 클라이언트가 첫 보호 요청에서 게스트부터 만들고(account.guest) 조회는 서버에 가지
// 않으므로, fetch 순서를 세는 단언이 한 칸씩 밀린다. 게스트가 생기는 시점 자체는
// tests/v2-guest-session.test.mjs 가 본다.
//
// node --test 는 테스트 파일마다 별도 프로세스라 다른 스위트로 새지 않는다.
import "./ts-module-loader.mjs";

const { setTokens } = await import("../src/lib/auth/token-store.ts");

setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
