// posthog-js 자리에 끼우는 최소 SDK. 네트워크 대신 "나간 이벤트"를 모으고, 실제 SDK처럼
// opt-out 중에는 capture 를 버리며 reset() 은 저장된 동의를 지운다. opt_in_capturing 은 실제 SDK
// 처럼 그 자리에서 $pageview 를 보낸다(capture_pageview 가 켜져 있으면). opt-out 이 새로고침 뒤에도
// 남는 것은 테스트가 `sdk.optedOut` 을 init 전에 true 로 두어 흉내 낸다.
export const sdk = {
  calls: [],
  delivered: [],
  optedOut: false,
  distinctId: null,
  deviceId: 1,
  recording: false,
  config: null,
};

function deliver(event, properties) {
  if (sdk.optedOut) return;
  sdk.delivered.push({ event, properties, distinctId: sdk.distinctId, deviceId: sdk.deviceId });
}

const posthog = {
  init(...args) {
    sdk.calls.push(["init", ...args]);
    sdk.config = args[1];
  },
  capture(event, properties) {
    sdk.calls.push(["capture", event, properties]);
    deliver(event, properties);
  },
  identify(distinctId) {
    sdk.calls.push(["identify", distinctId]);
    sdk.distinctId = distinctId;
  },
  reset(resetDeviceId) {
    sdk.calls.push(["reset", resetDeviceId]);
    sdk.optedOut = false;
    sdk.distinctId = null;
    if (resetDeviceId) sdk.deviceId += 1;
  },
  opt_in_capturing(options) {
    sdk.calls.push(["opt_in_capturing", options]);
    sdk.optedOut = false;
    const name = options?.captureEventName;
    if (name === undefined || name) deliver(name ?? "$opt_in", {});
    if (sdk.config?.capture_pageview) deliver("$pageview", {});
  },
  opt_out_capturing() {
    sdk.calls.push(["opt_out_capturing"]);
    sdk.optedOut = true;
  },
  has_opted_out_capturing() {
    return sdk.optedOut;
  },
  startSessionRecording() {
    sdk.calls.push(["startSessionRecording"]);
    sdk.recording = true;
  },
  stopSessionRecording() {
    sdk.calls.push(["stopSessionRecording"]);
    sdk.recording = false;
  },
  get_property(name) {
    return name === "$user_id" ? sdk.distinctId : undefined;
  },
};

export default posthog;
