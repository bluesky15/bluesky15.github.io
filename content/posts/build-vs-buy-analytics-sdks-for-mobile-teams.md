---
title: "Build vs buy: analytics SDKs for mobile teams"
summary: "Firebase, Adobe, Contentful or roll-your-own? What nine retail apps taught me about total cost of ownership for analytics pipelines."
date: "2025-06-14"
tags: ["Analytics", "Architecture"]
readTime: "6 min"
---

Across nine retail e-commerce apps I've used Firebase Analytics, Adobe Analytics, and a homegrown pipeline — sometimes all three in one company. Here's the total-cost-of-ownership view nobody puts in the vendor deck.

## What you're actually buying

An analytics SDK is not a feature, it's a contract: schema governance, latency budgets, offline buffering, consent enforcement, and someone to call when iOS 19 breaks background flushing. Buying means outsourcing all of that.

## The hidden costs of each path

**Buy (Firebase/Adobe):** cheap until it isn't. Event limits, sampling, and export fees creep up. Your data model bends around the tool's vocabulary.

**Roll-your-own:** the first month is fun. The second year is maintaining retry queues, batching, and a schema registry across 9 apps with different release trains.

## Rules that saved us

1. One canonical event taxonomy owned by a single team, enforced by a codegen'd tracking API
2. SDK-agnostic logging layer — events go to an internal interface, vendors are adapters
3. Debug builds print every event as JSON so QA can verify without dashboards

The right answer is boring: buy infrastructure, own the schema.
