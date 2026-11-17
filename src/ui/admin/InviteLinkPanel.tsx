"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

const noSubscribe = () => () => {};

/**
 * Shows an invite link once, with a copy button. The link is the page's own origin plus `path`,
 * so it is complete when the page opens on the deployed site.
 */
export function InviteLinkPanel({
  title,
  body,
  path,
  linkLabel,
  copyLabel,
  copiedLabel,
}: {
  title: string;
  body: string;
  path: string;
  linkLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const [copied, setCopied] = useState(false);
  const url = `${origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: the link is selectable below.
    }
  }

  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-brand bg-brand-tint px-4 py-4">
      <h3 className="m-0 text-base font-bold text-ink">{title}</h3>
      <p className="m-0 text-sm text-ink-2">{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <output
          aria-label={linkLabel}
          dir="ltr"
          className="min-h-11 min-w-0 basis-full select-all break-all rounded-lg border border-line bg-white px-3 py-2.5 text-start text-[13px] text-ink"
        >
          {url}
        </output>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-[14.5px] font-semibold text-brand hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {copied ? <Check aria-hidden="true" size={18} strokeWidth={2} /> : <Copy aria-hidden="true" size={18} strokeWidth={1.8} />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  );
}
