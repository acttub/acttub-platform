// @sentry/nextjs 대역. Sentry 진입점이 SDK 에 무엇을 넘기는지만 적어 둔다.
export const sentryCalls = [];

export function init(options) {
  sentryCalls.push(["init", options]);
}

export function captureRequestError(...args) {
  sentryCalls.push(["captureRequestError", args]);
}

export function captureRouterTransitionStart(...args) {
  sentryCalls.push(["captureRouterTransitionStart", args]);
}
