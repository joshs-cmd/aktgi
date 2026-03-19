-- Fix catalog_search_deduped: add canonical_brand so that brand variants like
-- NEXTLEVEL / NEXTLEVELAPPAREL, PORTCOMPANY / PORTANDCOMPANY, etc. collapse into
-- the same group instead of producing duplicate search result cards.
-- The GROUP BY now uses (canonical_brand, canonical_base) instead of (brand_slug, canonical_base).
CREATE OR REPLACE FUNCTION public.catalog_search_deduped(query_text text)
 RETURNS TABLE(id uuid, distributor text, brand text, style_number text, title text, description text, image_url text, base_price numeric, rank real, all_distributors jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH raw_results AS (
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
      upper(regexp_replace(cp.brand, '[^a-zA-Z0-9]', '', 'g')) AS brand_slug,
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
  with_canonical AS (
    SELECT *,
      -- canonical_brand: collapse known brand-slug variants to a single slug
      CASE brand_slug
        WHEN 'NEXTLEVELAPPAREL'     THEN 'NEXTLEVEL'
        WHEN 'PORTANDCOMPANY'       THEN 'PORTCOMPANY'
        WHEN 'PORTCO'               THEN 'PORTCOMPANY'
        WHEN 'DISTRICTMADE'         THEN 'DISTRICT'
        WHEN 'ALTERNATIVEAPPAREL'   THEN 'ALTERNATIVE'
        WHEN 'INDEPENDENTTRADINGCO' THEN 'INDEPENDENTTRADING'
        WHEN 'RABBITSKIN'           THEN 'RABBITSKINS'
        WHEN 'AUGUSTASPORTSWEAR'    THEN 'AUGUSTA'
        WHEN 'JAMERICABRANDS'       THEN 'JAMERICA'
        WHEN 'ADAMSHEADWEAR'        THEN 'ADAMS'
        ELSE brand_slug
      END AS canonical_brand,
      CASE
        WHEN brand_slug = 'BELLACANVAS' AND clean_sn ~ '^BC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'BELLACANVAS' AND clean_sn ~ '^BE[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('NEXTLEVEL', 'NEXTLEVELAPPAREL') AND clean_sn ~ '^NL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'SPORTTEK' AND clean_sn ~ '^BST[0-9]' THEN substring(clean_sn FROM 4)
        WHEN brand_slug = 'SPORTTEK' AND clean_sn ~ '^ST[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'A4' AND clean_sn ~ '^A4[A-Z0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'GILDAN' AND clean_sn ~ '^GH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'GILDAN' AND clean_sn ~ '^GL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'GILDAN' AND clean_sn ~ '^G[0-9]' THEN substring(clean_sn FROM 2)
        WHEN brand_slug IN ('PORTCOMPANY', 'PORTANDCOMPANY', 'PORTCO') AND clean_sn ~ '^PC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'COMFORTCOLORS' AND clean_sn ~ '^CC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'COMFORTCOLORS' AND clean_sn ~ '^CO[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('DISTRICT', 'DISTRICTMADE') AND clean_sn ~ '^DT[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'JERZEES' AND clean_sn ~ '^J[0-9]' THEN substring(clean_sn FROM 2)
        WHEN brand_slug = 'HANES' AND clean_sn ~ '^HN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'HANES' AND clean_sn ~ '^H[0-9]' THEN substring(clean_sn FROM 2)
        WHEN brand_slug = 'NEWERA' AND clean_sn ~ '^NE[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('INDEPENDENTTRADING', 'INDEPENDENTTRADINGCO') AND clean_sn ~ '^IND[0-9]' THEN substring(clean_sn FROM 4)
        WHEN brand_slug IN ('ALTERNATIVE', 'ALTERNATIVEAPPAREL') AND clean_sn ~ '^AA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('ALTERNATIVE', 'ALTERNATIVEAPPAREL') AND clean_sn ~ '^AL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'CHAMPION' AND clean_sn ~ '^CP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'CHAMPION' AND clean_sn ~ '^DB[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'BADGER' AND clean_sn ~ '^BA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'BADGER' AND clean_sn ~ '^BG[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('RABBITSKINS', 'RABBITSKIN') AND clean_sn ~ '^RS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('RABBITSKINS', 'RABBITSKIN') AND clean_sn ~ '^LA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('RABBITSKINS', 'RABBITSKIN') AND clean_sn ~ '^DS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'YUPOONG' AND clean_sn ~ '^YP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'YUPOONG' AND clean_sn ~ '^FF[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'CODEV' AND clean_sn ~ '^CV[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'BURNSIDE' AND clean_sn ~ '^BS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'DICKIES' AND clean_sn ~ '^DK[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'ANVIL' AND clean_sn ~ '^AN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'COMFORTWASH' AND clean_sn ~ '^CW[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('AUGUSTASPORTSWEAR', 'AUGUSTA') AND clean_sn ~ '^AG[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('JAMERICA', 'JAMERICABRANDS') AND clean_sn ~ '^JA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'REDKAP' AND clean_sn ~ '^RK[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug IN ('ADAMSHEADWEAR', 'ADAMS') AND clean_sn ~ '^AD[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'VANHEUSEN' AND clean_sn ~ '^VH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'DYENOMITE' AND clean_sn ~ '^DN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'SIERRAPACIFIC' AND clean_sn ~ '^SP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN brand_slug = 'ECONSCIOUS' AND clean_sn ~ '^EC[0-9]' THEN substring(clean_sn FROM 3)
        -- Cross-brand generic stripping (catches ACC-prefixed rows regardless of brand label)
        WHEN clean_sn ~ '^BC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BE[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^NL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BST[0-9]' THEN substring(clean_sn FROM 4)
        WHEN clean_sn ~ '^ST[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^A4[A-Z0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^GH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^GL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^PC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CO[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DT[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^HN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^NE[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^IND[0-9]' THEN substring(clean_sn FROM 4)
        WHEN clean_sn ~ '^AA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^AL[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DB[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^RS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^LA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^YP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^FF[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CV[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BS[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DK[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^AN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^CW[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^AG[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^JA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^RK[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^AD[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^VH[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^DN[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^EC[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^SP[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BA[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^BG[0-9]' THEN substring(clean_sn FROM 3)
        WHEN clean_sn ~ '^G[0-9]' THEN substring(clean_sn FROM 2)
        WHEN clean_sn ~ '^J[0-9]' THEN substring(clean_sn FROM 2)
        WHEN clean_sn ~ '^H[0-9]' THEN substring(clean_sn FROM 2)
        ELSE clean_sn
      END AS canonical_base
    FROM raw_results
  ),
  grouped AS (
    SELECT
      canonical_brand,
      canonical_base,
      jsonb_agg(jsonb_build_object(
        'distributor', wc.distributor,
        'style_number', wc.style_number
      ) ORDER BY
        CASE wc.distributor WHEN 'sanmar' THEN 1 WHEN 'ss-activewear' THEN 2 WHEN 'onestop' THEN 3 ELSE 4 END
      ) AS all_distributors,
      (array_agg(wc.id ORDER BY
        CASE wc.distributor WHEN 'sanmar' THEN 0 WHEN 'ss-activewear' THEN 1 WHEN 'onestop' THEN 2 ELSE 3 END,
        CASE WHEN wc.image_url IS NOT NULL AND wc.image_url <> '' THEN 0 ELSE 1 END,
        CASE WHEN wc.description IS NOT NULL AND wc.description <> '' THEN 0 ELSE 1 END
      ))[1] AS best_id,
      max(wc.rank) AS best_rank
    FROM with_canonical wc
    GROUP BY canonical_brand, canonical_base
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