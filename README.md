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
6. If you want explicit traffic-aware road predictions, use **Set traffic-aware Routes API key** with your existing billing-enabled Google Routes key. Without it, Google Maps supplies route distance and duration; traffic is only labeled when Google supplies it. Set `routes_api_enabled` to false to use built-in Google Maps while preserving an existing restricted key. A failed provider uses the configured fallback and is visibly degraded.
7. After confirming the alternatives, enable `main_writer_enabled`. If another program writes your main commute calendar, retire that writer first. The main calendar then shows the chosen journey with explicit popup reminders.
8. Observe a subsequent **scheduled** success in Status. Subscribe to both calendars on your devices. Google provider success does not prove an iPhone popup was received.

When copying a configured Sheet, clear the original owner's origin, calendar IDs, selections and places. Create your own calendars and run setup under your account; a copied Sheet must not keep writing the original owner's calendars.

## Configure and choose

Settings include attendance title/location rules, required and optional calendars, destination, rolling days, alternatives per station, arrival/parking/departure buffers, fallback walking and driving time, reminders, refresh timing and quiet hours. Optional-calendar failure is visibly degraded; required-calendar failure preserves previous output.

**Train options** compares departures, arrivals, leave-by and finish/home times, driving minutes, road miles, routing provenance, train status and tracks. Copy an **Option ID** to **Selections** with its date and `outbound` or `return` direction. A blank selection uses the recommendation. An invalid selection fails visibly rather than silently choosing a different train.

The options calendar has no popup reminders for every alternative. Chosen main journeys use your configured reminders. Future rail times are scheduled; absence from a live feed never means on time. Train delays are evidence, not a guarantee of arrival. A delayed outbound train does not justify leaving home later.

## Reliability and limits

GTFS is refreshed daily. Today refreshes at the configured cadence; the forward window is rebuilt periodically. Apps Script locks prevent concurrent writers. Calendar reads paginate to exhaustion, managed rows have stable IDs, unchanged rows are skipped, and deletion is capped. Calendar writes use paced batches and bounded retries for throttling and temporary server failures; permission failures stop immediately. Partial output is repaired by a later run. Source calendars and unowned events are never edited.

Google consumer Apps Script executions are limited to six minutes and 90 minutes/day of trigger runtime. Maps directions/geocoding and API billing quotas also apply. Start with the seven-day default, two stations, three alternatives per station and a 15-minute cadence. Watch actual runtime and the daily request counters before increasing those values. Large configurations may need fewer stations/alternatives or a shorter horizon. `max_maps_requests_per_day` and `max_routes_requests_per_day` bound daily requests; reaching a cap produces labeled fallback estimates and degraded status.

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
