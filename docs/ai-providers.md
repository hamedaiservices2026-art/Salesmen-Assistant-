# AI providers: verified facts and open checks

Written 2026-11-23 (Task 1 of plan 3); brought up to date 2026-11-25 (Task 20); corrected after the first live test of the providers on 2026-11-26 ("Live findings" below).

## How this was researched, and its limit

The first version (2026-11-23) came from **web-search result summaries** of the providers' pages, because the session could not read them. **On 2026-11-26 the providers were tested live with the owner's real keys** (model lists, one call per job, the Supabase Storage calls). Where a row says "verified live on 2026-11-26 with the owner's keys" it was observed in a real response that day; where the old search-summary claim and the live result disagreed, the live result wins and the old claim is gone. Rows still marked **UNVERIFIED** were not observed: free-tier request limits per minute and per day for Gemini and Groq, behaviour on a real iPhone, and availability from Saudi Arabia. Forum posts are pointers only.

Status words: **VERIFIED LIVE** = observed 2026-11-26; **SEEN** = stated in a search summary of the official page named (2026-11-23), not re-checked live; **UNVERIFIED** = not seen, conflicting, or forum-only.

## Differences from the design

1. **The design's model id is correct; the docs search summaries were wrong.** `gemini-4-hydrogen` exists in the Gemini model list (verified live on 2026-11-26 with the owner's keys) and supports `generateContent` with 1,048,576 input and 65,536 output tokens. It is the default for the three Gemini jobs (`config.ts`). It is a new model: on 2026-11-26 it answered **HTTP 503 "currently experiencing high demand"** on every call, so the app has a same-provider model fallback (`AI_GEMINI_FALLBACK_MODEL`, default `gemini-3.5-flash-lite`, which answered 200 and text in one token that day; see "Model fallback"). Override with `AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL`.
2. **Free-tier Gemini limits have changed repeatedly** (forum reports: Flash 250 to 20 requests per day in Dec 2025; flash-lite 500 per day). The design's 400/600/800 deployment-wide daily defaults cannot be checked against a verified figure, so they are kept and flagged. Gemini's daily quota is per project and per model; the three Gemini jobs share one model by default, so the sum of the Gemini-backed jobs (vision plus chat) may exceed it. UNVERIFIED; set `AI_GLOBAL_DAY_*` after reading the live quota page in AI Studio.
3. **Gemini free-tier content may be used to improve Google's products** (pricing page and Additional Terms, see below). This matters for report photos and questions; the notice (Task 5) must say so, or a billed project must be used.
4. **OpenRouter defaults are now `google/gemma-4-31b-it:free`** for vision and chat (image capable, listed live on 2026-11-26; override with `AI_OPENROUTER_VISION_MODEL`, `AI_OPENROUTER_CHAT_MODEL`). The fallback is used whenever `OPENROUTER_API_KEY` is set. Free models are rate limited (the first live call answered 429) and their endpoints may log or train on prompts: see the OpenRouter table.
5. **Per-minute limits were not verified for any provider**, so `globalMinute` defaults to `null` for all three kinds (no deployment-wide minute counter until the operator sets `AI_GLOBAL_MINUTE_*`; R65). One request in this app can make up to 5 provider calls (2 attempts on the primary Gemini model, 1 on the Gemini fallback model, then 2 on the next provider; `MAX_ATTEMPTS_PER_PROVIDER` in `src/server/ai/run.ts`), while the counters count it once, so set each `AI_GLOBAL_MINUTE_*` to about 30 percent of the provider's verified per-minute limit.
6. **Supabase is retiring the `service_role` and anon keys by the end of 2026** in favour of `sb_secret_...` and `sb_publishable_...` keys. The adapter handles both forms (R49); the Storage shape was verified live (see the Supabase table).
7. **Vercel accepts request bodies up to 4.5 MB by default**, so the 4 000 000 byte upload limit stands. A 20 MiB opt-in beta exists but is not used.

