"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import { supabase } from "@/lib/supabase/client";

async function fetchProfileFromServer(): Promise<Profile | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data: { profile?: Profile | null } = await res.json();
    return data.profile ?? null;
  } catch {
    return null;
  }
}

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const profile = await fetchProfileFromServer();
        setProfile((prev) => profile ?? (prev?.user_id === session.user.id ? prev : null));
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const profile = await fetchProfileFromServer();
        setProfile((prev) => profile ?? (prev?.user_id === session.user.id ? prev : null));
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
