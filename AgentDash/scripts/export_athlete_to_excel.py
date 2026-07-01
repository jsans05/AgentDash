#!/usr/bin/env python3
"""
Export all Supabase data for an athlete to a multi-sheet Excel workbook.

Usage:
  python scripts/export_athlete_to_excel.py "Griffin Colapinto"
  python scripts/export_athlete_to_excel.py --athlete-id f8152251-3dde-4b3e-aacd-ec1651aad36f

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
(or SUPABASE_DB_URL for direct Postgres — preferred for complex joins).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


def get_db_url() -> str | None:
    return os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")


def get_rest_config() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE"
    )
    if not url or not key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
            file=sys.stderr,
        )
        sys.exit(1)
    return url, key


def fetch_rest(path: str) -> list[dict[str, Any]]:
    import urllib.request

    base, key = get_rest_config()
    req = urllib.request.Request(
        f"{base}/rest/v1/{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def query_postgres(sql: str) -> list[dict[str, Any]]:
    import psycopg2
    import psycopg2.extras

    db_url = get_db_url()
    if not db_url:
        raise RuntimeError("SUPABASE_DB_URL not set")
    with psycopg2.connect(db_url) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall()
            return [dict(r) for r in rows]


def run_query(sql: str) -> list[dict[str, Any]]:
    if get_db_url():
        return query_postgres(sql)
    raise RuntimeError("Direct SQL requires SUPABASE_DB_URL")


def resolve_athlete_id(first_name: str, last_name: str) -> str:
    rows = fetch_rest(
        "athletes"
        f"?first_name=ilike.{quote(first_name)}"
        f"&last_name=ilike.{quote(last_name)}"
        "&select=athlete_id,first_name,last_name"
        "&limit=5"
    )
    if not rows:
        print(f"No athlete found for {first_name} {last_name}", file=sys.stderr)
        sys.exit(1)
    if len(rows) > 1:
        print("Multiple matches:", file=sys.stderr)
        for r in rows:
            print(f"  {r['athlete_id']} — {r['first_name']} {r['last_name']}", file=sys.stderr)
        sys.exit(1)
    return rows[0]["athlete_id"]


def flatten_value(value: Any) -> Any:
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return value


def to_dataframe(rows: list[dict[str, Any]]):
    import pandas as pd

    if not rows:
        return pd.DataFrame()
    flat = [{k: flatten_value(v) for k, v in row.items()} for row in rows]
    return pd.DataFrame(flat)


def build_queries(athlete_id: str) -> dict[str, str]:
    aid = athlete_id
    return {
        "profile": f"""
            SELECT a.*,
                   p.first_name AS agent_first_name,
                   p.last_name AS agent_last_name,
                   p.email AS agent_email
            FROM public.athletes a
            LEFT JOIN public.profiles p ON p.user_id = a.current_agent_id
            WHERE a.athlete_id = '{aid}'
        """,
        "agents": f"""
            SELECT aa.*,
                   p.first_name AS agent_first_name,
                   p.last_name AS agent_last_name,
                   p.email AS agent_email,
                   p.role AS agent_role
            FROM public.athlete_agents aa
            JOIN public.profiles p ON p.user_id = aa.user_id
            WHERE aa.athlete_id = '{aid}'
        """,
        "agent_history": f"""
            SELECT h.*,
                   fa.first_name || ' ' || fa.last_name AS from_agent_name,
                   ta.first_name || ' ' || ta.last_name AS to_agent_name,
                   cb.first_name || ' ' || cb.last_name AS changed_by_name
            FROM public.athlete_agent_history h
            LEFT JOIN public.profiles fa ON fa.user_id = h.from_agent_id
            LEFT JOIN public.profiles ta ON ta.user_id = h.to_agent_id
            LEFT JOIN public.profiles cb ON cb.user_id = h.changed_by_user_id
            WHERE h.athlete_id = '{aid}'
        """,
        "contracts": f"""
            SELECT c.*,
                   co.name AS company_name,
                   co.industry,
                   co.website,
                   co.instagram_url,
                   co.support_email AS company_support_email
            FROM public.contracts c
            JOIN public.companies co ON co.company_id = c.company_id
            WHERE c.athlete_id = '{aid}'
            ORDER BY c.start_date NULLS LAST, co.name
        """,
        "contract_exclusivities": f"""
            SELECT ce.*,
                   c.category AS contract_category,
                   co.name AS company_name,
                   st.sport, st.tier, st.category AS exclusivity_category
            FROM public.contract_exclusivities ce
            JOIN public.contracts c ON c.contract_id = ce.contract_id
            JOIN public.companies co ON co.company_id = c.company_id
            JOIN public.sponsorship_taxonomies st ON st.id = ce.taxonomy_id
            WHERE c.athlete_id = '{aid}'
        """,
        "covered_categories": f"""
            SELECT acc.*,
                   st.sport, st.tier, st.category, st.is_group
            FROM public.athlete_covered_categories acc
            JOIN public.sponsorship_taxonomies st ON st.id = acc.taxonomy_id
            WHERE acc.athlete_id = '{aid}'
            ORDER BY st.tier, st.category
        """,
        "social_data": f"""
            SELECT * FROM public.athlete_social_data WHERE athlete_id = '{aid}'
        """,
        "audience_data": f"""
            SELECT audience_category, audience_name,
                   ig_audience_percent, ig_audience_count,
                   current_ig_following, source_file_name, imported_at
            FROM public.athlete_audience_data
            WHERE athlete_id = '{aid}'
            ORDER BY audience_category, ig_audience_percent DESC NULLS LAST
        """,
        "prospecting_logs": f"""
            SELECT * FROM public.prospecting_logs WHERE athlete_id = '{aid}'
        """,
        "crm_contact_athletes": f"""
            SELECT ca.*,
                   c.first_name AS contact_first_name,
                   c.last_name AS contact_last_name,
                   c.email AS contact_email,
                   co.name AS company_name
            FROM public.crm_contact_athletes ca
            JOIN public.crm_contacts c ON c.contact_id = ca.contact_id
            JOIN public.companies co ON co.company_id = c.company_id
            WHERE ca.athlete_id = '{aid}'
        """,
        "crm_outreach_logs": f"""
            SELECT ol.*,
                   c.first_name || ' ' || c.last_name AS contact_name,
                   co.name AS company_name,
                   p.first_name || ' ' || p.last_name AS agent_name
            FROM public.crm_outreach_logs ol
            JOIN public.crm_contacts c ON c.contact_id = ol.contact_id
            JOIN public.companies co ON co.company_id = c.company_id
            JOIN public.profiles p ON p.user_id = ol.user_id
            WHERE ol.athlete_id = '{aid}'
        """,
        "pipeline_closed": f"""
            SELECT p.*, co.name AS company_name
            FROM public.crm_companies_pipeline p
            JOIN public.companies co ON co.company_id = p.company_id
            WHERE p.closed_athlete_id = '{aid}'
        """,
    }


def fetch_via_rest(athlete_id: str) -> dict[str, list[dict[str, Any]]]:
    """Fallback when SUPABASE_DB_URL is unavailable."""
    sheets: dict[str, list[dict[str, Any]]] = {}

    profile = fetch_rest(f"athletes?athlete_id=eq.{athlete_id}&select=*")
    sheets["profile"] = profile

    agents = fetch_rest(
        f"athlete_agents?athlete_id=eq.{athlete_id}&select=*,profiles(first_name,last_name,email,role)"
    )
    flat_agents = []
    for row in agents:
        prof = row.pop("profiles", None) or {}
        flat_agents.append(
            {
                **row,
                "agent_first_name": prof.get("first_name"),
                "agent_last_name": prof.get("last_name"),
                "agent_email": prof.get("email"),
                "agent_role": prof.get("role"),
            }
        )
    sheets["agents"] = flat_agents

    contracts = fetch_rest(f"contracts?athlete_id=eq.{athlete_id}&select=*")
    company_ids = sorted({c["company_id"] for c in contracts if c.get("company_id")})
    companies_by_id: dict[str, dict] = {}
    if company_ids:
        in_list = ",".join(company_ids)
        for co in fetch_rest(f"companies?company_id=in.({in_list})&select=*"):
            companies_by_id[co["company_id"]] = co
    sheets["contracts"] = [
        {
            **c,
            "company_name": companies_by_id.get(c.get("company_id"), {}).get("name"),
            "industry": companies_by_id.get(c.get("company_id"), {}).get("industry"),
            "website": companies_by_id.get(c.get("company_id"), {}).get("website"),
        }
        for c in contracts
    ]

    covered = fetch_rest(
        f"athlete_covered_categories?athlete_id=eq.{athlete_id}&select=*,sponsorship_taxonomies(sport,tier,category,is_group)"
    )
    sheets["covered_categories"] = [
        {
            **{k: v for k, v in row.items() if k != "sponsorship_taxonomies"},
            **(row.get("sponsorship_taxonomies") or {}),
        }
        for row in covered
    ]

    sheets["social_data"] = fetch_rest(
        f"athlete_social_data?athlete_id=eq.{athlete_id}&select=*"
    )
    sheets["audience_data"] = fetch_rest(
        f"athlete_audience_data?athlete_id=eq.{athlete_id}"
        "&select=audience_category,audience_name,ig_audience_percent,ig_audience_count,current_ig_following,source_file_name,imported_at"
        "&order=audience_category.asc,ig_audience_percent.desc"
    )
    sheets["prospecting_logs"] = fetch_rest(
        f"prospecting_logs?athlete_id=eq.{athlete_id}&select=*"
    )
    sheets["agent_history"] = fetch_rest(
        f"athlete_agent_history?athlete_id=eq.{athlete_id}&select=*"
    )
    sheets["crm_contact_athletes"] = fetch_rest(
        f"crm_contact_athletes?athlete_id=eq.{athlete_id}&select=*"
    )
    sheets["crm_outreach_logs"] = fetch_rest(
        f"crm_outreach_logs?athlete_id=eq.{athlete_id}&select=*"
    )
    sheets["pipeline_closed"] = fetch_rest(
        f"crm_companies_pipeline?closed_athlete_id=eq.{athlete_id}&select=*"
    )

    contract_ids = [c["contract_id"] for c in contracts if c.get("contract_id")]
    exclusivities: list[dict[str, Any]] = []
    if contract_ids:
        in_list = ",".join(contract_ids)
        exclusivities = fetch_rest(
            f"contract_exclusivities?contract_id=in.({in_list})&select=*"
        )
    sheets["contract_exclusivities"] = exclusivities

    return sheets


def export_workbook(athlete_id: str, athlete_label: str, output_path: Path) -> None:
    import pandas as pd

    if get_db_url():
        queries = build_queries(athlete_id)
        sheets = {name: run_query(sql) for name, sql in queries.items()}
    else:
        sheets = fetch_via_rest(athlete_id)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        summary_rows = [
            {"field": "athlete_id", "value": athlete_id},
            {"field": "exported_at_utc", "value": datetime.now(timezone.utc).isoformat()},
        ]
        if sheets.get("profile"):
            for k, v in sheets["profile"][0].items():
                summary_rows.append({"field": k, "value": flatten_value(v)})
        to_dataframe(summary_rows).to_excel(writer, sheet_name="summary", index=False)

        sheet_order = [
            ("profile", "profile"),
            ("agents", "agents"),
            ("agent_history", "agent_history"),
            ("contracts", "contracts"),
            ("contract_exclusivities", "exclusivities"),
            ("covered_categories", "covered_categories"),
            ("social_data", "social_data"),
            ("audience_data", "audience_data"),
            ("prospecting_logs", "prospecting_logs"),
            ("crm_contact_athletes", "crm_contacts"),
            ("crm_outreach_logs", "crm_outreach"),
            ("pipeline_closed", "pipeline_closed"),
        ]
        for key, sheet_name in sheet_order:
            df = to_dataframe(sheets.get(key, []))
            # Excel sheet names max 31 chars
            safe_name = sheet_name[:31]
            df.to_excel(writer, sheet_name=safe_name, index=False)

    print(f"Wrote {output_path}")
    for key, rows in sheets.items():
        print(f"  {key}: {len(rows)} row(s)")


def parse_name(name: str) -> tuple[str, str]:
    parts = name.strip().split()
    if len(parts) < 2:
        print("Provide full name, e.g. 'Griffin Colapinto'", file=sys.stderr)
        sys.exit(1)
    return parts[0], " ".join(parts[1:])


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Export athlete data to Excel")
    parser.add_argument("name", nargs="?", help='Athlete full name, e.g. "Griffin Colapinto"')
    parser.add_argument("--athlete-id", help="Athlete UUID (skips name lookup)")
    parser.add_argument(
        "-o",
        "--output",
        help="Output .xlsx path (default: exports/<name>_<timestamp>.xlsx)",
    )
    args = parser.parse_args()

    if args.athlete_id:
        athlete_id = args.athlete_id
        athlete_label = args.athlete_id
    elif args.name:
        first, last = parse_name(args.name)
        athlete_id = resolve_athlete_id(first, last)
        athlete_label = re.sub(r"[^\w\-]+", "_", args.name.strip())
    else:
        parser.print_help()
        sys.exit(1)

    if args.output:
        output_path = Path(args.output)
    else:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = ROOT / "exports" / f"{athlete_label}_{ts}.xlsx"

    export_workbook(athlete_id, athlete_label, output_path)


if __name__ == "__main__":
    main()
