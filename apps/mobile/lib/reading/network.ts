import * as Network from 'expo-network';

import type { NetworkType } from './voice-policy.ts';

/** 지금 연결 종류. 모르면 unknown — 이동통신처럼 다뤄 용량 확인을 받는다(reading.cast). */
export async function currentNetworkType(): Promise<NetworkType> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET) return 'wifi';
    if (state.type === Network.NetworkStateType.CELLULAR) return 'cellular';
    if (state.type === Network.NetworkStateType.NONE) return 'none';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
