import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Component } from "@/domain/commission";
import type { RowError } from "@/domain/import/rows";

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
  /** The company admin's AI switch (plan 3): off until he turns it on after reading the data-use notice. */
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  ...stamps(),
});

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    companyId: companyId(),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name"),
    ...stamps(),
  },
  (t) => [uniqueIndex("holidays_company_date").on(t.companyId, t.date)],
);

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
  /** Admins and owners only; reps and supervisors sign in with a PIN. */
  passwordHash: text("password_hash"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  /** When the last sign-in try was reserved; a counter left at the limit recovers once this is older than the lock window. */
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  /** The version of the one-time AI notice this user accepted; 0 = never (plan 3). */
  aiNoticeVersion: integer("ai_notice_version").notNull().default(0),
  aiNoticeAt: timestamp("ai_notice_at", { withTimezone: true }),
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

/** Every change to a monthly target, from the admin form or an Excel upload: who, when, old and new amount. */
export const targetChanges = pgTable(
  "target_changes",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    lineId: text("line_id")
      .notNull()
      .references(() => targetLines.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    oldAmount: amount("old_amount"),
    newAmount: amount("new_amount"),
    source: text("source", { enum: ["form", "excel"] }).notNull(),
    changedBy: text("changed_by")
      .notNull()
      .references(() => users.id),
    uploadId: text("upload_id").references(() => uploads.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("target_changes_company_created").on(t.companyId, t.createdAt)],
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
    /** Who set `amount`: the rep, or an admin's Excel upload (which wins over the rep's value). */
    source: text("source", { enum: ["rep", "excel"] })
      .notNull()
      .default("rep"),
    /** For an excel line: what the rep typed himself (null when he has not). */
    repAmount: amount("rep_amount"),
    ...stamps(),
  },
  (t) => [uniqueIndex("close_lines_close_line").on(t.closeId, t.lineId)],
);

export const focusItems = pgTable("focus_items", {
  id: id(),
  companyId: companyId(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  nameUr: text("name_ur"),
  sku: text("sku"),
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
    /** The published components; an empty list while the month has only a draft. */
    components: jsonb("components").$type<Component[]>().notNull(),
    published: boolean("published").notNull().default(false),
    /** The admin's saved, valid, unpublished components; null when there is none. */
    draft: jsonb("draft").$type<Component[]>(),
    /** Bumped on every draft save and on publish; a save or publish naming an older value is stale. */
    draftRev: integer("draft_rev").notNull().default(0),
    /** Bumped on every publish; 0 while never published. */
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => users.id),
    ...stamps(),
  },
  (t) => [uniqueIndex("schemes_company_period").on(t.companyId, t.year, t.month)],
);

/** Every published version of a month's scheme, as published; `published_by` null for versions from before this log. */
export const schemeVersions = pgTable(
  "scheme_versions",
  {
    id: id(),
    companyId: companyId(),
    schemeId: text("scheme_id")
      .notNull()
      .references(() => schemes.id),
    version: integer("version").notNull(),
    components: jsonb("components").$type<Component[]>().notNull(),
    publishedBy: text("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scheme_versions_scheme_version").on(t.schemeId, t.version)],
);

/**
 * A count of customers covered out of the customers in a rep's territory, as of a date, entered by
 * the rep, his supervisor or an admin. The latest `as_of` in a month (then the latest `created_at`)
 * is that month's coverage; older rows stay as the history.
 */
export const coverageUpdates = pgTable(
  "coverage_updates",
  {
    id: id(),
    companyId: companyId(),
    /** The rep the count is about. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    lineId: text("line_id")
      .notNull()
      .references(() => targetLines.id),
    covered: integer("covered").notNull(),
    total: integer("total").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    /** Who typed it, and in which role. */
    enteredBy: text("entered_by")
      .notNull()
      .references(() => users.id),
    enteredRole: text("entered_role", { enum: ["rep", "supervisor", "admin", "owner"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("coverage_updates_user_line_as_of").on(t.userId, t.lineId, t.asOf),
    check("coverage_updates_counts", sql`${t.total} >= 1 AND ${t.covered} >= 0 AND ${t.covered} <= ${t.total}`),
  ],
);

/** Text in the three languages; `ar` is required and the fallback. */
export type LocalText = { ar: string; en?: string; ur?: string };

/** A message to one user, shown in the app. `ref` is what it is about (an incentive's component id). */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["incentive"] }).notNull(),
    title: jsonb("title").$type<LocalText>().notNull(),
    body: jsonb("body").$type<LocalText>().notNull(),
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_user_created").on(t.userId, t.createdAt), index("notifications_company_ref").on(t.companyId, t.ref),
    index("notifications_unread").on(t.userId).where(sql`${t.readAt} is null`),
  ],
);

/** One admin upload attempt and its outcome; written even when nothing was applied. */
export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    companyId: companyId(),
    kind: text("kind", { enum: ["targets", "daily"] }).notNull(),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    /** The full count; `errors` keeps at most the first 200. */
    errorCount: integer("error_count").notNull().default(0),
    applied: boolean("applied").notNull().default(false),
    errors: jsonb("errors").$type<RowError[]>().notNull().default(sql`'[]'::jsonb`),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("uploads_company_created").on(t.companyId, t.createdAt)],
);

/** A company policy text kept for the assistant (plan 3). Plain text only; `sections` is derived from `body`. */
export const policyDocuments = pgTable(
  "policy_documents",
  {
    id: id(),
    companyId: companyId(),
    title: text("title").notNull(),
    locale: text("locale", { enum: ["ar", "en", "ur"] }).notNull(),
    body: text("body").notNull(),
    sections: jsonb("sections").$type<{ label: string; text: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** Version token: a save names the version it read and is refused as stale if another save got there first. */
    version: integer("version").notNull().default(0),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    ...stamps(),
  },
  (t) => [index("policy_documents_company_updated").on(t.companyId, t.updatedAt)],
);

/**
 * AI request counters. One row per (scope, bucket, kind); a request reserves a slot with a single
 * conditional upsert (`src/server/ai/quota.ts`). `scope` is `user:<userId>`, `company:<companyId>`
 * or `global`; `bucket` is a day `YYYY-MM-DD` (company time zone; UTC for `global`) or a minute
 * `YYYY-MM-DDTHH:MM` (UTC). `company_id` is null only for `global`, the one deployment-wide row.
 */
export const aiCounters = pgTable(
  "ai_counters",
  {
    scope: text("scope").notNull(),
    bucket: text("bucket").notNull(),
    kind: text("kind").notNull(),
    companyId: text("company_id").references(() => companies.id),
    count: integer("count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.bucket, t.kind] }), index("ai_counters_updated").on(t.updatedAt)],
);

/**
 * One row per AI request (and per quota refusal). Codes and counts only: no column holds a
 * question, a transcript, a reply, a file name or an amount.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["vision", "stt", "chat"] }).notNull(),
    feature: text("feature", { enum: ["close_photo", "close_voice", "assistant", "assistant_voice", "explain"] }).notNull(),
    provider: text("provider"),
    model: text("model"),
    outcome: text("outcome", {
      enum: ["ok", "invalid_output", "timeout", "rate_limited", "provider_error", "bad_request", "rejected"],
    }).notNull(),
    attempts: integer("attempts").notNull(),
    fallback: boolean("fallback").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    topic: text("topic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_company_created").on(t.companyId, t.createdAt), index("ai_usage_created").on(t.createdAt)],
);
