---
title: "Kotlin Multiplatform vs Flutter: a pragmatic take"
summary: "After shipping with both, here is the decision matrix I actually use when a team asks which cross-platform stack to pick."
date: "2026-02-09"
tags: ["Flutter", "Kotlin", "Cross-platform"]
readTime: "7 min"
---

Every few months someone asks me which cross-platform stack to choose. After shipping production features in both Flutter and Kotlin Multiplatform (KMP), my honest answer is: the question is usually framed wrong. It's not "which is better" — it's "which trade-offs fit your team".

## Where Flutter wins

- **One UI everywhere.** Pixel-perfect brand consistency across iOS and Android, with Skia/Impeller rendering every frame.
- **Velocity for small teams.** Hot reload plus one language plus one widget catalog means two engineers can genuinely ship an entire product.
- **Tooling maturity.** DevTools, golden tests, and CI recipes are all first-party.

## Where KMP wins

- **Native UX by default.** You share business logic and keep SwiftUI/Compose for the parts users touch — no platform feel to fake.
- **Incremental adoption.** You can share a networking layer in an existing app without rewriting anything.
- **Kotlin leverage.** If your team already lives in Kotlin (and on Android), there is no new language tax.

## The decision matrix I use

| Question | Points to |
|---|---|
| Small team, greenfield, brand-heavy UI | Flutter |
| Large existing native codebase | KMP |
| Heavy platform APIs (BT, camera pipelines) | KMP or full native |
| Design team wants pixel-identical screens | Flutter |

Neither is a mistake. Choosing deliberately based on team shape matters more than the stack itself.
