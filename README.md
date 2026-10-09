# SEPTA Commute Planner

A Google-hosted planner for SEPTA Regional Rail commuters who drive to a station and walk to a calendar commitment. Compare multiple trains in Google Sheets and a separate train-options calendar; see the chosen outward/return journey in your main commute calendar.

**Beta 0.1:** configuration, initialization, planning and recovery have automated tests, coverage and mutation gates. Each installation must verify its own scheduled Google execution and calendar output.

## What it does

- Reads your attendance calendars, excluding deadlines and informational events.
- Enumerates date-specific trains from SEPTA's official GTFS, including service exceptions.
- Uses Google to resolve addresses, calculate road distance, driving time and campus walks.
- Shows actual train numbers, departure/arrival times, leave-by times, multiple station choices and explicit unknown live status.
- Matches SEPTA Arrivals and TrainView to today's trains for current delay/track evidence.
- Keeps your return at the station where you parked. Select a different paired journey in the Sheet when needed.
- Runs on a Google Apps Script schedule without a laptop, Raspberry Pi or phone location feed.
- Records actual last success, feed coverage, degraded inputs and failed stages in the Status tab.

## Set up your own planner

1. Create a private Google Sheet. Open **Extensions → Apps Script**.
2. Add `Core.gs`, `Planner.gs` and `Setup.gs` from this folder. Enable the manifest view in project settings and replace `appsscript.json` with the supplied file. Use the V8 runtime and New York timezone.
3. Run **setupCommute** in the script editor and authorize your Google account. The first run creates the settings tabs and calendars; it asks you to fill the required settings if they are blank.
4. In **Settings**, enter your origin address and required source calendar IDs. In **Stations**, enable your departure stations. The defaults demonstrate Doylestown and Lansdale; change them for your commute. Use **Commute planner → Load SEPTA station directory** to find stop IDs. Set `target_stop_id` and your destination.
5. Run **Set up / repair automation** again. It installs one trigger at your configured cadence and fills the train-options calendar and Sheet. Check **Status** for actual successful execution.
6. The default profile uses the included Google Maps service for road distances and ordinary travel estimates; no API key or paid Cloud project is required. If you choose traffic-aware forecasts, add your own billing-enabled Routes key, enable `routes_api_enabled` and set a positive `max_routes_requests_per_day`. A failed provider uses the configured fallback and is visibly degraded.
7. After confirming the alternatives, enable `main_writer_enabled`. If another program writes your main commute calendar, retire that writer first. The main calendar then shows the chosen journey with explicit popup reminders.
8. Observe a subsequent **scheduled** success in Status. Subscribe to both calendars on your devices. Google provider success does not prove an iPhone popup was received.

When copying a configured Sheet, clear the original owner's origin, calendar IDs, selections and places. Create your own calendars and run setup under your account; a copied Sheet must not keep writing the original owner's calendars.

## Configure and choose

Settings include attendance title/location rules, required and optional calendars, destination, rolling days, alternatives per station, arrival/parking/departure buffers, fallback walking and driving time, reminders, refresh timing and quiet hours. Optional-calendar failure is visibly degraded; required-calendar failure preserves previous output.

**Train options** compares departures, arrivals, leave-by and finish/home times, driving minutes, road miles, routing provenance, train status and tracks. Copy an **Option ID** to **Selections** with its date and `outbound` or `return` direction. A blank selection uses the recommendation. An invalid selection fails visibly rather than silently choosing a different train.

The options calendar has no popup reminders for every alternative. Chosen main journeys use your configured reminders. Future rail times are scheduled; absence from a live feed never means on time. Train delays are evidence, not a guarantee of arrival. A delayed outbound train does not justify leaving home later.

## Reliability and limits

The free profile installs one hourly trigger (24 short checks/day, versus 96 at 15 minutes). The seven-day window rebuilds once daily during waking hours. Other ticks skip expensive work at night, on days without commitments and outside a four-hour window before/after commitments. During an active commute window, today's choices and live rail observations update hourly. **Refresh now** and changed configuration can rebuild immediately. Hourly observations are snapshots: check current SEPTA service before departure. Changing `refresh_minutes` requires running setup to replace the trigger.

GTFS is cached and refreshed daily. Ordinary road estimates and campus walks are shared within each execution, across trains and future days; traffic forecasts retain their departure-specific requests when opted in. No Google routing responses are retained as a cross-run cache. Apps Script locks prevent concurrent writers. Calendar reads paginate to exhaustion, managed rows have stable logical ownership keys, unchanged rows are skipped, and deletion is capped. Calendar writes use paced batches and bounded retries for throttling and temporary server failures; permission failures stop immediately. Deleted Calendar IDs are recreated with a fresh ID and retained by their logical key; a retried successful insert is recognized without duplicating it. Partial output is repaired by a later run. Source calendars and unowned events are never edited.

Google currently allows consumer accounts six minutes/execution, 90 minutes/day of trigger runtime, and 1,000 directions queries/day. These quotas are shared by the account's scripts and can change. The default planner stops expensive scheduled work after 20 minutes of measured runtime/day and caps directions at 100/day, leaving headroom. A single in-flight run can finish beyond the runtime cap; this is an application budget, not a reservation of Google's quota. **Status** shows measured runtime and Maps/Routes request counts for the run and day. With two stations and one campus location, an ordinary run uses five Maps queries regardless of how many alternatives or dates it compares (four road directions and one shared walk); different campus locations can add queries. Large configurations may need fewer stations/alternatives or a shorter horizon. Reaching a request cap produces labeled fallback estimates; reaching the scheduled runtime budget retains previous output and records why work paused. Manual refresh remains available. [Google's current quotas](https://developers.google.com/apps-script/guides/services/quotas).

This beta supports SEPTA Regional Rail only, with one configured origin and target station. It does not promise platform accuracy, infer the train you boarded, or support rail transfers. Always confirm departure boards and service notices before travelling.

## Privacy

Keep your planner private. Personal origin and calendar IDs belong in your Sheet, never in repository source. Routes keys are stored in Script Properties, not cells or logs. The runtime logs stage/error codes without addresses, coordinates, source event titles or provider response bodies. Static SEPTA corridor data is retained; ordinary Google road estimates may be reused within one execution, and traffic forecasts retain their departure-specific requests. Google routing responses are not cached for future runs.

The scopes allow the script to read/update Sheets and Calendar, make provider requests, and install its own trigger. The implementation writes only its owned events to configured output calendars. Review the source and authorize your own copy.

## Development

No third-party dependencies are needed for the Google-hosted runtime. Node is only needed for local checks and optional upload.

```sh
npm ci
npm run test:coverage
npm run test:mutation
npm run test:privacy
node tools/upload.cjs YOUR_SCRIPT_ID YOUR_GOOGLE_ACCOUNT
```

See [TESTING.md](TESTING.md) for initialization, integration, usage, coverage, mutation and live provider checks. Public releases use `tools/publish-github.cjs` with an explicit source allowlist and fresh public history; never push a private deployment repository to a public remote.

Sources: [SEPTA APIs](https://api.septa.org/), [Google triggers](https://developers.google.com/apps-script/guides/triggers/installable), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Google Routes](https://developers.google.com/maps/documentation/routes/compute-route-over).

This is an independent project, unaffiliated with SEPTA or Google.
