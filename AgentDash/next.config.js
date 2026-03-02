/** @type {import('next').NextConfig} */
const path = require('path');
const fs = require('fs');

// Load .env.local so NEXT_PUBLIC_* vars are always available (fixes Turbopack/workspace env issues)
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (key.startsWith('NEXT_PUBLIC_') && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

const nextConfig = {
  reactStrictMode: true,
  // Use AgentDash as workspace root (avoids multiple-lockfile warning)
  outputFileTracingRoot: path.join(__dirname),
  // Expose Supabase env to the client (backup if automatic .env.local load fails)
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig;
