"use client";
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { observeScrollReveals } from "../lib/scroll-reveal";

export function ScrollReveals() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const root = document.getElementById("main-content");
    if (root) return observeScrollReveals(root);
  }, [pathname]);
  return null;
}
