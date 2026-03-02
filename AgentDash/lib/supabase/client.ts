import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "./env";

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
