"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import { supabase } from "@/lib/supabase/client";

async function fetchProfileFromServer(): Promise<{
  profile: Profile | null;
  isConsultingUser: boolean;
}> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.status === 401) return { profile: null, isConsultingUser: false };
    if (!res.ok) return { profile: null, isConsultingUser: false };
    const data: {
      profile?: Profile | null;
      is_consulting_user?: boolean;
    } = await res.json();
    return {
      profile: data.profile ?? null,
      isConsultingUser: Boolean(data.is_consulting_user),
    };
  } catch {
    return { profile: null, isConsultingUser: false };
  }
}

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  isConsultingUser: boolean;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  isConsultingUser: false,
  loading: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isConsultingUser, setIsConsultingUser] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const { profile, isConsultingUser } = await fetchProfileFromServer();
        setProfile((prev) => profile ?? (prev?.user_id === session.user.id ? prev : null));
        setIsConsultingUser(isConsultingUser);
      } else {
        setProfile(null);
        setIsConsultingUser(false);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const { profile, isConsultingUser } = await fetchProfileFromServer();
        setProfile((prev) => profile ?? (prev?.user_id === session.user.id ? prev : null));
        setIsConsultingUser(isConsultingUser);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, isConsultingUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
