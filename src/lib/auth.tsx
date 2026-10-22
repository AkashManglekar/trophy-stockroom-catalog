import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "./domain";

type AuthState = {
  session: Session | null;
  loading: boolean;
  userId: string | null;
  email: string | null;
  role: Role | null;
  canEdit: boolean;
  canContribute: boolean;
  isOwner: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  const roleQ = useQuery({
    queryKey: ["my-role", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as Role) ?? null;
    },
  });
  const role = roleQ.data ?? null;
  const value: AuthState = {
    session,
    loading: loading || (!!userId && roleQ.isLoading),
    userId,
    email: session?.user.email ?? null,
    role,
    isOwner: role === "owner",
    canEdit: role === "owner" || role === "editor",
    canContribute: role === "owner" || role === "editor" || role === "contributor",
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
