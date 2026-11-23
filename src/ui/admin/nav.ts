import { Building2, Award, Gift, LayoutGrid, Target, Settings, Upload, Users, BookOpen, MapPinned, ListTree, Star, Sparkles, type LucideIcon } from "lucide-react";
import type { Role } from "@/server/auth/roles";

export type NavItem = { href: string; key: string; Icon: LucideIcon };

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", key: "overview", Icon: LayoutGrid },
  { href: "/admin/users", key: "users", Icon: Users },
  { href: "/admin/lines", key: "lines", Icon: ListTree },
  { href: "/admin/targets", key: "targets", Icon: Target },
  { href: "/admin/coverage", key: "coverage", Icon: MapPinned },
  { href: "/admin/focus", key: "focus", Icon: Star },
  { href: "/admin/schemes", key: "schemes", Icon: Gift },
  { href: "/admin/incentives", key: "incentives", Icon: Award },
  { href: "/admin/policies", key: "policies", Icon: BookOpen },
  { href: "/admin/ai", key: "ai", Icon: Sparkles },
  { href: "/admin/uploads", key: "uploads", Icon: Upload },
  { href: "/admin/settings", key: "settings", Icon: Settings },
];

const OWNER_NAV: NavItem[] = [{ href: "/admin/companies", key: "companies", Icon: Building2 }];

export function navFor(role: Role): NavItem[] {
  return role === "owner" ? OWNER_NAV : ADMIN_NAV;
}
