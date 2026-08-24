---
title: "Server-driven UI with Jetpack Compose"
summary: "How we let the backend own layout decisions without turning the client into a browser — schema design, versioning, and fallbacks."
date: "2026-05-18"
tags: ["Jetpack Compose", "Architecture"]
readTime: "10 min"
---

Server-driven UI (SDUI) promises the holy grail of mobile development: ship layout changes without waiting for app review. On the Tila platform we adopted SDUI for high-frequency surfaces like campaigns and home feeds, and Compose turned out to be the perfect rendering engine.

## The schema

We modeled every screen as a tree of typed components. Each node carries a `type`, versioned props, and optional children:

```json
{
  "type": "section",
  "v": 2,
  "children": [
    { "type": "banner", "image": "...", "action": "app://product/123" },
    { "type": "carousel", "items": [] }
  ]
}
```

The client maintains a registry mapping `type` to a composable. Unknown types render nothing — but log loudly.

## Versioning and fallbacks

The hard part isn't rendering; it's evolution. Our rules:

1. New fields must be optional forever
2. Renaming a field requires a new type version
3. Every client understands at least N-2 schema versions

When the parser meets an unknown or malformed node, it falls back to a native default section instead of dropping the whole screen.

## What we'd do differently

Crash rate halved and campaign launch time went from weeks to minutes. But if we started again, we would invest earlier in a design-token layer so server payloads reference semantic styles rather than raw colors — theming retroactively was painful.
