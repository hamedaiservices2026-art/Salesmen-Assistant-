import Link from "next/link";
import { Camera } from "lucide-react";

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-brand text-base font-bold text-white no-underline hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <Camera aria-hidden="true" size={22} strokeWidth={1.8} />
      {children}
    </Link>
  );
}
