"use client";

import { useEffect } from "react";
import { clearAllDrafts } from "@/app/app/close/draft-store";

/** On the sign-in page (reached after signing out, and before signing in): no stored close draft outlives its session. */
export function ClearDrafts() {
  useEffect(() => {
    try {
      clearAllDrafts(window.sessionStorage);
    } catch {
      // storage may be blocked
    }
  }, []);
  return null;
}
