---
title: "Room migrations that don't ruin your weekend"
summary: "Schema discipline, exportSchema CI checks, and test harnesses that catch destructive migrations before your users do."
date: "2024-09-30"
tags: ["Android", "SQLite", "Testing"]
readTime: "7 min"
---

Every Android engineer eventually meets the `IllegalStateException: Migration didn't properly handle` crash at 2 AM. Room makes local persistence easy but migrations unforgiving. After a few painful weekends, we built a setup where destructive migrations fail in CI instead.

## Export schemas, always

The foundation is exporting every version of your schema into version control:

```kotlin
@Database(
    entities = [Product::class, Cart::class],
    version = 7,
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase()
```

Set `room.schemaLocation` in the KSP arguments and commit the generated JSON files. Each PR now shows a reviewable diff of the database schema.

## Test migrations like unit tests

Room's `MigrationTestHelper` lets you create a database at version N, run your migration chain, and validate contents:

```kotlin
@Test
fun migrate6To7_preservesCartItems() {
    helper.createDatabase(TEST_DB, 6).apply {
        execSQL("INSERT INTO cart VALUES ('sku-1', 2)")
        close()
    }
    helper.runMigrationsAndValidate(TEST_DB, 7, true, MIGRATION_6_7)
}
```

## Discipline over cleverness

Three rules kept us crash-free through a dozen releases: never edit an exported schema file, never ship a migration without a test that writes real rows first, and prefer additive columns with defaults over table rebuilds. Boring migrations are good migrations.
