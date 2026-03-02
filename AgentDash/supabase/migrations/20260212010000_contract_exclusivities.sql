-- Contract exclusivities: link contracts to taxonomy nodes (canonical exclusivity restrictions).
-- Each contract can have multiple exclusivity restrictions (multiple taxonomy nodes).
CREATE TABLE IF NOT EXISTS public.contract_exclusivities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(contract_id) ON DELETE CASCADE,
  taxonomy_id uuid NOT NULL REFERENCES public.sponsorship_taxonomies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, taxonomy_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_exclusivities_contract_id ON public.contract_exclusivities(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_exclusivities_taxonomy_id ON public.contract_exclusivities(taxonomy_id);

COMMENT ON TABLE public.contract_exclusivities IS 'Canonical exclusivity restrictions per contract. Multiple taxonomy nodes can be restricted per contract. Used to block recommendations that intersect with active contract exclusivities.';
