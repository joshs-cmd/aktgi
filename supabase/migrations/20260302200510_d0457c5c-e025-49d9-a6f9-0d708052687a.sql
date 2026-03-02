
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(style_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS catalog_products_search_vector_gin
  ON public.catalog_products USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS catalog_products_style_number_btree
  ON public.catalog_products (style_number);
