-- Profiles: one per account (seller name + demo clock)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  clock_offset_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Invoices: every row belongs to one account
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  source text NOT NULL DEFAULT 'practice' CHECK (source IN ('paypal', 'practice')),
  paypal_invoice_id text,
  invoice_number text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  description text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  issue_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'paid', 'cancelled')),
  paypal_status text,
  pay_link text,
  paid_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_user_idx ON public.invoices (user_id, created_at DESC);
CREATE UNIQUE INDEX invoices_paypal_id_idx ON public.invoices (paypal_invoice_id) WHERE paypal_invoice_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own invoices" ON public.invoices FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Create own invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own invoices" ON public.invoices FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete own invoices" ON public.invoices FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Reminders: drafts and sent nudges, per invoice
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tone text NOT NULL CHECK (tone IN ('heads-up', 'friendly', 'polite-clear', 'firm')),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX reminders_user_idx ON public.reminders (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own reminders" ON public.reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Create own reminders" ON public.reminders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.user_id = auth.uid()));
CREATE POLICY "Update own reminders" ON public.reminders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete own reminders" ON public.reminders FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- New account: create profile and four sample invoices so the ledger isn't empty
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  s record;
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  FOR s IN SELECT * FROM (VALUES
    ('PN-0104', 'Sara Haddad', 'sara@example.com', 'Logo design, 3 concepts', 300::numeric, -19, -12, false),
    ('PN-0105', 'Omar Khalil', 'omar@example.com', 'Math tutoring, 4 sessions', 160::numeric, -9, -2, false),
    ('PN-0106', 'Lina Farouk', 'lina@example.com', 'Wedding dress alterations', 240::numeric, -3, 4, false),
    ('PN-0103', 'Yusuf Amin', 'yusuf@example.com', 'Birthday cake, 2 tiers', 95::numeric, -10, -3, true)
  ) AS t(num, name, email, descr, amt, issue_off, due_off, paid)
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.invoices (id, user_id, source, invoice_number, customer_name, customer_email, description, items, amount,
      issue_date, due_date, status, pay_link, paid_at, sample, created_at)
    VALUES (v_id, NEW.id, 'practice', s.num, s.name, s.email, s.descr,
      jsonb_build_array(jsonb_build_object('name', s.descr, 'quantity', 1, 'unit_price', s.amt)), s.amt,
      current_date + s.issue_off, current_date + s.due_off,
      CASE WHEN s.paid THEN 'paid' ELSE 'waiting' END,
      '/pay/' || v_id::text,
      CASE WHEN s.paid THEN (current_date - 2) + time '10:00' ELSE NULL END,
      true, (current_date + s.issue_off) + time '09:00');
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Practice pay page: customers open a link without an account.
-- Only the fields a customer sees, and only practice invoices can be marked paid here.
CREATE OR REPLACE FUNCTION public.get_pay_page(_id uuid)
RETURNS TABLE (id uuid, invoice_number text, customer_name text, description text, amount numeric, due_date date, status text, source text, pay_link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.invoice_number, i.customer_name, i.description, i.amount, i.due_date, i.status, i.source, i.pay_link
  FROM public.invoices i WHERE i.id = _id;
$$;
CREATE OR REPLACE FUNCTION public.pay_practice_invoice(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.invoices SET status = 'paid', paid_at = now()
  WHERE id = _id AND source = 'practice' AND status = 'waiting';
  RETURN FOUND;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_pay_page(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pay_practice_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pay_page(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_practice_invoice(uuid) TO anon, authenticated;