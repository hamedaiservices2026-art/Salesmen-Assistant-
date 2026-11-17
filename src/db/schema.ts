import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Component } from "@/domain/commission";

const id = () => text("id").primaryKey();
const amount = (name: string) => bigint(name, { mode: "number" });
const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
const companyId = () =>
  text("company_id")
    .notNull()
    .references(() => companies.id);

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("SAR"),
  timeZone: text("time_zone").notNull().default("Asia/Riyadh"),
  defaultLocale: text("default_locale", { enum: ["ar", "en", "ur"] })
    .notNull()
    .default("ar"),
  sellingWeekdays: integer("selling_weekdays").array().notNull(),
  weekStartsOn: integer("week_starts_on").notNull().default(0),
  behindPct: integer("behind_pct").notNull().default(10),
  ...stamps(),
});

export const holidays = pgTable("holidays", {
  id: id(),
  companyId: companyId(),
  date: date("date", { mode: "string" }).notNull(),
  ...stamps(),
});

export const users = pgTable("users", {
  id: id(),
  companyId: companyId(),
  role: text("role", { enum: ["rep", "supervisor", "admin", "owner"] }).notNull(),
  name: text("name").notNull(),
  login: text("login").notNull().unique(),
  locale: text("locale", { enum: ["ar", "en", "ur"] })
    .notNull()
    .default("ar"),
  supervisorId: text("supervisor_id").references((): AnyPgColumn => users.id),
  pinHash: text("pin_hash"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  ...stamps(),
});

export const invites = pgTable("invites", {
  id: id(),
  companyId: companyId(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  ...stamps(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  companyId: companyId(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...stamps(),
});

export const targetLines = pgTable(
  "target_lines",
  {
    id: id(),
    companyId: companyId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    nameUr: text("name_ur").notNull(),
    unit: text("unit", { enum: ["cases", "value", "outlets"] }).notNull(),
    kind: text("kind", { enum: ["sales", "collection", "coverage"] }).notNull(),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...stamps(),
  },
  (t) => [uniqueIndex("target_lines_company_code").on(t.companyId, t.code)],
);

export const targets = pgTable(
  "targets",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    lineId: text("line_id")
      .notNull()
      .references(() => targetLines.id),
    amount: amount("amount").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("targets_user_period_line").on(t.userId, t.year, t.month, t.lineId)],
);

export const dailyCloses = pgTable(
  "daily_closes",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date", { mode: "string" }).notNull(),
    source: text("source", { enum: ["manual", "photo", "voice", "excel"] })
      .notNull()
      .default("manual"),
    status: text("status", { enum: ["draft", "confirmed"] })
      .notNull()
      .default("draft"),
    cashSales: amount("cash_sales").notNull().default(0),
    creditSales: amount("credit_sales").notNull().default(0),
    collections: amount("collections").notNull().default(0),
    expenses: amount("expenses").notNull().default(0),
    loaded: amount("loaded").notNull().default(0),
    sold: amount("sold").notNull().default(0),
    returned: amount("returned").notNull().default(0),
    note: text("note"),
    ...stamps(),
  },
  (t) => [uniqueIndex("daily_closes_user_date").on(t.userId, t.date)],
);

export const closeLines = pgTable(
  "close_lines",
  {
    id: id(),
    companyId: companyId(),
    closeId: text("close_id")
      .notNull()
      .references(() => dailyCloses.id),
    lineId: text("line_id")
      .notNull()
      .references(() => targetLines.id),
    amount: amount("amount").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("close_lines_close_line").on(t.closeId, t.lineId)],
);

export const focusItems = pgTable("focus_items", {
  id: id(),
  companyId: companyId(),
  name: text("name").notNull(),
  unit: text("unit", { enum: ["cases", "value"] }).notNull(),
  target: amount("target").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  ...stamps(),
});

export const focusAssignments = pgTable(
  "focus_assignments",
  {
    id: id(),
    companyId: companyId(),
    focusItemId: text("focus_item_id")
      .notNull()
      .references(() => focusItems.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    ...stamps(),
  },
  (t) => [uniqueIndex("focus_assignments_item_user").on(t.focusItemId, t.userId)],
);

export const closeFocus = pgTable(
  "close_focus",
  {
    id: id(),
    companyId: companyId(),
    closeId: text("close_id")
      .notNull()
      .references(() => dailyCloses.id),
    focusItemId: text("focus_item_id")
      .notNull()
      .references(() => focusItems.id),
    amount: amount("amount").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("close_focus_close_item").on(t.closeId, t.focusItemId)],
);

export const returns = pgTable("returns", {
  id: id(),
  companyId: companyId(),
  closeId: text("close_id")
    .notNull()
    .references(() => dailyCloses.id),
  description: text("description").notNull(),
  quantity: amount("quantity").notNull(),
  reason: text("reason", { enum: ["expired", "damaged", "other"] }).notNull(),
  ...stamps(),
});

export const schemes = pgTable(
  "schemes",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    components: jsonb("components").$type<Component[]>().notNull(),
    published: boolean("published").notNull().default(false),
    ...stamps(),
  },
  (t) => [uniqueIndex("schemes_company_period").on(t.companyId, t.year, t.month)],
);
