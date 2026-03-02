
CREATE OR REPLACE FUNCTION public.catalog_search_fts(query_text text)
RETURNS TABLE(
  id uuid,
  distributor text,
  brand text,
  style_number text,
  title text,
  description text,
  image_url text,
  base_price numeric,
  rank float4
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, distributor, brand, style_number, title, description, image_url, base_price,
    ts_rank(search_vector,
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
    ) AS rank
  FROM catalog_products
  WHERE
    search_vector IS NOT NULL
    AND search_vector @@ to_tsquery('simple',
      array_to_string(
        ARRAY(
          SELECT w || ':*'
          FROM unnest(string_to_array(trim(query_text), ' ')) AS w
          WHERE w <> ''
        ),
        ' & '
      )
    )
  ORDER BY rank DESC
  LIMIT 300;
$$;
