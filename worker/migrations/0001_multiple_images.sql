-- Multiple images per entry.
--
-- entries.images holds an ordered JSON array of Workers KV keys. The old
-- image_key column is kept in sync with the first key so pre-migration rows
-- and older cached admin pages keep working.
--
-- Apply once per database, before deploying the multi-image worker:
--   npx wrangler d1 migrations apply lkb-auth --remote --config worker/wrangler.toml

ALTER TABLE entries ADD COLUMN images TEXT NOT NULL DEFAULT '[]';

UPDATE entries
   SET images = json_array(image_key)
 WHERE image_key IS NOT NULL
   AND image_key <> ''
   AND (images IS NULL OR images = '' OR images = '[]');
