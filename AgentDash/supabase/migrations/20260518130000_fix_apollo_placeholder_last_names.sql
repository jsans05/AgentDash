-- Replace legacy em-dash placeholder last names from early Apollo import
UPDATE public.crm_contacts
SET last_name = '.'
WHERE last_name = '—' AND apollo_reveal_status IS NOT NULL;
