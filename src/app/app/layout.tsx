import { requireRole } from "@/server/auth/guard";
import { BottomNav } from "@/ui/components/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["rep", "supervisor"]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-white">
      <div className="flex flex-1 flex-col">{children}</div>
      <BottomNav />
    </div>
  );
}
