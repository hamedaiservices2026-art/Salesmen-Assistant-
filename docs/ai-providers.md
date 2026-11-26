# AI providers: verified facts and open checks

Written 2026-11-23 (Task 1 of plan 3); brought up to date 2026-11-25 (Task 20, "Where things stand at the end of plan 3").

## How this was researched, and its limit

The session's network blocked direct reads of the providers' own pages (`ai.google.dev`, `console.groq.com` did not resolve for the page fetcher; the crawler tool was declined by the owner). The facts below therefore come from **web-search result summaries of the providers' official pages**, which name the page address. No page was read in full. Because of that, every limit is marked **UNVERIFIED (search summary only)** unless the search summary quoted the official page directly and consistently; nothing was taken from memory. Task 4's opt-in smoke check and a person reading the live pages must confirm the rows marked UNVERIFIED before any default is raised. Forum posts are recorded only as pointers, never as verification.

Status words: **SEEN** = stated in a search summary of the official page named in the row (date 2026-11-23); **UNVERIFIED** = not seen, conflicting, or forum-only.

## Differences from the design

1. **`gemini-4-hydrogen` was not found.** The current Gemini docs (search summaries of `https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash`, `.../gemini-3.5-flash-lite`, `.../whats-new-gemini-3.5`, and the example code on `https://ai.google.dev/api/generate-content`) name `gemini-3.5-flash` (reported deprecated and routed to `gemini-3.6-flash`), `gemini-3.5-flash-lite`, and `gemini-3.8-flash` (used in doc examples; the docs disagree on the newest id). No page mentions a "Gemini 4" or "hydrogen" model. Default used in `config.ts` for the three Gemini jobs: **`gemini-3.5-flash-lite`** (the only id with a free-tier daily figure we saw, 500 requests per day, from a forum post, UNVERIFIED). Image and audio input for the flash-lite page is UNVERIFIED (the flash page states text, image, video, audio and PDF input, text output). Override with `AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL`.
2. **Free-tier Gemini limits have changed repeatedly** (forum reports: Flash 250 to 20 requests per day in Dec 2025; flash-lite 500 per day). The design's 400/600/800 deployment-wide daily defaults cannot be checked against a verified figure, so they are kept and flagged. Gemini's daily quota is per project and per model; the three Gemini jobs share one model by default, so the sum of the Gemini-backed jobs (vision plus chat) may exceed it. UNVERIFIED; set `AI_GLOBAL_DAY_*` after reading the live quota page in AI Studio.
3. **Gemini free-tier content may be used to improve Google's products** (pricing page and Additional Terms, see below). This matters for report photos and questions; the notice (Task 5) must say so, or a billed project must be used.
4. **OpenRouter has no verified free vision or chat model id** in this research, so `openrouter.visionModel` and `chatModel` default to `null` (the fallback is disabled until an operator sets `AI_OPENROUTER_*_MODEL` after reading `https://openrouter.ai/collections/free-models`).
5. **Per-minute limits were not verified for any provider**, so `globalMinute` defaults to `null` for all three kinds (no deployment-wide minute counter until the operator sets `AI_GLOBAL_MINUTE_*`; R65). One request in this app can make up to 4 provider calls (2 attempts on the primary provider, then 2 on the fallback; `MAX_ATTEMPTS_PER_PROVIDER` in `src/server/ai/run.ts`), while the counters count it once, so set each `AI_GLOBAL_MINUTE_*` to about 40 percent of the provider's verified per-minute limit (not 80 percent).
6. **Supabase is retiring the `service_role` and anon keys by the end of 2026** in favour of `sb_secret_...` and `sb_publishable_...` keys. The adapter (Task 6) must handle both forms (R49).
7. **Vercel accepts request bodies up to 4.5 MB by default**, so the 4 000 000 byte upload limit stands. A 20 MiB opt-in beta exists but is not used.

## Gemini (Google AI Studio API)

