# Testing the planner

Run from the repository root with Node 24 or newer:

```sh
npm ci
npm test
npm run test:coverage
npm run test:mutation
npm run test:privacy
```

The pure scheduling tests cover service calendars/exceptions, public train identity, ordered stops, boarding restrictions, 24+ hour times, cancellations, delays and explicit unknown status. The host tests run the actual Apps Script source in a Node VM with invented Google/SEPTA fixtures. They cover fresh/repeated initialization, the user menu, trigger repair, configuration bounds, required/optional outages, Google request contracts, road distances, walking, quotas, choices, paired parking, pagination, deletion caps, stable ownership, past-event preservation and recovery. Free-profile tests verify every supported cadence, hourly defaults, opt-in paid routing, five ordinary Maps requests across multiple days, off-day/quiet/commute-window idling, daily rebuilding, actual usage accounting, runtime caps and bounded metrics retention.

Coverage uses V8 against the `.gs` files: the gate requires 99% lines, 90% branches and 95% functions. Coverage alone does not show assertion strength. Stryker injects changes into byte-identical `.js` copies of the `.gs` source and runs the tests with the active mutant propagated into the VM. The mutation gate is 75%. String literals are excluded; user-facing wording and error-code text are not mutation-tested. Surviving mutations remain visible in the JSON/HTML report; passing the gate does not mean every possible defect is covered.

For a private installation, independently verify a completed Google `TIME_DRIVEN` execution and its provider output:

```sh
node tools/verify-live.cjs YOUR_SHEET_ID YOUR_SCRIPT_ID YOUR_GOOGLE_ACCOUNT
```

That read-only tool compares every displayed train's service date, number and public times with the official SEPTA feed; checks owned calendar rows, paired selections and reminders; and verifies actual scheduled execution. It reports aggregate measurements without printing personal configuration. It requires the separately installed `gog` Google CLI and `unzip`, plus authorized Calendar, Sheets and Apps Script reads. Local fixtures never call your account.

The public-export gate uses an explicit file allowlist and rejects personal defaults and credential patterns. CI needs no Google credentials. Physical notification delivery and the train you actually board require device/human observation.
