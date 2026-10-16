// Shared catalog resolution (moved verbatim from catalog-search).

export const BRAND_SLUG_CANONICAL: Record<string, string> = {
  "NEXTLEVELAPPAREL": "NEXTLEVEL",
  "PORTANDCOMPANY": "PORTCOMPANY",
  "PORTCO": "PORTCOMPANY",
  "DISTRICTMADE": "DISTRICT",
  "ALTERNATIVEAPPAREL": "ALTERNATIVE",
  "INDEPENDENTTRADINGCO": "INDEPENDENTTRADING",
  "RABBITSKIN": "RABBITSKINS",
  "AUGUSTASPORTSWEAR": "AUGUSTA",
  "JAMERICABRANDS": "JAMERICA",
  "ADAMSHEADWEAR": "ADAMS",
};

export function canonicalBrandSlug(brand: string): string {
  const slug = brand.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return BRAND_SLUG_CANONICAL[slug] ?? slug;
}

/**
 * Strip known brand prefixes to get canonical base for display.
 * Must mirror the SQL function's logic exactly.
 */
export function getCanonicalBase(styleNumber: string, brand: string): string {
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const slug = brand.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Brand-specific prefix stripping
  if (slug === "BELLACANVAS" && /^BC\d/.test(sn)) return sn.slice(2);
  if ((slug === "NEXTLEVEL" || slug === "NEXTLEVELAPPAREL") && /^NL\d/.test(sn)) return sn.slice(2);
  if (slug === "SPORTTEK" && /^BST\d/.test(sn)) return sn.slice(3);
  if (slug === "SPORTTEK" && /^ST\d/.test(sn)) return sn.slice(2);
  if (slug === "A4" && /^A4[A-Z0-9]/.test(sn)) return sn.slice(2);
  if (slug === "GILDAN" && /^GH\d/.test(sn)) return sn.slice(2);
  if (slug === "GILDAN" && /^G\d/.test(sn)) return sn.slice(1);
  if ((slug === "PORTCOMPANY" || slug === "PORTANDCOMPANY") && /^PC\d/.test(sn)) return sn.slice(2);
  if (slug === "COMFORTCOLORS" && /^CC\d/.test(sn)) return sn.slice(2);
  if ((slug === "DISTRICT" || slug === "DISTRICTMADE") && /^DT\d/.test(sn)) return sn.slice(2);
  if (slug === "JERZEES" && /^J\d/.test(sn)) return sn.slice(1);
  if (slug === "HANES" && /^H\d/.test(sn)) return sn.slice(1);
  if (slug === "NEWERA" && /^NE\d/.test(sn)) return sn.slice(2);
  if ((slug === "INDEPENDENTTRADING" || slug === "INDEPENDENTTRADINGCO") && /^IND\d/.test(sn)) return sn.slice(3);
  if ((slug === "ALTERNATIVE" || slug === "ALTERNATIVEAPPAREL") && /^AA\d/.test(sn)) return sn.slice(2);
  if (slug === "ECONSCIOUS" && /^EC\d/.test(sn)) return sn.slice(2);
  if (slug === "GILDAN" && /^GL\d/.test(sn)) return sn.slice(2);
  if (slug === "COMFORTCOLORS" && /^CO\d/.test(sn)) return sn.slice(2);
  if (slug === "BELLACANVAS" && /^BE\d/.test(sn)) return sn.slice(2);
  if (slug === "HANES" && /^HN\d/.test(sn)) return sn.slice(2);
  if (slug === "CHAMPION" && /^CP\d/.test(sn)) return sn.slice(2);
  if (slug === "CHAMPION" && /^DB\d/.test(sn)) return sn.slice(2);
  if (slug === "BADGER" && /^BA\d/.test(sn)) return sn.slice(2);
  if (slug === "BADGER" && /^BG\d/.test(sn)) return sn.slice(2);
  if ((slug === "RABBITSKINS" || slug === "RABBITSKIN") && /^RS\d/.test(sn)) return sn.slice(2);
  if ((slug === "RABBITSKINS" || slug === "RABBITSKIN") && /^LA\d/.test(sn)) return sn.slice(2);
  if ((slug === "RABBITSKINS" || slug === "RABBITSKIN") && /^DS\d/.test(sn)) return sn.slice(2);
  if (slug === "YUPOONG" && /^YP\d/.test(sn)) return sn.slice(2);
  if (slug === "YUPOONG" && /^FF\d/.test(sn)) return sn.slice(2);
  if (slug === "CODEV" && /^CV\d/.test(sn)) return sn.slice(2);
  if (slug === "BURNSIDE" && /^BS\d/.test(sn)) return sn.slice(2);
  if (slug === "DICKIES" && /^DK\d/.test(sn)) return sn.slice(2);
  if (slug === "ANVIL" && /^AN\d/.test(sn)) return sn.slice(2);
  if (slug === "COMFORTWASH" && /^CW\d/.test(sn)) return sn.slice(2);
  if ((slug === "AUGUSTA" || slug === "AUGUSTASPORTSWEAR") && /^AG\d/.test(sn)) return sn.slice(2);
  if ((slug === "JAMERICA" || slug === "JAMERICABRANDS") && /^JA\d/.test(sn)) return sn.slice(2);
  if (slug === "REDKAP" && /^RK\d/.test(sn)) return sn.slice(2);
  if ((slug === "ADAMS" || slug === "ADAMSHEADWEAR") && /^AD\d/.test(sn)) return sn.slice(2);
  if (slug === "VANHEUSEN" && /^VH\d/.test(sn)) return sn.slice(2);
  if (slug === "DYENOMITE" && /^DN\d/.test(sn)) return sn.slice(2);
  if (slug === "SIERRAPACIFIC" && /^SP\d/.test(sn)) return sn.slice(2);
  if ((slug === "ALTERNATIVE" || slug === "ALTERNATIVEAPPAREL") && /^AL\d/.test(sn)) return sn.slice(2);

  // Broad fallback for unknown brand context
  if (/^BC\d/.test(sn)) return sn.slice(2);
  if (/^NL\d/.test(sn)) return sn.slice(2);
  if (/^BST\d/.test(sn)) return sn.slice(3);
  if (/^ST\d/.test(sn)) return sn.slice(2);
  if (/^A4[A-Z0-9]/.test(sn)) return sn.slice(2);
  if (/^GH\d/.test(sn)) return sn.slice(2);
  if (/^PC\d/.test(sn)) return sn.slice(2);
  if (/^CC\d/.test(sn)) return sn.slice(2);
  if (/^DT\d/.test(sn)) return sn.slice(2);
  if (/^NE\d/.test(sn)) return sn.slice(2);
  if (/^IND\d/.test(sn)) return sn.slice(3);
  if (/^AA\d/.test(sn)) return sn.slice(2);
  if (/^EC\d/.test(sn)) return sn.slice(2);
  if (/^GL\d/.test(sn)) return sn.slice(2);
  if (/^HN\d/.test(sn)) return sn.slice(2);
  if (/^JA\d/.test(sn)) return sn.slice(2);
  if (/^BE\d/.test(sn)) return sn.slice(2);
  if (/^CO\d/.test(sn)) return sn.slice(2);
  if (/^CP\d/.test(sn)) return sn.slice(2);
  if (/^DB\d/.test(sn)) return sn.slice(2);
  if (/^DS\d/.test(sn)) return sn.slice(2);
  if (/^DK\d/.test(sn)) return sn.slice(2);
  if (/^DN\d/.test(sn)) return sn.slice(2);
  if (/^AL\d/.test(sn)) return sn.slice(2);
  if (/^AD\d/.test(sn)) return sn.slice(2);
  if (/^AN\d/.test(sn)) return sn.slice(2);
  if (/^AG\d/.test(sn)) return sn.slice(2);
  if (/^CW\d/.test(sn)) return sn.slice(2);
  if (/^CV\d/.test(sn)) return sn.slice(2);
  if (/^RS\d/.test(sn)) return sn.slice(2);
  if (/^RK\d/.test(sn)) return sn.slice(2);
  if (/^LA\d/.test(sn)) return sn.slice(2);
  if (/^YP\d/.test(sn)) return sn.slice(2);
  if (/^FF\d/.test(sn)) return sn.slice(2);
  if (/^BS\d/.test(sn)) return sn.slice(2);
  if (/^BA\d/.test(sn)) return sn.slice(2);
  if (/^BG\d/.test(sn)) return sn.slice(2);
  if (/^SP\d/.test(sn)) return sn.slice(2);
  if (/^VH\d/.test(sn)) return sn.slice(2);
  if (/^G\d/.test(sn)) return sn.slice(1);
  if (/^J\d/.test(sn)) return sn.slice(1);
  if (/^H\d/.test(sn)) return sn.slice(1);

  return sn;
}

/**
 * Resolve distributor -> style_number map for a brand+style, using the same
 * catalog_search_deduped RPC and grouping as catalog-search.
 */
// deno-lint-ignore no-explicit-any
export async function resolveDistributorSkus(supabase: any, brand: string, style: string): Promise<Record<string, string>> {
  const q = String(style ?? "").trim();
  if (!q) return {};
  const { data, error } = await supabase.rpc("catalog_search_deduped", { query_text: q });
  if (error || !Array.isArray(data)) return {};
  const target = `${canonicalBrandSlug(brand)}::${getCanonicalBase(q, brand)}`;
  const map: Record<string, string> = {};
  let matched = false;
  for (const row of data) {
    const key = `${canonicalBrandSlug(row.brand)}::${getCanonicalBase(row.style_number, row.brand)}`;
    if (key !== target) continue;
    matched = true;
    if (Array.isArray(row.all_distributors)) {
      for (const d of row.all_distributors) {
        if (d?.distributor && d?.style_number && !map[d.distributor]) map[d.distributor] = d.style_number;
      }
    }
    if (!map[row.distributor]) map[row.distributor] = row.style_number;
  }
  return matched ? map : {};
}