| Fact | Value | Status and source |
|---|---|---|
| Base URL | `https://generativelanguage.googleapis.com` (constant in code) | design; endpoint path and API version UNVERIFIED (read `https://ai.google.dev/api/generate-content`) |
| Auth | `x-goog-api-key` header | UNVERIFIED (not seen in a summary); Task 4 confirms |
| Model ids | `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`; `gemini-4-hydrogen` not found | SEEN as above, 2026-11-23 |
| Image input | inline base64 part with MIME type | UNVERIFIED shape; flash page states image input |
| Audio input | inline base64 or File API; types WAV `audio/wav`, MP3 `audio/mp3`, AIFF, AAC `audio/aac`, OGG `audio/ogg`, FLAC, MPEG, M4A `audio/m4a`, L16, Opus, A-law, mu-law, WebM `audio/webm` | SEEN, `https://ai.google.dev/gemini-api/docs/audio`; `audio/mp4` is not in the list, so it is treated as not accepted |
| JSON-only output | `responseMimeType: "application/json"` in generation config | UNVERIFIED (not seen) |
| Free-tier limits | RPM/RPD per model, per project | UNVERIFIED. Forum figures only: flash-lite 500 RPD; flash 20 RPD; older 2.5 flash 10 RPM, 250 RPD. Daily quota resets at midnight Pacific (quoted from the docs in a forum post). |
| Inline audio size | UNVERIFIED (20 MB figure not confirmed) | |
| Training on free data | Yes: pricing page lists "Content used to improve our products" as Yes for the free tier, No for paid | SEEN, `https://ai.google.dev/gemini-api/docs/pricing`, `https://ai.google.dev/gemini-api/terms` ("Unpaid Services") |
| Availability from Saudi Arabia / hosting region | UNVERIFIED (no supported-regions page read) | |
| Accepted audio list for `acceptsAudio` (R48) | `audio/webm`, `audio/ogg`, `audio/aac`, `audio/m4a`, `audio/wav`, `audio/mp3`, `audio/mpeg`, `audio/flac` (not `audio/mp4`) | SEEN (audio page) |
| Requests per minute used for `AI_GLOBAL_MINUTE_*` | none verified, default `null` | UNVERIFIED |

## Groq (speech to text)

| Fact | Value | Status and source |
|---|---|---|
| Base URL | `https://api.groq.com` (constant in code) | design |
| Auth | `Authorization: Bearer <key>` | UNVERIFIED (not seen in a summary) |
| Model ids | `whisper-large-v3`, `whisper-large-v3-turbo` | SEEN, `https://console.groq.com/docs/model/whisper-large-v3`, `.../whisper-large-v3-turbo` |
| Accepted types | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm | SEEN, `https://console.groq.com/docs/speech-to-text` |
| Accepted audio list for `acceptsAudio` (R48) | `audio/mp4`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/flac`, `audio/m4a` | SEEN as above |
| Max upload | 25 MB free tier, 100 MB dev tier | SEEN, speech-to-text page; our cap is 3 000 000 bytes |
| Rate limits (whisper-large-v3) | Developer plan base: 20 RPM, 2 000 RPD, 7 200 audio seconds per hour, 28 800 per day. Free-plan numbers not seen. | UNVERIFIED for the free plan; the rate-limits page is marked old in the summary, and an older models page gave different numbers. Read the org's limits page in the Groq console. |
| Training on free data | UNVERIFIED (no page read) | |
| Availability from Saudi Arabia | UNVERIFIED | |
| Requests per minute used for `AI_GLOBAL_MINUTE_STT` | none verified, default `null` | UNVERIFIED |
| Arabic dialect / Urdu accuracy | UNVERIFIED; test real recordings (spec risk) | |

## OpenRouter

| Fact | Value | Status and source |
|---|---|---|
| Base URL | `https://openrouter.ai` (constant in code) | design |
| Auth | `Authorization: Bearer <key>` | UNVERIFIED |
| Free-model limits | 20 requests per minute, 50 per day; 1 000 per day after buying credit (about $10; a collection page says $9); failed attempts count; `:free` models share the cap | SEEN, `https://openrouter.ai/collections/free-models`, `https://openrouter.ai/docs/faq`, `https://openrouter.ai/pricing`; consistent across several pages but not read in full |
| Free vision / chat model ids | none verified | UNVERIFIED: read `https://openrouter.ai/collections/free-models`; defaults `null` |
| Data policy for free models | Endpoints are tiered (zero data retention, safety retention, retention-and-training). The pricing page marks "Data policy-based routing" unavailable on the free tier; a third-party guide says free endpoints can log prompts and suggests `data_collection: "deny"`. | UNVERIFIED which providers train. Treat free OpenRouter models as possibly logging and training; set the account data policy to deny training and expect fewer free models. |
| Availability from Saudi Arabia | UNVERIFIED | |
| Requests per minute used for `AI_GLOBAL_MINUTE_*` | not primary for any job | n/a |

