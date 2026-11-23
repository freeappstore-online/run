# Run

A free beginner running app on [FreeAppStore](https://freeappstore.online), at https://run.freeappstore.online.

This is the single-user, device-only sibling of the PAS app `proappstore-online/run`. Its recorder engine, training plans and GPX export are vendored from that repo, not shared with it.

- **Plan:** First 5K (9 weeks of run/walk intervals building to 30 minutes non-stop) or Run 10K (8 weeks of easy runs, intervals and a long run), on 3 run days you choose.
- **Guided workouts:** the current step, a countdown, the next step and overall progress. Each step change is announced by speech and vibration where supported. Pausing the run pauses the workout.
- **Recorder:** foreground GPS, distance, active duration, average and current pace, and km/mile splits. It pauses on hide unless the FreeAppStore phone app shares location with Run; then, on return, it adds that app's points for the locked stretch only, through the same accuracy, jump and gap rules. It keeps a draft checkpoint every 5 seconds and restores it after a reload. GPS gaps are never bridged.
- **History:** route map (OpenStreetMap), splits, weekly totals, delete and GPX export.
- **Private:** no account needed and nothing is uploaded. Runs are stored in IndexedDB (`@freeappstore/sdk/persist`); the plan, preferences and draft in localStorage. Export GPX if you want a backup.

Run records only while it is open and visible. Locked-screen coverage needs sign-in and the FreeAppStore phone app; nothing else is uploaded, and a gap with no phone points stays a gap. Distances are recreational GPS estimates.

Dev: `pnpm install && pnpm dev`. Verify: `pnpm typecheck && pnpm test && fas check && pnpm test:browser`.
Deploy: push to `main`.

Free, MIT-licensed, no tracking. Tracked in freeappstore-online/platform#608.
