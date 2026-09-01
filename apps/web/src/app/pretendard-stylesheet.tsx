"use client";

import { useEffect } from "react";
import pretendardPackage from "pretendard/package.json" with { type: "json" };

const STYLESHEET_ID = "pretendard-dynamic-subset";
const stylesheetHref = `/fonts/pretendard/${pretendardPackage.version}/pretendard.css`;

export function PretendardStylesheet() {
  useEffect(() => {
    if (document.getElementById(STYLESHEET_ID)) return;

    const stylesheet = document.createElement("link");
    stylesheet.id = STYLESHEET_ID;
    stylesheet.rel = "stylesheet";
    stylesheet.href = stylesheetHref;
    stylesheet.media = "print";
    stylesheet.onload = () => {
      stylesheet.media = "all";
    };
    document.head.append(stylesheet);
  }, []);

  return null;
}
