
CREATE OR REPLACE FUNCTION public.catalog_search_deduped(query_text text)
RETURNS TABLE(
  id uuid,
  distributor text,
  brand text,
  style_number text,
  title text,
  description text,
  image_url text,
  base_price numeric,
  rank real,
  all_distributors jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH raw_results AS (
    -- Full-text search with prefix matching
    SELECT
      cp.id, cp.distributor, cp.brand, cp.style_number, cp.title, cp.description,
      cp.image_url, cp.base_price,
      ts_rank(cp.search_vector,
        to_tsquery('simple',
          array_to_string(
            ARRAY(
              SELECT w || ':*'
              FROM unnest(string_to_array(trim(query_text), ' ')) AS w
              WHERE w <> ''
            ),
            ' & '
          )
        )
      ) AS rank,
      -- Normalize brand: strip non-alphanumeric, uppercase
      upper(regexp_replace(cp.brand, '[^a-zA-Z0-9]', '', 'g')) AS brand_slug,
      -- Strip known prefixes to get canonical base style number
      upper(regexp_replace(cp.style_number, '[^a-zA-Z0-9]', '', 'g')) AS clean_sn
    FROM catalog_products cp
    WHERE
      cp.search_vector IS NOT NULL
      AND cp.search_vector @@ to_tsquery('simple',
        array_to_string(
          ARRAY(
            SELECT w || ':*'
            FROM unnest(string_to_array(trim(query_text), ' ')) AS w
            WHERE w <> ''
          ),
          ' & '
        )
      )
  ),
  -- Compute canonical base by stripping known brand prefixes
  with_canonical AS (
    SELECT *,
      CASE
        -- Bella+Canvas: strip BC prefix
        WHEN brand_slug = 'BELLACANVAS' AND clean_sn ~ '^BC[0-9]' THEN substring(clean_sn FROM 3)
        -- Next Level: strip NL prefix
        WHEN brand_slug IN ('NEXTLEVEL', 'NEXTLEVELAPPAREL') AND clean_sn ~ '^NL[0-9]' THEN substring(clean_sn FROM 3)
        -- Sport-Tek: strip ST or BST prefix
        WHEN brand_slug IN ('SPORTTEK') AND clean_sn ~ '^BST[0-9]' THEN substring(clean_sn FROM 4)
        WHEN brand_slug IN ('SPORTTEK') AND clean_sn ~ '^ST[0-9]' THEN substring(clean_sn FROM 3)
        -- A4: strip A4 prefix
        WHEN brand_slug = 'A4' AND clean_sn ~ '^A4[A-Z0-9]' THEN substring(clean_sn FROM 3)
        -- Gildan: strip G prefix (but not GH which is different)
        WHEN brand_slug = 'GILDAN' AND clean_sn ~ '^GH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'GILDAN' AND clean_sn ~ '^G[0-9]' THEN substring(clean_sn FROM 2)
        -- Port & Company: strip PC prefix
        WHEN brand_slug IN ('PORTCOMPANY', 'PORTANDCOMPANY') AND clean_sn ~ '^PC[0-9]' THEN substring(clean_sn FROM 3)
        -- Comfort Colors: strip CC prefix
        WHEN brand_slug IN ('COMFORTCOLORS') AND clean_sn ~ '^CC[0-9]' THEN substring(clean_sn FROM 3)
        -- District: strip DT prefix
        WHEN brand_slug IN ('DISTRICT', 'DISTRICTMADE') AND clean_sn ~ '^DT[0-9]' THEN substring(clean_sn FROM 3)
        -- Jerzees: strip J prefix
        WHEN brand_slug = 'JERZEES' AND clean_sn ~ '^J[0-9]' THEN substring(clean_sn FROM 2)
        -- Hanes: strip H prefix
        WHEN brand_slug = 'HANES' AND clean_sn ~ '^H[0-9]' THEN substring(clean_sn FROM 2)
        -- New Era: strip NE prefix
        WHEN brand_slug = 'NEWERA' AND clean_sn ~ '^NE[0-9]' THEN substring(clean_sn FROM 3)
        -- Independent Trading: strip IND prefix
        WHEN brand_slug IN ('INDEPENDENTTRADING', 'INDEPENDENTTRADINGCO') AND clean_sn ~ '^IND[0-9]' THEN substring(clean_sn FROM 4)
        -- Alternative: strip AA prefix
        WHEN brand_slug IN ('ALTERNATIVE', 'ALTERNATIVEAPPAREL') AND clean_sn ~ '^AA[0-9]' THEN substring(clean_sn FROM 3)
        -- Also try stripping all known prefixes for cross-brand matching
        WHEN clean_sn ~ '^BC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^NL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BST[0-9]' THEN substring(clean_sn FROM 4)
        WHEN clean_sn ~ '^ST[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^A4[A-Z0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^GH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^PC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DT[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^NE[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^IND[0-9]' THEN substring(clean_sn FROM 4)
        WHEN clean_sn ~ '^AA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^G[0-9]' THEN substring(clean_sn FROM 2)
        WHEN clean_sn ~ '^J[0-9]' THEN substring(clean_sn FROM 2)
        WHEN clean_sn ~ '^H[0-9]' THEN substring(clean_sn FROM 2)
        ELSE clean_sn
      END AS canonical_base
    FROM raw_results
  ),
  -- Group by canonical key (brand_slug + canonical_base) and collect all distributors
  grouped AS (
    SELECT
      brand_slug,
      canonical_base,
      jsonb_agg(jsonb_build_object(
        'distributor', wc.distributor,
        'style_number', wc.style_number
      ) ORDER BY
        CASE wc.distributor WHEN 'sanmar' THEN 1 WHEN 'ss-activewear' THEN 2 ELSE 3 END
      ) AS all_distributors,
      -- Pick the best row: sanmar > ss-activewear > others, then prefer image, then description
      (array_agg(wc.id ORDER BY
        CASE wc.distributor WHEN 'sanmar' THEN 0 WHEN 'ss-activewear' THEN 1 ELSE 2 END,
        CASE WHEN wc.image_url IS NOT NULL AND wc.image_url <> '' THEN 0 ELSE 1 END,
        CASE WHEN wc.description IS NOT NULL AND wc.description <> '' THEN 0 ELSE 1 END
      ))[1] AS best_id,
      max(wc.rank) AS best_rank
    FROM with_canonical wc
    GROUP BY brand_slug, canonical_base
  )
  SELECT
    cp.id, cp.distributor, cp.brand, cp.style_number, cp.title, cp.description,
    cp.image_url, cp.base_price,
    g.best_rank AS rank,
    g.all_distributors
  FROM grouped g
  JOIN catalog_products cp ON cp.id = g.best_id
  ORDER BY g.best_rank DESC
  LIMIT 200;
$function$;
