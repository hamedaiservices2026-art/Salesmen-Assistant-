"use client";

import { clearAllDrafts } from "@/ui/draft-store";

/**
 * The sign-out form: signing out also drops every stored close draft of this browser tab (a draft
 * is the rep's own figures and must not outlive his session). A session that merely expires keeps
 * them; they are stored per user, so another rep never sees them.
 */
export function SignOutForm({ action, className, children }: { action: () => Promise<void>; className?: string; children: React.ReactNode }) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={() => {
        try {
          clearAllDrafts(window.sessionStorage);
        } catch {
          // storage may be blocked
        }
      }}
    >
      {children}
    </form>
  );
}
