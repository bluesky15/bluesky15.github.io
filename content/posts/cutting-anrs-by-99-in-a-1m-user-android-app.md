---
title: "Cutting ANRs by 99% in a 1M+ user Android app"
summary: "The exact playbook we used on Decathlon India: strict-mode policing, main-thread audits, and the Dagger scoping mistakes that caused most of our ANRs."
date: "2026-08-02"
tags: ["Android", "Kotlin", "Performance"]
readTime: "8 min"
---

ANRs are the silent killer of Play Store ratings. When we looked at Decathlon India's vitals dashboard, the story was grim — thousands of users a day were hitting "App is not responding" dialogs, and most of them never came back.

## Find it before Google does

The first rule of ANR hunting: don't wait for the Play Console report, which arrives days late and without a stack trace you can act on. We enabled strict-mode policing in debug builds and made violations fail CI:

```kotlin
StrictMode.setThreadPolicy(
    StrictMode.ThreadPolicy.Builder()
        .detectDiskReads()
        .detectDiskWrites()
        .detectNetwork()
        .penaltyLog()
        .build()
)
```

## Main-thread audits

We ran a two-week main-thread audit where every `runBlocking`, synchronous `SharedPreferences` commit, and JSON parse on the main thread was flagged. The usual suspects showed up immediately:

- Synchronous I/O during cold start
- Broadcast receivers doing network work
- Bitmap decoding on the UI thread

## The Dagger scoping mistake

Our biggest single win came from dependency injection. A singleton was lazily initializing an SQLite-backed cache on first access — which happened to be on the main thread during checkout for new installs. Scoping it properly to a background-capable component removed thousands of ANRs per week in one release.

After three months of this playbook, ANRs dropped by 99% while feature velocity stayed flat. Reliability work doesn't have to compete with shipping.
