
-- Drop and recreate search_vector with canonical base included for prefix-stripped matching
-- This ensures "3001" matches both "3001" and "BC3001" in FTS

ALTER TABLE public.catalog_products DROP COLUMN search_vector;

ALTER TABLE public.catalog_products
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(style_number, '')), 'A') ||
    setweight(to_tsvector('simple',
      regexp_replace(
        upper(regexp_replace(coalesce(style_number, ''), '[^a-zA-Z0-9]', '', 'g')),
        '^(BST|IND|GH|BC|NL|ST|PC|CC|DT|NE|AA|EC|A4|G|J|H)(?=[0-9])',
        '',
        ''
      )
    ), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS catalog_products_search_vector_gin
  ON public.catalog_products USING GIN (search_vector);
