
CREATE TABLE public.catalog_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor TEXT NOT NULL,
  brand TEXT NOT NULL,
  style_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (distributor, style_number)
);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on catalog_products"
  ON public.catalog_products
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role insert on catalog_products"
  ON public.catalog_products
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role update on catalog_products"
  ON public.catalog_products
  FOR UPDATE
  USING (true);