## Supabase Storage (private photos)

| Fact | Value | Status and source |
|---|---|---|
| Key forms | New: `sb_secret_...` (not a JWT, backend only, bypasses RLS). Legacy: JWT `service_role`. The legacy keys are being retired by end of 2026. | SEEN, `https://supabase.com/docs/guides/getting-started/api-keys`, `.../migrating-to-new-api-keys` |
| Header | `sb_secret_...`: send in the `apikey` header only; sending it as `Authorization: Bearer` can fail with an invalid-JWT error. Legacy JWT: `apikey` and `Authorization: Bearer` | SEEN as above. The project's actual key form is UNVERIFIED until the owner creates the project; the adapter sends `Authorization` only for a JWT-shaped key (R49). |
| REST paths for upload, download, delete | `/storage/v1/object/<bucket>/<path>` (POST upload with `x-upsert: false` and `Content-Type: image/jpeg`, GET download, DELETE) | UNVERIFIED: no raw REST page seen (only the JS client and gateway notes). Task 6 implemented this shape in `src/server/files/supabase-store.ts`, with every path piece and header name in one constant block at the top of the file. A 404, or a 400 whose JSON body says `statusCode: "404"`/`error: "not_found"` (how the storage API has reported a missing object), is treated as missing; 409 as "object exists". The owner's first live run (upload, read back, delete one photo) must confirm the paths, the headers and these status codes. |
| Free plan | 1 GB storage; per-file cap at most 50 MB | SEEN, `https://supabase.com/docs/guides/storage/uploads/file-limits`, `https://supabase.com/pricing` |
| Project URL pattern | `https://<ref>.supabase.co` | design |

## Vercel

| Fact | Value | Status and source |
|---|---|---|
| Request body limit | 4.5 MB default (413 `FUNCTION_PAYLOAD_TOO_LARGE`); 20 MiB opt-in beta on the Node runtime, not used | SEEN, `https://vercel.com/docs/functions/limitations`, `https://vercel.com/changelog/vercel-functions-now-support-request-bodies-up-to-20mib` |
| Function duration, Hobby | 300 s default and maximum (with Fluid compute) | SEEN, `https://vercel.com/docs/functions/configuring-functions/duration`; R33 uses `maxDuration = 60` |

## Browser APIs

| Fact | Status and source |
|---|---|
| `MediaRecorder.isTypeSupported(type)` is the way to pick a type; `false` means unsupported, `true` is not a guarantee. Safari records MP4 (AAC audio); WebM with Opus arrived in Safari 18.4. A WebKit bug report (315091, May 2026) says MP4 recordings can freeze on iOS unless `start()` gets a timeslice (for example 1000 ms); unconfirmed. Recorder should try `audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg` in order. | SEEN, `https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static`, `https://webkit.org/blog/11353/mediarecorder-api/`, `https://webkit.org/blog/16574/webkit-features-in-safari-18-4/` |
| `speechSynthesis.getVoices()` can be empty until the `voiceschanged` event fires (Chrome); each voice has a BCP 47 `lang`. No voice for a language gives a `language-unavailable` error. Which `ar` and `ur` voices exist on iOS and Android is **UNVERIFIED**: test on real devices (the button is hidden when none matches, decision 9). | SEEN, `https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices`, `.../voiceschanged_event`; Apple developer forum thread 653419 mentions an Arabic voice on iOS 13 only |

## Live adapters (Task 4) and the smoke check

Written 2026-11-23. The adapters in `src/server/ai/gemini.ts`, `groq.ts` and `openrouter.ts` were written from the table rows above and the providers' commonly documented request shapes. **Every request shape below is UNVERIFIED** until the owner's smoke run passes; nothing was exercised against a live provider (the unit tests use recorded-shape fixtures and an injected `fetch`).

Each adapter keeps its base URL, API version, path pieces, auth header and accepted audio types in one constant block at the top of its file, so a correction is a few lines:

