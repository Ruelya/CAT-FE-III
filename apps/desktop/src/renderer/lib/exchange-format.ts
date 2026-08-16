import type { AssetExchangeFormat } from "@translunar/contracts";

export type ExchangeAssetKind = "tm" | "termbase";

/**
 * Infer an exchange format from a path the user already picked.
 *
 * The native dialog already limits extensions; this only maps the chosen
 * suffix onto the Engine enum. Unknown suffixes fall back to the format that
 * kind actually accepts (TMX for memory, TBX for termbases).
 */
export function exchangeFormatFromPath(
  path: string,
  kind: ExchangeAssetKind,
): AssetExchangeFormat {
  const lower = path.toLocaleLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".tbx")) return "tbx";
  if (lower.endsWith(".tmx")) return "tmx";
  return kind === "termbase" ? "tbx" : "tmx";
}
