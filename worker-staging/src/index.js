/**
 * Staging glue — reuses the live login worker logic verbatim (single source of truth).
 * The catch-all in ../worker/src/index.js serves static assets through env.ASSETS,
 * which this deployment provides via [assets] in wrangler.toml.
 */
export { default } from "../../worker/src/index.js";
