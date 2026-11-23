# AI providers: verified facts and open checks

Written 2026-11-23 (Task 1 of plan 3).

## How this was researched, and its limit

The session's network blocked direct reads of the providers' own pages (`ai.google.dev`, `console.groq.com` did not resolve for the page fetcher; the crawler tool was declined by the owner). The facts below therefore come from **web-search result summaries of the providers' official pages**, which name the page address. No page was read in full. Because of that, every limit is marked **UNVERIFIED (search summary only)** unless the search summary quoted the official page directly and consistently; nothing was taken from memory. Task 4's opt-in smoke check and a person reading the live pages must confirm the rows marked UNVERIFIED before any default is raised. Forum posts are recorded only as pointers, never as verification.

Status words: **SEEN** = stated in a search summary of the official page named in the row (date 2026-11-23); **UNVERIFIED** = not seen, conflicting, or forum-only.

## Differences from the design

1. **`gemini-4-hydrogen` was not found.** The current Gemini docs (search summaries of `https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash`, `.../gemini-3.5-flash-lite`, `.../whats-new-gemini-3.5`, and the example code on `https://ai.google.dev/api/generate-content`) name `gemini-3.5-flash` (reported deprecated and routed to `gemini-3.6-flash`), `gemini-3.5-flash-lite`, and `gemini-3.8-flash` (used in doc examples; the docs disagree on the newest id). No page mentions a "Gemini 4" or "hydrogen" model. Default used in `config.ts` for the three Gemini jobs: **`gemini-3.5-flash-lite`** (the only id with a free-tier daily figure we saw, 500 requests per day, from a forum post, UNVERIFIED). Image and audio input for the flash-lite page is UNVERIFIED (the flash page states text, image, video, audio and PDF input, text output). Override with `AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL`.
2. **Free-tier Gemini limits have changed repeatedly** (forum reports: Flash 250 to 20 requests per day in Dec 2025; flash-lite 500 per day). The design's 400/600/800 deployment-wide daily defaults cannot be checked against a verified figure, so they are kept and flagged. Gemini's daily quota is per project and per model; the three Gemini jobs share one model by default, so the sum of the Gemini-backed jobs (vision plus chat) may exceed it. UNVERIFIED; set `AI_GLOBAL_DAY_*` after reading the live quota page in AI Studio.
3. **Gemini free-tier content may be used to improve Google's products** (pricing page and Additional Terms, see below). This matters for report photos and questions; the notice (Task 5) must say so, or a billed project must be used.
4. **OpenRouter has no verified free vision or chat model id** in this research, so `openrouter.visionModel` and `chatModel` default to `null` (the fallback is disabled until an operator sets `AI_OPENROUTER_*_MODEL` after reading `https://openrouter.ai/collections/free-models`).
5. **Per-minute limits were not verified for any provider**, so `globalMinute` defaults to `null` for all three kinds (no deployment-wide minute counter until the operator sets `AI_GLOBAL_MINUTE_*`; R65).
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
| REST paths for upload, download, delete | `/storage/v1/object/<bucket>/<path>` (POST upload, GET download, DELETE) | UNVERIFIED: no raw REST page seen (only the JS client and gateway notes); Task 6 reads `https://supabase.com/docs/reference/storage` before coding |
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

## Hosts to allow for outbound requests

`generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, and the project's `<ref>.supabase.co`.

## Still to confirm (before real use)

1. Read the live Gemini rate-limit page and AI Studio quota for the chosen model; set `AI_GLOBAL_DAY_*` and `AI_GLOBAL_MINUTE_*` to 80 percent of them.
2. Confirm flash-lite accepts image and audio input and that `gemini-3.5-flash-lite` is not itself deprecated.
3. Pick a free OpenRouter vision and chat model and set the ids.
4. Read Groq's free-plan limits in the console.
5. Create the Supabase project, note the key form, confirm the Storage REST paths.
6. Run `scripts/ai-smoke.mjs` (Task 4) with real keys.