## Gemini (Google AI Studio API)

| Fact | Value | Status and source |
|---|---|---|
| Base URL, path, version | `https://generativelanguage.googleapis.com`, `/v1beta/models/{model}:generateContent` | verified live on 2026-11-26 with the owner's keys: the adapter's calls answered 200 |
| Auth | `x-goog-api-key` header | verified live on 2026-11-26 with the owner's keys (200 with the key header) |
| Model ids | In the live model list: `gemini-4-hydrogen`, `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-neon`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-3.5-transcribe`. `gemini-2.5-flash` answers 404 "no longer available to new users". `gemini-4-hydrogen`: `generateContent`, 1,048,576 input and 65,536 output tokens | verified live on 2026-11-26 with the owner's keys |
| Availability on 2026-11-26 | `gemini-4-hydrogen` answered HTTP 503 "currently experiencing high demand" on every call (transient; new model). `gemini-3.8-flash` also returned 503 at times. `gemini-3.5-flash-lite` answered 200 and text in one token. The app handles this with the model fallback. | verified live on 2026-11-26 with the owner's keys |
| Image input | inline base64 part with MIME type (`inlineData`), JPEG | verified live on 2026-11-26 with the owner's keys: vision passed on `gemini-3.5-flash-lite` with a synthetic image |
| Audio input | inline base64 or File API; types WAV `audio/wav`, MP3 `audio/mp3`, AIFF, AAC `audio/aac`, OGG `audio/ogg`, FLAC, MPEG, M4A `audio/m4a`, L16, Opus, A-law, mu-law, WebM `audio/webm` | SEEN, `https://ai.google.dev/gemini-api/docs/audio`; `audio/mp4` is not in the list, so it is treated as not accepted |
| JSON-only output | `responseMimeType: "application/json"` in generation config | verified live on 2026-11-26 with the owner's keys: vision and chat replies parsed as JSON (200, `finishReason` STOP) |
| Thinking config | `generationConfig.thinkingConfig.thinkingBudget: 0` is **rejected with HTTP 400 INVALID_ARGUMENT** by Gemini 3.x and 4 (reproduced with curl on `gemini-3.5-flash-lite`). `thinkingConfig: {thinkingLevel: "low"}` and `"minimal"` answer 200, and omitting `thinkingConfig` answers 200. | verified live on 2026-11-26 with the owner's keys. The adapter default is `thinkingLevel: low`; `AI_GEMINI_THINKING=off` means `minimal`. |
| Free-tier limits | RPM/RPD per model, per project | **UNVERIFIED (not observable from one call).** Forum figures only: flash-lite 500 RPD; flash 20 RPD; older 2.5 flash 10 RPM, 250 RPD. Daily quota resets at midnight Pacific (quoted from the docs in a forum post). |
| Inline audio size | UNVERIFIED (20 MB figure not confirmed) | |
| Speech to text on Gemini | A synthetic 440 Hz WAV tone was accepted inline (`audio/wav`) and answered 200 on `gemini-3.5-flash-lite`; the adapter itself only sends `audio/webm` and `audio/ogg`. Arabic accuracy not tested. `gemini-3.5-transcribe` also exists in the model list (not used). | verified live on 2026-11-26 with the owner's keys (endpoint, auth, model); accuracy UNVERIFIED |
| Training on free data | Yes: pricing page lists "Content used to improve our products" as Yes for the free tier, No for paid | SEEN, `https://ai.google.dev/gemini-api/docs/pricing`, `https://ai.google.dev/gemini-api/terms` ("Unpaid Services") |
| Availability from Saudi Arabia / hosting region | UNVERIFIED (no supported-regions page read) | |
| Audio types the provider accepts | `audio/webm`, `audio/ogg`, `audio/aac`, `audio/m4a`, `audio/wav`, `audio/mp3`, `audio/mpeg`, `audio/flac` (not `audio/mp4`) | SEEN (audio page) |
| Audio types the app sends (`ACCEPTED_AUDIO` in `gemini.ts`, `acceptsAudio`; R48) | `audio/webm`, `audio/ogg` (the server sniffs only `audio/mp4`, `audio/webm`, `audio/ogg`; an iPhone's `audio/mp4` is never sent to Gemini) | code |
| Requests per minute used for `AI_GLOBAL_MINUTE_*` | none verified, default `null` | UNVERIFIED |

## Groq (speech to text)

| Fact | Value | Status and source |
|---|---|---|
| Base URL | `https://api.groq.com` (constant in code) | design |
| Auth | `Authorization: Bearer <key>` | verified live on 2026-11-26 with the owner's keys (200) |
| Endpoint | `POST /openai/v1/audio/transcriptions` multipart (`file`, `model`, `language`, `response_format=json`, `temperature=0`), reply `{ text }` | verified live on 2026-11-26 with the owner's keys: the adapter's STT call passed, HTTP 200 in about 0.4 to 1 s |
| Model ids | `whisper-large-v3` and `whisper-large-v3-turbo` are in the live list (11 models in all). `canopylabs/orpheus-arabic-saudi` (an Arabic text-to-speech model) is also listed: noted only, not used by the app. | verified live on 2026-11-26 with the owner's keys |
| Accepted types | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm | SEEN, `https://console.groq.com/docs/speech-to-text` |
| Audio types the provider accepts | `audio/mp4`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/flac`, `audio/m4a` | SEEN as above |
| Audio types the app sends (`ACCEPTED_AUDIO` in `groq.ts`, `acceptsAudio`; R48) | `audio/mp4`, `audio/webm`, `audio/ogg` (the three types the server sniffs) | code |
| Max upload | 25 MB free tier, 100 MB dev tier | SEEN, speech-to-text page; our cap is 3 000 000 bytes |
| Rate limits (whisper-large-v3) | Developer plan base: 20 RPM, 2 000 RPD, 7 200 audio seconds per hour, 28 800 per day. Free-plan numbers not seen. | **UNVERIFIED** (not observable from a single call); the rate-limits page is marked old in the summary, and an older models page gave different numbers. Read the org's limits page in the Groq console. |
| Training on free data | UNVERIFIED (no page read) | |
| Availability from Saudi Arabia | UNVERIFIED | |
| Requests per minute used for `AI_GLOBAL_MINUTE_STT` | none verified, default `null` | UNVERIFIED |
| Arabic dialect / Urdu accuracy | UNVERIFIED; test real recordings (spec risk) | |

## OpenRouter

| Fact | Value | Status and source |
|---|---|---|
| Base URL | `https://openrouter.ai` (constant in code) | design |
| Auth | `Authorization: Bearer <key>` | verified live on 2026-11-26 with the owner's keys (the key was accepted; the free model answered 200 once and 429 otherwise) |
| Free-model limits | 20 requests per minute, 50 per day; 1 000 per day after buying credit (about $10; a collection page says $9); failed attempts count; `:free` models share the cap | SEEN, `https://openrouter.ai/collections/free-models`, `https://openrouter.ai/docs/faq`, `https://openrouter.ai/pricing`; consistent across several pages but not read in full |
| Free vision / chat model ids | Free models in the live list (14) include the image-capable `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, `nvidia/nemotron-3.5-super-vl:free` and the router `openrouter/free`. Defaults: `google/gemma-4-31b-it:free` for vision and chat. | verified live on 2026-11-26 with the owner's keys |
| Live behaviour | The first free-model call answered **429 rate_limited** (the 20 per minute, 50 per day class limits). In the smoke run, vision answered 200 in 2.7 s (a synthetic image read and JSON parsed) once the limit allowed it; chat was 429 even after a retry 20 s later. Expect the OpenRouter fallback to be unreliable under load. | verified live on 2026-11-26 with the owner's keys |
| Data policy for free models | **Caveat:** free OpenRouter models may log and train on prompts. Endpoints are tiered (zero data retention, safety retention, retention-and-training). The pricing page marks "Data policy-based routing" unavailable on the free tier; a third-party guide says free endpoints can log prompts and suggests `data_collection: "deny"`. | UNVERIFIED which providers train. Treat free OpenRouter models as possibly logging and training; set the account data policy to deny training and expect fewer free models. |
| Availability from Saudi Arabia | UNVERIFIED | |
| Requests per minute used for `AI_GLOBAL_MINUTE_*` | not primary for any job | n/a |

## Supabase Storage (private photos)

| Fact | Value | Status and source |
|---|---|---|
| Key forms | New: `sb_secret_...` (not a JWT, backend only, bypasses RLS). Legacy: JWT `service_role`. The legacy keys are being retired by end of 2026. | SEEN, `https://supabase.com/docs/guides/getting-started/api-keys`, `.../migrating-to-new-api-keys` |
| Header | `sb_secret_...`: send in the `apikey` header only; sending it as `Authorization: Bearer` can fail with an invalid-JWT error. Legacy JWT: `apikey` and `Authorization: Bearer` | SEEN as above. The project's actual key form is UNVERIFIED until the owner creates the project; the adapter sends `Authorization` only for a JWT-shaped key (R49). |
| REST paths for upload, download, delete | `/storage/v1/object/<bucket>/<path>` (POST upload with `x-upsert: false`, GET download, DELETE) | verified live on 2026-11-26 with the owner's keys, project host `bjsxtckyttqmhqlxwshp.supabase.co`, private bucket `private-files` (public=false): POST new object 200; **duplicate POST: HTTP 400 with body `{statusCode: "409", error: "Duplicate"}`**; GET 200 with the bytes; **GET of a missing object: HTTP 400 `{error: "not_found"}`**; DELETE 200 "Successfully deleted"; **DELETE of a missing object: HTTP 400 not_found**. The app's `supabaseStore` adapter (`src/server/files/supabase-store.ts`) passed put, duplicate, get, missing, remove and remove-again against the real project, so a 400 whose JSON body says `statusCode: "409"` is "object exists" and `error: "not_found"` is "missing". |
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

Written 2026-11-23. The adapters in `src/server/ai/gemini.ts`, `groq.ts` and `openrouter.ts` were written from the table rows above and the providers' commonly documented request shapes. The request shapes below were **verified live on 2026-11-26 with the owner's keys** by the smoke run (see "Live findings"); the unit tests use recorded-shape fixtures and an injected `fetch`.

Each adapter keeps its base URL, API version, path pieces, auth header and accepted audio types in one constant block at the top of its file, so a correction is a few lines:

| Adapter | Constants | Request (verified live 2026-11-26) |
|---|---|---|
| `gemini.ts` | `BASE`, `API_VERSION` (`v1beta`), `GENERATE_SUFFIX` (`:generateContent`), `KEY_HEADER` (`x-goog-api-key`), `ACCEPTED_AUDIO` (webm, ogg: what the app sends) | `POST {BASE}/{API_VERSION}/models/{encoded model}:generateContent`; `systemInstruction`, `contents` with `inlineData`, `generationConfig` with `temperature` and (vision, chat) `responseMimeType: application/json`; no tools. Reply text from `candidates[0].content.parts[].text`, tokens from `usageMetadata`. |
| `groq.ts` | `BASE`, `TRANSCRIPTIONS_PATH` (`/openai/v1/audio/transcriptions`), `AUTH_HEADER`, `FILE_NAME` (m4a, webm, ogg), `ACCEPTED_AUDIO` | multipart `file`, `model`, `language`, `response_format=json`, `temperature=0`; reply `{ text }`. |
| `openrouter.ts` | `BASE`, `CHAT_PATH` (`/api/v1/chat/completions`), `AUTH_HEADER`, `IMAGE_URL_PREFIX` | `model`, `messages` (JPEG as a data URL part), `max_tokens`, `temperature`; no tools; reply `choices[0].message.content`, tokens from `usage`. |

The model id is also checked in the adapter before it goes into a URL path (`models.ts`): ids that do not match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$` or contain `..` make no request; the rest are passed through `encodeURIComponent`.

**Thinking tokens.** Gemini models that think count thinking tokens against `maxOutputTokens`, so a small budget can end as `finishReason: MAX_TOKENS` with no text (the adapter maps that to `invalid_output`). Verified live on 2026-11-26: Gemini 3.x and 4 **reject `thinkingBudget: 0` with HTTP 400**, and accept `thinkingLevel` `"low"` and `"minimal"`. The adapter therefore sends `generationConfig.thinkingConfig = { thinkingLevel: "low" }` by default and asks for at least 1024 output tokens for vision and chat (2048 for speech to text). `AI_GEMINI_THINKING`: `low` (default), `off` (means `thinkingLevel: "minimal"`), `default` (send nothing), or a whole number (sent as `thinkingBudget`, for models that take one). Reported output tokens are `candidatesTokenCount + thoughtsTokenCount`.

**Model fallback.** The provider order is unchanged (Gemini, then OpenRouter; voice: Groq, then Gemini). Inside Gemini, when the primary model answers 503 (overloaded) or 429 after its normal retry budget (two attempts), the runner makes one more attempt with `AI_GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`; `none` turns it off; equal to the primary means none). That attempt is inside the same 25 s deadline. The usage row records the model that actually answered and `fallback: true`. A 400 or 404 on the primary (a request or model-id problem) does not use the fallback model. If the fallback model also fails, the next provider (OpenRouter) is tried. Tests: `src/server/ai/model-fallback.test.ts`.

### Smoke check

`AI_SMOKE=1 pnpm ai:smoke` (never run by tests, e2e or CI; refuses when `CI` is set). It first lists the models each key can use (Gemini models that support `generateContent`; Groq models; free OpenRouter models, with an `[image]` marker for vision) and says whether `gemini-4-hydrogen` and the configured ids are in the list. Then it makes one tiny call per job (Gemini and OpenRouter vision and chat go through the app's runner, so the Gemini fallback model applies; an OpenRouter 429 is retried once after 20 s) with a synthetic 64x64 JPEG (text `CASH 100`) and a synthetic one-second tone, and prints a table of provider, job, the model that actually answered, whether it was the fallback model, HTTP status (400 request shape, 401/403 key, 404 model id, 429 limit), outcome code, Gemini `finishReason`, latency and whether the reply parsed. It prints no key and no response body and writes nothing. The speech-to-text calls send a WAV tone (the recorder types are not producible in the script), so they check endpoint, auth and model, not Arabic accuracy or the webm/mp4/ogg path.

## Live findings (2026-11-26, first live test with the owner's keys)

Run: `AI_SMOKE=1 AI_SMOKE_PROXY_AUTH=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt pnpm ai:smoke` (the sandbox proxy injects the real credentials; no key or response body is printed). Model lists: Gemini 49 models with `generateContent`; Groq 11; OpenRouter 14 free.

Defaults (hydrogen primary, fallback `gemini-3.5-flash-lite`). `gemini-4-hydrogen` answered 503 that day, so the fallback model answered:

| provider | job | model that answered | fallback | http | outcome | finish | latency ms | parsed | result |
|---|---|---|---|---|---|---|---|---|---|
| gemini | vision | gemini-3.5-flash-lite | yes | 200 | ok | STOP | 17263 | yes | PASS |
| gemini | chat | gemini-3.5-flash-lite | yes | 200 | ok | STOP | 6890 | yes | PASS |
| openrouter | vision | google/gemma-4-31b-it:free | no | 429 | rate_limited | - | 20797 | - | FAIL |
| openrouter | chat | google/gemma-4-31b-it:free | no | 429 | rate_limited | - | 20837 | - | FAIL |
| groq | stt | whisper-large-v3 | no | 200 | ok | - | 321 | yes | PASS |
| gemini | stt | gemini-3.5-flash-lite | yes | 200 | ok | - | 8198 | yes | PASS |

Pinned to a model that is up (`AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL` = `gemini-3.5-flash-lite`, `AI_GEMINI_FALLBACK_MODEL=none`), proving the adapter shapes (vision with a synthetic image, chat JSON, speech to text with a tone):

| provider | job | model that answered | fallback | http | outcome | finish | latency ms | parsed | result |
|---|---|---|---|---|---|---|---|---|---|
| gemini | vision | gemini-3.5-flash-lite | no | 200 | ok | STOP | 4003 | yes | PASS |
| gemini | chat | gemini-3.5-flash-lite | no | 200 | ok | STOP | 439 | yes | PASS |
| openrouter | vision | google/gemma-4-31b-it:free | no | 200 | ok | - | 2664 | yes | PASS |
| openrouter | chat | google/gemma-4-31b-it:free | no | 429 | rate_limited | - | 20628 | - | FAIL |
| groq | stt | whisper-large-v3 | no | 200 | ok | - | 336 | yes | PASS |
| gemini | stt | gemini-3.5-flash-lite | no | 200 | ok | - | 865 | yes | PASS |

Reading the tables: every Gemini and Groq row passes on a model that is up. The only failures are OpenRouter free-model 429s (the free tier's rate limit, not an adapter problem; vision passed with 200 in the second run). Because the first `gemini-4-hydrogen` attempts also cost time (two attempts, then the fallback), the default-run Gemini latencies were 7 to 17 s: that is the price of the 503s and should drop when hydrogen is available.

**Findings that changed the code.** (1) Gemini 3.x and 4 reject `thinkingBudget: 0` (HTTP 400), so the default is now `thinkingLevel: low`. (2) `gemini-4-hydrogen` is real but overloaded, so there is a model fallback. (3) OpenRouter has verified free image-capable defaults. (4) Supabase Storage's errors arrive as HTTP 400 with a JSON body (`not_found`, `409 Duplicate`); the adapter already handled both.

**Still unverified after this run:** free-tier request limits per minute and per day for Gemini and Groq; Arabic and Urdu speech accuracy; availability from Saudi Arabia; all iPhone behaviour (below); whether Groq's free tier trains on submitted audio.

## Where things stand at the end of plan 3 (Task 20, 2026-11-25)

**What has been checked, and by what.** Everything the app does with a model reply (parsing, field mapping, the confirm gate, the assistant's number checks, quotas, retention, who may open a photo) is covered by unit tests and by `pnpm e2e:ai`, which drives the whole flow in a browser against the **fake provider only**, with no key in the environment and every request to another host aborted. That proves the app's behaviour. It says **nothing** about a real provider.

**What the smoke check has verified live (2026-11-26).** The model ids, the Gemini, Groq and OpenRouter request shapes, the thinking setting and the Supabase Storage shape: see "Live findings". Still the owner's tasks:

1. Read the live quota pages for the free tiers (Gemini and Groq requests per minute and per day) and set `AI_GLOBAL_DAY_*` and `AI_GLOBAL_MINUTE_*` from them.
2. Check `gemini-4-hydrogen` again when it is no longer overloaded; until then the fallback model answers.
3. Whether Groq's and OpenRouter's free tiers may use submitted content to improve their services (Google's pricing page says yes for the free Gemini tier; OpenRouter free endpoints may log and train).

**What is unverified on a real iPhone** (week-one checks; the steps are in `docs/DEPLOY.md`, section 7): camera capture for return photos; recording as `audio/mp4` in Safari, the permission prompt, a note cut by locking the phone, and the file-picker fallback; whether the iPhone has Arabic (and Urdu) `speechSynthesis` voices and whether speech starts from a tap; reading a real day-end report photo from the sales program; and how well real Arabic dialect recordings are heard. Headless Chromium with a fake microphone covered the recorder's logic and the draft flow only.

**What to do with the first real report.** Open `/admin/ai/mapping` and write each field's name as the report prints it. Until then the reader relies on the built-in names.

## Hosts to allow for outbound requests

`generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, and the project's `<ref>.supabase.co`.

## Still to confirm (before real use)

1. Read the live Gemini rate-limit page and AI Studio quota for the chosen models; set `AI_GLOBAL_DAY_*` to 80 percent of the daily quota and `AI_GLOBAL_MINUTE_*` to 30 percent of the per-minute limit (one request can make up to 5 provider calls).
2. Re-run `AI_SMOKE=1 pnpm ai:smoke` when `gemini-4-hydrogen` is stable, to see it answer without the fallback.
3. Read Groq's free-plan limits in the console.
4. Test Arabic and Urdu recordings, and the Saudi-region availability of each provider.
5. Check the chat provider's tokens-per-minute limit against the assistant's prompt size (R81). One question sends up to `AI_CONTEXT_MAX` characters of context (default 60 000, the plan's limit; allowed 5 000 to 60 000). In Arabic that is roughly 25 000 to 30 000 tokens, so two or three questions in one minute can reach a free tier's tokens-per-minute limit even while the request counters allow more. If live answers hit `rate_limited` this way, lower `AI_CONTEXT_MAX` (policy sections are then ranked by the question and the best ones kept; facts and incentives always come first).

## Notice wording and paid providers

The rep notice and the admin page say the services are free during the trial and may use what is sent to improve their products (`ai.notice.p2`, `admin.ai.points`). If any paid provider or plan is enabled, that "free during the trial" copy must be updated in all three catalogs and `AI_NOTICE_VERSION` bumped so reps accept the notice again.

## What a close's source means (R74)

`daily_closes.source` labels the last confirmed save. `photo` or `voice` means a draft was read for this rep and day, and the rep confirmed with that draft's receipt within 24 hours. It is not evidence of where the figures came from, because the rep reviews and may change every field before he confirms. A later confirm without a receipt (or a second confirm with the same, already used receipt) sets the close back to `manual`. A close confirmed by photo keeps one report photo: the one the figures were last read from. Earlier report photos of that close are deleted.

## Voice recording on iOS Safari (Task 14): NOT verified on a real device

The recorder picks `audio/webm;codecs=opus`, then `audio/mp4`, then `audio/ogg;codecs=opus` (`src/ui/recorder.ts`); iOS Safari is expected to give `audio/mp4`, and a browser without a microphone API or `MediaRecorder` (or an insecure page) gets a file picker (`accept="audio/*"`, no `capture`) instead. This was checked only in Chromium with a fake microphone (webm) and by unit tests of the type choice. No iPhone or Safari was available, so recording as `audio/mp4`, the permission prompt, the stop on a hidden page and the file-picker fallback on iOS are **unverified**; the server's MP4 sniffing is covered by tests, and Groq accepted a synthetic WAV tone live, but acceptance of real iOS `audio/mp4` recordings is unverified.

## Read-aloud on iPhone (Task 17): speechSynthesis Arabic and Urdu voices NOT verified

The assistant's read-aloud button uses the phone's own `speechSynthesis` voices only (`src/ui/components/ReadAloud.tsx`, `src/ui/speech.ts`). The button appears only when the phone lists a voice whose language starts with the rep's language (`ar`, `en` or `ur`), waiting at most 1.5 s for the list; otherwise the rep sees the answer written, with a hint once per device. It was checked in headless Chromium, which has no voices (so only the no-voice path ran). **Whether iOS Safari offers Arabic (`ar-SA`) and Urdu (`ur-PK`/`ur-IN`) voices, and whether its speech starts from a tap inside a PWA, is NOT verified on a real iPhone.** Check on a device before relying on it; the server-side read-aloud fallback is deferred (R60).
