-- =============================================================================
-- Griffin Colapinto — full athlete data export queries
-- athlete_id: f8152251-3dde-4b3e-aacd-ec1651aad36f
-- Run each section in Supabase SQL Editor, or use:
--   python scripts/export_athlete_to_excel.py "Griffin Colapinto"
-- =============================================================================

-- Lookup by name (if athlete_id unknown)
SELECT athlete_id, first_name, last_name, sport, country, creatoriq_publisher_id
FROM public.athletes
WHERE first_name ILIKE 'Griffin' AND last_name ILIKE 'Colapinto';

-- 1) Profile + primary agent
SELECT a.*,
       p.first_name AS agent_first_name,
       p.last_name  AS agent_last_name,
       p.email      AS agent_email
FROM public.athletes a
LEFT JOIN public.profiles p ON p.user_id = a.current_agent_id
WHERE a.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 2) All assigned agents
SELECT aa.*,
       p.first_name AS agent_first_name,
       p.last_name  AS agent_last_name,
       p.email      AS agent_email,
       p.role       AS agent_role
FROM public.athlete_agents aa
JOIN public.profiles p ON p.user_id = aa.user_id
WHERE aa.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 3) Agent reassignment history
SELECT h.*,
       fa.first_name || ' ' || fa.last_name AS from_agent_name,
       ta.first_name || ' ' || ta.last_name AS to_agent_name,
       cb.first_name || ' ' || cb.last_name AS changed_by_name
FROM public.athlete_agent_history h
LEFT JOIN public.profiles fa ON fa.user_id = h.from_agent_id
LEFT JOIN public.profiles ta ON ta.user_id = h.to_agent_id
LEFT JOIN public.profiles cb ON cb.user_id = h.changed_by_user_id
WHERE h.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 4) Sponsorship contracts + company details
SELECT c.*,
       co.name          AS company_name,
       co.industry,
       co.website,
       co.instagram_url,
       co.support_email AS company_support_email
FROM public.contracts c
JOIN public.companies co ON co.company_id = c.company_id
WHERE c.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f'
ORDER BY c.start_date NULLS LAST, co.name;

-- 5) Contract exclusivity restrictions
SELECT ce.*,
       c.category AS contract_category,
       co.name    AS company_name,
       st.sport, st.tier, st.category AS exclusivity_category
FROM public.contract_exclusivities ce
JOIN public.contracts c ON c.contract_id = ce.contract_id
JOIN public.companies co ON co.company_id = c.company_id
JOIN public.sponsorship_taxonomies st ON st.id = ce.taxonomy_id
WHERE c.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 6) Covered sponsorship categories (Mystery Machine exclusions)
SELECT acc.*,
       st.sport, st.tier, st.category, st.is_group
FROM public.athlete_covered_categories acc
JOIN public.sponsorship_taxonomies st ON st.id = acc.taxonomy_id
WHERE acc.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f'
ORDER BY st.tier, st.category;

-- 7) Social metrics (Instagram, TikTok, Facebook, X)
SELECT * FROM public.athlete_social_data
WHERE athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 8) Audience breakdown (gender, age, geo, interests, brands, etc.)
SELECT audience_category,
       audience_name,
       ig_audience_percent,
       ig_audience_count,
       current_ig_following,
       source_file_name,
       imported_at
FROM public.athlete_audience_data
WHERE athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f'
ORDER BY audience_category, ig_audience_percent DESC NULLS LAST;

-- 9) AI prospecting log (Mystery Machine run)
SELECT * FROM public.prospecting_logs
WHERE athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 10) CRM contacts linked to this athlete
SELECT ca.*,
       c.first_name AS contact_first_name,
       c.last_name  AS contact_last_name,
       c.email      AS contact_email,
       co.name      AS company_name
FROM public.crm_contact_athletes ca
JOIN public.crm_contacts c ON c.contact_id = ca.contact_id
JOIN public.companies co ON co.company_id = c.company_id
WHERE ca.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 11) CRM outreach activity
SELECT ol.*,
       c.first_name || ' ' || c.last_name AS contact_name,
       co.name AS company_name,
       p.first_name || ' ' || p.last_name AS agent_name
FROM public.crm_outreach_logs ol
JOIN public.crm_contacts c ON c.contact_id = ol.contact_id
JOIN public.companies co ON co.company_id = c.company_id
JOIN public.profiles p ON p.user_id = ol.user_id
WHERE ol.athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';

-- 12) Pipeline deals closed for this athlete
SELECT p.*, co.name AS company_name
FROM public.crm_companies_pipeline p
JOIN public.companies co ON co.company_id = p.company_id
WHERE p.closed_athlete_id = 'f8152251-3dde-4b3e-aacd-ec1651aad36f';
