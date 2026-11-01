# Outbound webhook rules

Settings → Notifications → **Outbound webhook rules** (Owners and Admins only).

Each rule is: **when** a trigger fires (optionally only if a field contains some text) **POST** JSON to a URL, at most once per cooldown.

## Triggers

| Trigger | Fires on |
| --- | --- |
| Download stuck | Threshold alert `stuck_download` |
| Download failed / completed | Download queue sync events |
| Cleanuparr needs attention | Cleanuparr notification that needs intervention |
| Low disk space | Threshold alert `low_disk` |
| Any threshold alert | Every threshold alert, including custom alert rules |
| Playback started / stopped | Activity monitor |
| New media added | Recently added sync |
| Integration health warning | Integration health check |
| Task failed | A JellyGlance task fails |

## Built-in formats

- **Home Assistant** – POST to `https://<ha>/api/webhook/<webhook_id>`. Body: `{ trigger, event, title, message, severity, alertType, user, item, series, device, at, source }`. Use `trigger.json.title` etc. in an automation.
- **ntfy** – use your topic URL, e.g. `https://ntfy.sh/my-topic`. JellyGlance uses ntfy JSON publishing (POST to the server root with `topic`, `title`, `message`, `priority`, `tags`). Add an `Authorization: Bearer tk_…` header for protected topics.
- **Discord** – paste the channel webhook URL; an embed with title, message and severity colour is sent.
- **Generic JSON** – the Home Assistant body plus the raw event under `data`.

## Custom body templates

Leave the body blank to use the format above, or write any JSON with placeholders:

```json
{ "text": "{{title}}: {{message}}", "severity": "{{severity}}", "client": "{{data.client}}" }
```

Placeholders: `{{title}} {{message}} {{severity}} {{trigger}} {{event}} {{alertType}} {{user}} {{item}} {{series}} {{device}} {{at}}` and `{{data.<field>}}`. Values are JSON-escaped. Header values accept the same placeholders.

## Security

Destination URLs and header values are encrypted at rest and never returned to the browser (only the host is shown). Loopback, link-local and metadata addresses are refused; LAN addresses are allowed. Redirects are not followed.

## Delivery log

The last 50 deliveries (including **Send test**) are kept with status code, time taken or error. URLs are never logged.