| Adapter | Constants | Request (UNVERIFIED) |
|---|---|---|
| `gemini.ts` | `BASE`, `API_VERSION` (`v1beta`), `GENERATE_SUFFIX` (`:generateContent`), `KEY_HEADER` (`x-goog-api-key`), `ACCEPTED_AUDIO` (webm, ogg) | `POST {BASE}/{API_VERSION}/models/{encoded model}:generateContent`; `systemInstruction`, `contents` with `inlineData`, `generationConfig` with `temperature` and (vision, chat) `responseMimeType: application/json`; no tools. Reply text from `candidates[0].content.parts[].text`, tokens from `usageMetadata`. |
| `groq.ts` | `BASE`, `TRANSCRIPTIONS_PATH` (`/openai/v1/audio/transcriptions`), `AUTH_HEADER`, `FILE_NAME` (m4a, webm, ogg), `ACCEPTED_AUDIO` | multipart `file`, `model`, `language`, `response_format=json`, `temperature=0`; reply `{ text }`. |
| `openrouter.ts` | `BASE`, `CHAT_PATH` (`/api/v1/chat/completions`), `AUTH_HEADER`, `IMAGE_URL_PREFIX` | `model`, `messages` (JPEG as a data URL part), `max_tokens`, `temperature`; no tools; reply `choices[0].message.content`, tokens from `usage`. |

The model id is also checked in the adapter before it goes into a URL path (`models.ts`): ids that do not match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$` or contain `..` make no request; the rest are passed through `encodeURIComponent`.

**Thinking tokens (decision, UNVERIFIED).** Gemini models that think count thinking tokens against `maxOutputTokens`, so a small budget can end as `finishReason: MAX_TOKENS` with no text (the adapter maps that to `invalid_output`). The adapter therefore sends `generationConfig.thinkingConfig = { thinkingBudget: 0 }` by default and asks for at least 1024 output tokens for vision and chat (2048 for speech to text). `AI_GEMINI_THINKING` changes it without code: `off` (budget 0), `low` (`thinkingLevel: "low"`), `default` (send nothing), or a whole token budget. Which field a given model accepts is not verified; a 400 in the smoke table (the `http` column) means flip the setting. Reported output tokens are `candidatesTokenCount + thoughtsTokenCount`.

### Smoke check

`AI_SMOKE=1 pnpm ai:smoke` (never run by tests, e2e or CI; refuses when `CI` is set). It first lists the models each key can use (Gemini models that support `generateContent`; Groq models; free OpenRouter models, with an `[image]` marker for vision) and says whether `gemini-4-hydrogen` and the configured ids are in the list. Then it makes one tiny call per job with a synthetic 64x64 JPEG (text `CASH 100`) and a synthetic one-second tone, and prints a table of provider, job, model, HTTP status (400 request shape, 401/403 key, 404 model id, 429 limit), outcome code, Gemini `finishReason`, latency and whether the reply parsed. It prints no key and no response body and writes nothing. The speech-to-text calls send a WAV tone (the recorder types are not producible in the script), so they check endpoint, auth and model, not Arabic accuracy or the webm/mp4/ogg path.

**Live smoke run: not run with a real key** (2026-11-23). A run with `AI_SMOKE_PROXY_AUTH=1` reached `generativelanguage.googleapis.com` but got HTTP 400 for the placeholder key, and `api.groq.com` and `openrouter.ai` were unreachable from the session, so no result says anything about the providers. The owner must run it with real keys and copy the model lists and the table here; until then `gemini-3.5-flash-lite` and all limits above remain unconfirmed (R66).

## Where things stand at the end of plan 3 (Task 20, 2026-11-25)

**What has been checked, and by what.** Everything the app does with a model reply (parsing, field mapping, the confirm gate, the assistant's number checks, quotas, retention, who may open a photo) is covered by unit tests and by `pnpm e2e:ai`, which drives the whole flow in a browser against the **fake provider only**, with no key in the environment and every request to another host aborted. That proves the app's behaviour. It says **nothing** about a real provider.

**What the smoke check has verified: nothing live.** `AI_SMOKE=1 pnpm ai:smoke` has not been run with a real key (see above). So these are all still UNVERIFIED and are the owner's first tasks:

1. The real model ids. `gemini-4-hydrogen` was not found; `gemini-3.5-flash-lite` and `whisper-large-v3` are defaults taken from search summaries. Run the smoke check, read its model lists, and set `AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL`, `AI_GROQ_STT_MODEL` (and the OpenRouter ones) as Production variables.
2. Every request shape in the adapter table (paths, auth headers, JSON mode, thinking setting) and every rate limit and daily limit in the provider tables.
3. The Supabase Storage REST shape and its missing-object and conflict status codes: confirm with one live upload, read and delete of a return photo.
4. Whether each free tier may use submitted content to improve its services: Google's pricing page says yes for the free Gemini tier; Groq's and OpenRouter's terms were not read.

**What is unverified on a real iPhone** (week-one checks; the steps are in `docs/DEPLOY.md`, section 7): camera capture for return photos; recording as `audio/mp4` in Safari, the permission prompt, a note cut by locking the phone, and the file-picker fallback; whether the iPhone has Arabic (and Urdu) `speechSynthesis` voices and whether speech starts from a tap; reading a real day-end report photo from the sales program; and how well real Arabic dialect recordings are heard. Headless Chromium with a fake microphone covered the recorder's logic and the draft flow only.

**What to do with the first real report.** Open `/admin/ai/mapping` and write each field's name as the report prints it. Until then the reader relies on the built-in names.

## Hosts to allow for outbound requests

`generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, and the project's `<ref>.supabase.co`.

