---
title: "From RxJava to Flow without stopping releases"
summary: "A strangler-fig migration plan for legacy Android codebases, and the interop layer that kept both worlds compiling for six months."
date: "2025-11-21"
tags: ["Kotlin", "Coroutines", "Refactoring"]
readTime: "9 min"
---

Nobody gives you a quarter to rewrite reactive infrastructure. When we moved a mature Android codebase from RxJava 2 to Kotlin Flow, we shipped it as a background refactor across six release cycles while product kept landing features.

## Strangler fig, not big bang

The rule was simple: no file may add new Rx code, but existing Rx code is not rewritten unless touched anyway. New code uses Flow from day one; old code migrates opportunistically.

## The interop layer

Two extensions did 90% of the heavy lifting:

```kotlin
fun <T> Observable<T>.asFlow(): Flow<T> =
    callbackFlow {
        val disposable = subscribe(
            { value -> trySend(value) },
            { error -> close(error) },
            { close() }
        )
        awaitClose { disposable.dispose() }
    }
```

And the mirror image for Flow back into Observable at legacy boundaries. Keeping both worlds compiling meant we could migrate a module per sprint instead of freezing the app.

## What actually broke

- `Subjects` have no direct Flow equivalent — hot flows via `SharedFlow` required redesigning a few event buses
- Error handling changed shape: `onErrorReturn` became `catch`, and swallowed exceptions surfaced weeks later
- Threading assumptions: Rx schedulers vs dispatcher injection leaked into tests

Six months later the last Observable import was deleted. No feature freeze, no emergency releases — just a linter rule that got stricter every sprint.
