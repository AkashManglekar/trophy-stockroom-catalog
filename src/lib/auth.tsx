import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "./domain";
import { clearPersisted, persistQueries, restoreQueries } from "./query-persist";

/** The signed-in session saved by Supabase on this device, read without waiting (verified right after). */
function storedSession(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "null") as Session | null;
      if (v?.user?.id && v.refresh_token) return v;
    }
  } catch {
    /* storage blocked */
  }
  return null;
}

type AuthState = {
  session: Session | null;
  loading: boolean;
  userId: string | null;
  email: string | null;
  role: Role | null;
  canEdit: boolean;
  canContribute: boolean;
  /** Bills go straight into stock (otherwise they wait for approval). */
  canPublish: boolean;
  /** Can approve other people's bills. */
  canApprove: boolean;
  isOwner: boolean;
  hasAccess: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Open straight away from this device's last copy; the network check happens in the background.
  const [initial] = useState(() => {
    restoreQueries(qc);
    return storedSession();
  });
  const [session, setSession] = useState<Session | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => persistQueries(qc), [qc]);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "SIGNED_OUT") {
        clearPersisted();
        qc.clear();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const userId = session?.user.id ?? null;
  const roleQ = useQuery({
    queryKey: ["my-role", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role,can_publish")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data ? { role: data.role as Role, canPublish: !!data.can_publish } : null;
    },
  });
  const role = roleQ.data?.role ?? null;
  const pub = role === "owner" || (!!roleQ.data?.canPublish && role !== "viewer");
  const value: AuthState = {
    session,
    loading: loading || (!!userId && roleQ.isLoading),
    userId,
    email: session?.user.email ?? null,
    role,
    isOwner: role === "owner",
    hasAccess: !!role,
    canPublish: pub,
    canApprove: role === "owner" || (role === "editor" && pub),
    canEdit: role === "owner" || role === "editor",
    canContribute: role === "owner" || role === "editor" || role === "contributor",
    signOut: async () => {
      clearPersisted();
      await supabase.auth.signOut();
      qc.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