## Still to confirm (before real use)

1. Read the live Gemini rate-limit page and AI Studio quota for the chosen model; set `AI_GLOBAL_DAY_*` to 80 percent of the daily quota and `AI_GLOBAL_MINUTE_*` to 40 percent of the per-minute limit (one request can make up to 4 provider calls).
2. Confirm flash-lite accepts image and audio input and that `gemini-3.5-flash-lite` is not itself deprecated.
3. Pick a free OpenRouter vision and chat model and set the ids.
4. Read Groq's free-plan limits in the console.
5. Create the Supabase project, note the key form, confirm the Storage REST paths.
6. Run `scripts/ai-smoke.mjs` (Task 4) with real keys.
7. Check the chat provider's tokens-per-minute limit against the assistant's prompt size (R81). One question sends up to `AI_CONTEXT_MAX` characters of context (default 60 000, the plan's limit; allowed 5 000 to 60 000). In Arabic that is roughly 25 000 to 30 000 tokens, so two or three questions in one minute can reach a free tier's tokens-per-minute limit even while the request counters allow more. If live answers hit `rate_limited` this way, lower `AI_CONTEXT_MAX` (policy sections are then ranked by the question and the best ones kept; facts and incentives always come first).

## Notice wording and paid providers

The rep notice and the admin page say the services are free during the trial and may use what is sent to improve their products (`ai.notice.p2`, `admin.ai.points`). If any paid provider or plan is enabled, that "free during the trial" copy must be updated in all three catalogs and `AI_NOTICE_VERSION` bumped so reps accept the notice again.

## What a close's source means (R74)

`daily_closes.source` labels the last confirmed save. `photo` or `voice` means a draft was read for this rep and day, and the rep confirmed with that draft's receipt within 24 hours. It is not evidence of where the figures came from, because the rep reviews and may change every field before he confirms. A later confirm without a receipt (or a second confirm with the same, already used receipt) sets the close back to `manual`. A close confirmed by photo keeps one report photo: the one the figures were last read from. Earlier report photos of that close are deleted.

## Voice recording on iOS Safari (Task 14): NOT verified on a real device

The recorder picks `audio/webm;codecs=opus`, then `audio/mp4`, then `audio/ogg;codecs=opus` (`src/ui/recorder.ts`); iOS Safari is expected to give `audio/mp4`, and a browser without a microphone API or `MediaRecorder` (or an insecure page) gets a file picker (`accept="audio/*"`, no `capture`) instead. This was checked only in Chromium with a fake microphone (webm) and by unit tests of the type choice. No iPhone or Safari was available, so recording as `audio/mp4`, the permission prompt, the stop on a hidden page and the file-picker fallback on iOS are **unverified**; the server's MP4 sniffing is covered by tests, and Groq and Gemini acceptance of iOS recordings is covered by the smoke note above (also unverified).

## Read-aloud on iPhone (Task 17): speechSynthesis Arabic and Urdu voices NOT verified

The assistant's read-aloud button uses the phone's own `speechSynthesis` voices only (`src/ui/components/ReadAloud.tsx`, `src/ui/speech.ts`). The button appears only when the phone lists a voice whose language starts with the rep's language (`ar`, `en` or `ur`), waiting at most 1.5 s for the list; otherwise the rep sees the answer written, with a hint once per device. It was checked in headless Chromium, which has no voices (so only the no-voice path ran). **Whether iOS Safari offers Arabic (`ar-SA`) and Urdu (`ur-PK`/`ur-IN`) voices, and whether its speech starts from a tap inside a PWA, is NOT verified on a real iPhone.** Check on a device before relying on it; the server-side read-aloud fallback is deferred (R60).
