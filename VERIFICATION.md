# Upgrade verification

Verified against an isolated training database; existing project data was not used for test mutations.

## Automated

19 Node test cases cover preserved legacy data, baseline domain rules, authenticated access/ownership, malicious role selection, CSRF/origin protection, owner-bound queued reports, concurrent retry idempotency, signed HQ receipts, failed-write rollback, assignment conflicts, complete responder progression, safe/decline/resource release, media isolation, opt-in location, broadcasts/provisioning/audit, gateway authentication, old APK pairing/SOS/status/revocation and simulation/fallback semantics. Production Vite build passes.

## Browser acceptance

- Citizen signs in and sends a Flood SOS with a manual landmark and no GPS/media.
- HQ receives the same incident, acknowledges, verifies and assigns Rescue Alpha.
- Assigned responder signs in, sees only the assigned incident, accepts it and marks En route.
- Citizen sees HQ receipt, acknowledgement, assignment, acceptance and En route in the same incident history.
- Hindi primary citizen controls render and remain functional.
- 390-pixel mobile viewport has no horizontal overflow; desktop layout checked at 1440 pixels.
- Browser networking disabled: new SOS stays Pending — not delivered; unconfigured local/RF/satellite routes stay labelled simulation.
- Reload while offline: application shell, cached account, pending SOS and previous signed receipt remain available.
- Cancel while offline: safety update explicitly stays unconfirmed.
- Networking restored: one incident is received, followed by the queued cancellation; the citizen sees HQ received then Cancelled. Browser network emulation restored after testing.

## Limits

Real GPS permission and location hardware, external navigation, OS notifications, actual RF/LoRa/satellite hardware, internet production deployment and a real MongoDB instance were not exercised. Map tiles and external fonts need their respective network providers; the app falls back to a basemap warning/system fonts. The software adapter contract and unconfigured/simulation behavior are tested, not physical transmission. Retry requires an open app. Storage/session deployment is single-process.
