# Asana sample messages

Illustrative webhook payloads used by the adapter, synthesised from the [Asana Events API](https://developers.asana.com/docs/events) and [Webhooks](https://developers.asana.com/docs/webhooks) documentation. GIDs and timestamps are placeholders.

All deliveries from Asana arrive as a `POST` with:

- `Content-Type: application/json`
- `X-Hook-Signature: <hex HMAC-SHA256 of the raw body using the handshake secret>`

The only exception is the handshake itself, which carries `X-Hook-Secret` instead of a signature.

## Handshake

Initial request Asana sends after you `POST /webhooks`. The body is empty (or may be `{}`); the server must echo the same `X-Hook-Secret` header back on a `200` response. The adapter's `AsanaAdapter.handleWebhook` persists the returned secret via the configured `WebhookSecretStore`.

```http
POST /api/webhooks/asana HTTP/1.1
Host: your-domain.com
Content-Type: application/json
Content-Length: 2
X-Hook-Secret: b7e9a1d0f4c2a8c6f0a1d9e3b6c5f4a7b8d9e0f1c2a3b4c5d6e7f8a9b0c1d2e3

{}
```

Expected response:

```http
HTTP/1.1 200 OK
X-Hook-Secret: b7e9a1d0f4c2a8c6f0a1d9e3b6c5f4a7b8d9e0f1c2a3b4c5d6e7f8a9b0c1d2e3
```

## Task assigned to the bot (thread start)

The adapter registers the webhook against the bot's *My Tasks* user-task-list. When a task is added to it, Asana delivers a `task` `added` event. The adapter fetches the task details, emits `chat.onNewMention`, and puts the task description in the first message (`raw.kind === "task_description"`).

```json
{
  "events": [
    {
      "user": {
        "gid": "1201111111111111",
        "resource_type": "user"
      },
      "created_at": "2026-04-21T10:00:00.000Z",
      "action": "added",
      "resource": {
        "gid": "1202222222222222",
        "resource_type": "task",
        "resource_subtype": "default_task"
      },
      "parent": {
        "gid": "1203333333333333",
        "resource_type": "user_task_list"
      },
      "change": null
    }
  ]
}
```

An assignee-change variant delivers the same semantic (task becomes visible to the bot) as a `task` `changed` event on the `assignee` field:

```json
{
  "events": [
    {
      "user": {
        "gid": "1201111111111111",
        "resource_type": "user"
      },
      "created_at": "2026-04-21T10:00:00.000Z",
      "action": "changed",
      "resource": {
        "gid": "1202222222222222",
        "resource_type": "task",
        "resource_subtype": "default_task"
      },
      "parent": null,
      "change": {
        "field": "assignee",
        "action": "changed"
      }
    }
  ]
}
```

## New comment on a subscribed task

Fires `chat.onSubscribedMessage` with `message.raw.kind === "comment"`.

```json
{
  "events": [
    {
      "user": {
        "gid": "1201111111111111",
        "resource_type": "user"
      },
      "created_at": "2026-04-21T10:05:00.000Z",
      "action": "added",
      "resource": {
        "gid": "1204444444444444",
        "resource_type": "story",
        "resource_subtype": "comment_added"
      },
      "parent": {
        "gid": "1202222222222222",
        "resource_type": "task"
      },
      "change": null
    }
  ]
}
```

## Task marked complete

Delivered as a `task` `changed` event with `change.field === "completed"`. The adapter translates this into `chat.onReaction([emoji.check], ...)` on the task-description message, with `event.added === true`.

```json
{
  "events": [
    {
      "user": {
        "gid": "1201111111111111",
        "resource_type": "user"
      },
      "created_at": "2026-04-21T10:10:00.000Z",
      "action": "changed",
      "resource": {
        "gid": "1202222222222222",
        "resource_type": "task",
        "resource_subtype": "default_task"
      },
      "parent": null,
      "change": {
        "field": "completed",
        "action": "changed"
      }
    }
  ]
}
```

Reopening the same task fires the identical event; the adapter reads the resulting task state and dispatches the reaction with `event.added === false`.

## Events the adapter intentionally ignores

Stories that are not comments (system stories such as `assigned`, `marked_complete`, etc.) and task updates on fields other than `assignee` / `completed` are logged at `debug` level and dropped. Example of an ignored system story:

```json
{
  "events": [
    {
      "user": {
        "gid": "1201111111111111",
        "resource_type": "user"
      },
      "created_at": "2026-04-21T10:12:00.000Z",
      "action": "added",
      "resource": {
        "gid": "1204444444444445",
        "resource_type": "story",
        "resource_subtype": "assigned"
      },
      "parent": {
        "gid": "1202222222222222",
        "resource_type": "task"
      },
      "change": null
    }
  ]
}
```

## Self-originated events

Any event whose top-level `user.gid` equals the bot's own GID is silently dropped so the bot cannot be triggered by its own replies, reactions, or attachment uploads. These payloads still arrive with valid signatures and a `200` is returned; they are simply not dispatched to handlers.