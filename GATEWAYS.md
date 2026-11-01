# Gateway adapter contract

No RF/LoRa or satellite hardware is supplied by this repository. The reference `server/gateway.js` transports HTTP over a local network only. Radio and satellite adapters must implement framing, authentication, retransmission, provider/hardware integration and return-path delivery themselves. Label test adapters simulation; do not manufacture HQ receipts.

## Browser → configured adapter

HTTPS `POST` to the configured `*_GATEWAY_URL`, JSON body:

```json
{
  "transport": "rf",
  "ticket": "<short-lived SOS-only delivery ticket>",
  "report": {
    "clientRequestId": "<stable UUID retained for every retry>",
    "type": "Flood",
    "lat": 30.7046,
    "lng": 76.7179,
    "location": "School, second floor",
    "people": 4,
    "immediateDanger": true
  }
}
```

The browser sends no account password, session cookie, CSRF token or gateway secret to the adapter. The adapter must allow only intended app origins through CORS and meet browser local-network restrictions. Tickets authorize SOS creation only for one account and expire after 24 hours. They do not authorize reading incidents or dispatch actions. Protect them in transit and avoid logging them.

## Receiving gateway → HQ

After transporting the envelope through the actual network/hardware, the receiving gateway calls `POST /api/gateway/ingest` with the same body and `X-Gateway-Key: <configured server secret>`. Use the matching `LOCAL_GATEWAY_KEY`, `RF_GATEWAY_KEY` or `SATELLITE_GATEWAY_KEY`. HQ checks gateway credentials, validates the ticket, deduplicates by owner/request ID, saves the incident and only then returns:

```json
{
  "incidentId": "RG-12345678",
  "receipt": {
    "payload": {
      "requestId": "<original UUID>",
      "incidentId": "RG-12345678",
      "ownerId": "<ticket owner>",
      "receivedAt": "<server ISO timestamp>",
      "transport": "rf",
      "status": "HQ received"
    },
    "encoded": "<base64url UTF-8 JSON payload>",
    "signature": "<base64url ECDSA P-256 / SHA-256, IEEE-P1363 r||s>"
  }
}
```

Relay the receipt unchanged all the way back. The signature covers the ASCII `encoded` field. The browser verifies it with the JWK from authenticated `/api/config` and checks request/owner identity. Until a valid HQ receipt returns, respond non-200 or without a receipt; the browser remains pending and retries later. Local enqueue/airtime/provider acceptance is not HQ receipt. Satellite latency can exceed the client's 8-second attempt timeout; adapters may persist envelopes and return a completed HQ receipt on the next retry for that request ID. Never change the ID on retransmission.

Optional media follows the direct authenticated media API separately. Do not include media in RF packets. SOS reports may need payload compression/fragmentation for actual LoRa or satellite limits; none of those physical-layer claims are made by the web application.

## Hardware acceptance checklist

Verify actual transmission and return receipt through each configured adapter, complete outage/pending behavior, replay/idempotency, packet loss/reordering, expired tickets, provider limits and secure origin reachability. Record equipment/provider configuration and results before presenting the adapter as operational. The automated transport tests verify software behavior only.
