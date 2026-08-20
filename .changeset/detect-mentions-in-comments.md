---
"@soofi-xyz/chat-adapter-asana": minor
"@soofi-xyz/chat-adapter-asana-cdk": minor
---

Add opt-in `detectMentionsInComments` so comment stories can set `message.isMention` when `html_text` contains the bot's `data-asana-gid`. Defaults to `false` to preserve existing routing.
