export type FingerprintValue = null | boolean | string | number | FingerprintValue[] | { [key: string]: FingerprintValue };
export declare const canonicalizeFingerprintValue: (value: unknown) => FingerprintValue;
export declare const fingerprintJson: (value: unknown) => string;
export declare const isLowerHex64: (value: unknown) => value is string;
