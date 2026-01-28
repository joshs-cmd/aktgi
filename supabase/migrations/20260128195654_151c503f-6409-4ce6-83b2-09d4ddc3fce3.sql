-- Distributors table: vendor registry with toggle
CREATE TABLE public.distributors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  api_base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Warehouses: location lookup per distributor
CREATE TABLE public.warehouses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(distributor_id, code)
);

-- Products: unified catalog
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  style_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Product sizes: available sizes per product
CREATE TABLE public.product_sizes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size_code TEXT NOT NULL,
  size_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(product_id, size_code)
);

-- Inventory: stock by distributor + product + size + warehouse
CREATE TABLE public.inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size_code TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(distributor_id, product_id, size_code, warehouse_id)
);

-- Prices: per-size pricing
CREATE TABLE public.prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size_code TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(distributor_id, product_id, size_code)
);

-- Price history: historical tracking
CREATE TABLE public.price_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size_code TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Sync logs: sync timestamps
CREATE TABLE public.sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on all tables (public read for this sourcing tool)
ALTER TABLE public.distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Public read policies (this is an internal sourcing tool, data is not user-specific)
CREATE POLICY "Allow public read on distributors" ON public.distributors FOR SELECT USING (true);
CREATE POLICY "Allow public read on warehouses" ON public.warehouses FOR SELECT USING (true);
CREATE POLICY "Allow public read on products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow public read on product_sizes" ON public.product_sizes FOR SELECT USING (true);
CREATE POLICY "Allow public read on inventory" ON public.inventory FOR SELECT USING (true);
CREATE POLICY "Allow public read on prices" ON public.prices FOR SELECT USING (true);
CREATE POLICY "Allow public read on price_history" ON public.price_history FOR SELECT USING (true);
CREATE POLICY "Allow public read on sync_logs" ON public.sync_logs FOR SELECT USING (true);

-- Service role policies for edge functions to write
CREATE POLICY "Allow service role insert on distributors" ON public.distributors FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on distributors" ON public.distributors FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on warehouses" ON public.warehouses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on warehouses" ON public.warehouses FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on products" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on products" ON public.products FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on product_sizes" ON public.product_sizes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on product_sizes" ON public.product_sizes FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on inventory" ON public.inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on inventory" ON public.inventory FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on prices" ON public.prices FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on prices" ON public.prices FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on price_history" ON public.price_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role insert on sync_logs" ON public.sync_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on sync_logs" ON public.sync_logs FOR UPDATE USING (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_prices_updated_at BEFORE UPDATE ON public.prices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed distributors
INSERT INTO public.distributors (name, code, api_base_url, is_active) VALUES
  ('S&S Activewear', 'ss-activewear', 'https://api.ssactivewear.com', true),
  ('SanMar', 'sanmar', 'https://ws.sanmar.com', false),
  ('AS Colour', 'as-colour', 'https://api.ascolour.com', false),
  ('Alphabroder', 'alphabroder', 'https://api.alphabroder.com', false),
  ('Independent Trading Co.', 'independent', 'https://api.independenttradingco.com', false);

-- Seed S&S warehouses
INSERT INTO public.warehouses (distributor_id, code, name, city, state)
SELECT d.id, w.code, w.name, w.city, w.state
FROM public.distributors d
CROSS JOIN (VALUES
  ('TX', 'Texas', 'Dallas', 'TX'),
  ('NV', 'Nevada', 'Reno', 'NV'),
  ('OH', 'Ohio', 'Columbus', 'OH'),
  ('KS', 'Kansas', 'Olathe', 'KS'),
  ('PA', 'Pennsylvania', 'Harrisburg', 'PA'),
  ('GA', 'Georgia', 'Atlanta', 'GA')
) AS w(code, name, city, state)
WHERE d.code = 'ss-activewear';