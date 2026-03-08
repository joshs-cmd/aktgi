

## Analysis: "View on [Distributor]" Link in Warehouse Tooltip

### What you're asking

You want to add a hyperlink like "View on SanMar" inside the warehouse inventory tooltip that takes the user directly to that product's page on the distributor's website.

### Do we have the data?

**Short answer: Partially.** The current `StandardProduct` and `DistributorResult` types do not carry a product URL field. However, we can construct URLs for most distributors because their product page patterns are predictable:

| Distributor | URL Pattern | Feasibility |
|---|---|---|
| **SanMar** | `https://www.sanmar.com/p/{styleNumber}` | High — style number is always available |
| **S&S Activewear** | `https://www.ssactivewear.com/p/{styleID}` (numeric ID) | Medium — we have `styleNumber` but the web URL uses their numeric `styleID`, which we fetch during Stage 2 but don't currently pass through |
| **OneStop** | `https://www.onestopinc.com/product/{webSKU}` | Medium — the resolved "web SKU" (e.g., `GD210`) is used internally but not surfaced to the frontend |
| **ACC** | No public product page pattern identified | Low — ACC doesn't appear to have standard public product URLs |

### What would need to change

1. **Add a `productUrl` field** to `StandardProduct` (or `DistributorResult`) — each provider function would construct and return the direct URL.
2. **Update each provider edge function** (4 functions) to populate that URL using the resolved style/SKU.
3. **Update `WarehouseTooltip`** to accept and render the link.

### Recommendation

This is very doable for SanMar (straightforward URL pattern). For S&S and OneStop, it requires passing the resolved ID through to the frontend — a small change in each provider. ACC may need to be omitted or link to a search page instead.

Shall I proceed with implementing this?

