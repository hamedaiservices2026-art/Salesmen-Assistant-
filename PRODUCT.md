# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: the owner asked for a recommendation. Chosen: one Next.js (TypeScript) codebase delivered as an installable PWA, Supabase (Postgres, auth, storage), deployed from GitHub to Vercel. Built so the same code can be wrapped for the App Store and Play Store later. AI services sit behind a provider layer so models can be swapped.

## Users

- **Sales rep (primary).** FMCG van-sales and pre-sales reps in Saudi Arabia working for distributors. Many are expatriates with limited formal education. Mostly on iPhone, one-handed, in a van or on the street in daylight, and at the warehouse at end of day. They already use the company's sales force automation app all day; this product sits beside it.
- **Supervisor.** Manages a team of reps, mostly on mobile. Follows who is on pace, pushes focus items and incentives.
- **Admin.** Works on desktop web. Manages companies, users, targets, commission schemes, incentives, policy documents, and Excel uploads.

## Product Purpose

A personal assistant that tells a rep every day where he stands against his monthly targets, what is left, what to focus on, and what he will earn, so he achieves more. Success: reps open it daily, hit a higher share of target, and trust the commission figure it shows.

## Positioning

Rep-first and independent of any one sales force automation system. Data arrives with almost no effort from the rep (photo of the day-end report, voice note, or company Excel upload), and the commission is calculated transparently so every amount can be traced.

## Operating Context

- Pilot: one rep whose company uses SalesBuzz. No integration in the pilot; data comes from photo, voice, manual entry, and Excel uploaded by the admin.
- Product is built for companies (multi-company), each with its own targets, commission rules, incentives, and policy documents.
- Market: Saudi Arabia. Currency: Saudi riyal (SAR), configurable.
- Daily rhythm: morning brief, selling day, end-of-day close (sales, collections, returns with photos, cash and van-stock reconciliation).
- Mid-month incentives are common and must reach the rep as a notification with a plain explanation.

## Capabilities and Constraints

- Targets are flexible per rep and per line: a target line can be measured in cases (for example beverages) or in value in SAR (for example food), and one rep can hold a mix of both in the same month. Collection targets are in SAR.
- Daily standing against target: achieved, expected pace for today, remaining, required daily rate.
- Focus items set by the company; notifications from supervisor or admin.
- Day close by photo, voice, or typing; returns logged with photos; history by day and month.
- Commission engine driven by company-defined criteria; rule-based calculation (not AI) with a what-if simulator.
- Assistant: answers from the rep's own numbers, explains incentives simply, gives selling tips, and answers policy questions from the company's uploaded documents with the source cited.
- Languages: Arabic (primary, right-to-left), English, Urdu as an option.
- One app for the rep. Supervisor uses the same mobile app with a supervisor view. Admin is a web dashboard.
- Start on free tiers for AI services (image reading, speech to text, text to speech); no paid AI cost in the pilot.
- Undecided: product name; exact commission schemes; the real day-end report layout (no screenshots yet).

## Brand Commitments

- Must look professional and enterprise-grade, and must not look like a generic AI-generated template.
- "Simple" means simple presentation, friendly and human, never thin on value.

## Evidence on Hand

None yet. No real screenshots, customer data, logos, or policy documents. All figures shown in mockups are synthetic and must be labeled as sample data. Do not invent customers, testimonials, or performance claims.

## Pilot commission rules (confirmed by the owner, pilot company)

Monthly, per rep. Maximum 3,500 SAR. Amounts are paid on the rep's own sales of the month.

Fixed every month (2,500 SAR):
- Can-size lines, each its own target in cartons: 185 ml, 250 ml, 320 ml. Commission starts at 90% of a line's target; below 90% pays nothing. At 100% the amounts are 300 (185 ml), 600 (250 ml), 600 (320 ml) SAR. Between 90% and 100% and above 100% (110% and beyond) the payout steps up in tiers. Some months the company adds an extra incentive at 100% (for example 250 SAR); not every month.
- Combined incentive, 1,000 SAR: at least 90% of the Kinza target (a Saudi competitor brand, target in cartons) AND at least 70% of the Food target (in SAR), both in the same month.

Variable every month (1,000 SAR), chosen by the admin or manager at the start of the month, either:
- Coverage: a customer counts as covered when he bought at least 6 cartons of any item in the month; the rep earns when covered customers reach 85% (or the month's percentage) of the customers on his line. Coverage is a monthly count, not a daily sum.
- Or a volume incentive on a specific item (for example a cocktail item): sell a stated number of cartons.

Decided: the payout of each can-size line between 90% and 110% and beyond, and any extra incentive at 100% (for example 250 SAR), are not fixed in code: the admin sets the tiers and amounts per month in the commission editor. Do not invent them.

Open: where the covered-customer count comes from. The pilot rep gives the product daily sales only and has no customer-level data. To ask the pilot rep: does his sales system show a coverage or "customers who bought" report, does he or his company know the monthly figure, and in what form. Until answered, plan: a monthly figure (covered customers out of total customers on his line) entered by the rep or the admin, or read from a photo of a report in plan 3; computing it from customer-level sales is a later phase.

## Product Principles

1. The rep's benefit comes first; every screen answers "what do I do next to earn more".
2. Near-zero data entry: never make the rep retype what the company system already has.
3. Money figures must be traceable and exact; calculation is rules, not guesses.
4. One number first, depth on demand.
5. Works for any company and any sales system through configuration, not custom code.

## Accessibility & Inclusion

- Low-literacy friendly: plain spoken Arabic, large type, voice input and read-aloud.
- Right-to-left first; Western digits; outdoor daylight legibility; touch targets at least 44px.
