
## Two Fixes

### Fix 1 — Routing Collision (Frontend + Catalog Search Edge Function)

**Root cause:** In `deduplicateProducts` (catalog-search edge function), when products from multiple distributors are merged under an `aggressiveKey` (numeric root), `primary = group.items[0]` is whichever product arrived first in the array. If a OneStop alias like `GD210` arrives before Gildan's own `5000`, the deduped card gets `styleNumber: "GD210"` and potentially a different brand. When the user clicks the card, those wrong values are passed to the URL, so the detail page searches for the wrong SKU.

**Fix:**
- In the dedup loop, after collecting all items into a group, select the "best" representative item as `primary`. Priority: prefer items whose `styleNumber` is closest to the numeric fingerprint (i.e., doesn't look like a proprietary alias). Specifically: if any item in the group has a `distributorCode` of `sanmar` or `ss-activewear` (the "real" manufacturers), prefer that item as `primary` over OneStop items.
- Alternatively (simpler and more robust): after building `distributorSkuMap`, set `styleNumber` to the value from the most authoritative distributor in the map. Priority: `sanmar` > `ss-activewear` > `onestop`.

### Fix 2 — SanMar PromoStandards 404 (Backend)

**Root cause:** The constant `PROMOSTANDARDS_PRICING_ENDPOINT` on line 13 of `provider-sanmar/index.ts` is set to the wrong URL path:
```
https://ws.sanmar.com:8080/promostandards/PricingServiceBindingV2_0_0Port
```
It must be changed to:
```
https://ws.sanmar.com:8080/promostandards/PricingAndConfigurationServiceBinding
```

The debug injection (`standardProduct.description = promoDebugXml`) will be kept intact as requested so you can verify the raw XML response.

### Files to change
- `supabase/functions/catalog-search/index.ts` — Fix primary item selection in dedup to use the most authoritative distributor's styleNumber/brand
- `supabase/functions/provider-sanmar/index.ts` — Update `PROMOSTANDARDS_PRICING_ENDPOINT` constant URL
- Redeploy both edge functions
