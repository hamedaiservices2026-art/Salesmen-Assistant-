import { TriangleAlert } from "lucide-react";
import type { PaceStatus } from "@/domain/pace";

/** Pace status: red tint when behind, blue tint when ahead, muted text when there is no target. */
export function StatusChip({ status, behindText, aheadText, noTargetText }: {
  status: PaceStatus;
  behindText: string;
  aheadText: string;
  noTargetText: string;
}) {
  if (status === "no_target") return <span className="text-[13px] text-ink-2">{noTargetText}</span>;
  if (status === "ahead") {
    return (
      <span className="inline-flex items-center gap-[5px] rounded-md bg-brand-tint px-2.5 py-1 text-[13px] font-bold text-brand">
        {aheadText}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[5px] rounded-md bg-alert-tint px-2.5 py-1 text-[13px] font-bold text-alert">
      <TriangleAlert aria-hidden="true" size={14} strokeWidth={2.3} />
      {behindText}
    </span>
  );
}
