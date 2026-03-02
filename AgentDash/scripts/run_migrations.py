#!/usr/bin/env python3
"""
Run AgentDash migrations on Supabase
Uses Postgres connection from SUPABASE_DB_URL in parent supabase.env
"""
import os
import sys
from pathlib import Path

# Add parent to path to read supabase.env
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

# Load env from parent supabase.env
def load_env():
    env_path = ROOT / "supabase.env"
    if not env_path.exists():
        print(f"supabase.env not found at {env_path}")
        sys.exit(1)
    
    env = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            env[key] = val
    return env

env = load_env()
db_url = env.get("SUPABASE_DB_URL")

if not db_url:
    print("SUPABASE_DB_URL not found in supabase.env")
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Install with: pip install psycopg2-binary")
    sys.exit(1)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
migrations = [
    "20250203000000_initial_schema.sql",
    "20250203000001_rls_policies.sql",
    "20250203000002_seed_categories.sql",
]

def run_migrations():
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()
    
    try:
        for filename in migrations:
            filepath = MIGRATIONS_DIR / filename
            if not filepath.exists():
                print(f"Migration file not found: {filepath}")
                continue
            
            print(f"\nRunning {filename}...")
            with open(filepath) as f:
                sql = f.read()
            
            try:
                cur.execute(sql)
                conn.commit()
                print(f"✓ {filename} completed")
            except Exception as e:
                conn.rollback()
                print(f"✗ {filename} failed: {e}")
                raise
        
        print("\n✅ All migrations completed successfully!")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    run_migrations()
