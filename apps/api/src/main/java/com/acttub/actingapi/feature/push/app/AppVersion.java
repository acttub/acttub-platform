package com.acttub.actingapi.feature.push.app;

import java.math.BigInteger;

public final class AppVersion {
    private AppVersion() {}

    public static boolean atLeast(String actual, String minimum) {
        BigInteger[] left = parse(actual);
        BigInteger[] right = parse(minimum);
        if (left == null || right == null) return false;
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            BigInteger a = i < left.length ? left[i] : BigInteger.ZERO;
            BigInteger b = i < right.length ? right[i] : BigInteger.ZERO;
            int compared = a.compareTo(b);
            if (compared != 0) return compared > 0;
        }
        return true;
    }

    private static BigInteger[] parse(String value) {
        if (value == null || !value.matches("[0-9]+(?:\\.[0-9]+)*")) return null;
        String[] parts = value.split("\\.");
        BigInteger[] parsed = new BigInteger[parts.length];
        for (int i = 0; i < parts.length; i++) parsed[i] = new BigInteger(parts[i]);
        return parsed;
    }
}
