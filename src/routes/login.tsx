import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { LOGO_BLUE } from "@/lib/domain";
import { Field, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { setpw?: string | undefined } => ({
    setpw: s["setpw"] ? "1" : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in · Sportagon Stockroom" }] }),
  component: Login,
});

function Login() {
  const { session } = useAuth();
  const { setpw } = Route.useSearch();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "reset" | "newpw">(setpw ? "newpw" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((e) => {
      if (e === "PASSWORD_RECOVERY") setMode("newpw");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session && mode !== "newpw") nav({ to: "/receive" });
  }, [session, mode, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error)
          throw new Error(
            /banned/i.test(error.message)
              ? "This account is switched off. Contact the owner."
              : /invalid/i.test(error.message)
                ? "Wrong email or password"
                : error.message,
          );
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login?setpw=1`,
        });
        if (error) throw error;
        toast.success("If that email has an account, a reset link is on its way.");
        setMode("in");
      } else {
        if (!session) throw new Error("This link has expired — request a new one.");
        if (password.length < 8) throw new Error("Use at least 8 characters");
        if (password !== password2) throw new Error("The two passwords don't match");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password set");
        nav({ to: "/receive" });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "in" ? "Sign in" : mode === "reset" ? "Reset password" : "Set new password";
  return (
    <main className="bg-hero flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="panel grid w-full max-w-sm gap-4 p-6 sm:p-8">
        <div className="grid justify-items-center gap-4 pb-1 text-center">
          <img src={LOGO_BLUE} alt="Sportagon" width={794} height={160} className="h-9 w-auto" />
          <h1 className="heading text-2xl">{title}</h1>
        </div>
        {mode !== "newpw" && (
          <Field label="Email">
            <TextInput
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}
        {mode !== "reset" && (
          <Field label={mode === "newpw" ? "New password" : "Password"}>
            <TextInput
              type="password"
              required
              minLength={mode === "newpw" ? 8 : undefined}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {mode === "newpw" && (
          <Field label="Repeat new password">
            <TextInput
              type="password"
              required
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </Field>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="h-11 rounded-full font-bold uppercase tracking-wide"
        >
          {busy
            ? "Please wait…"
            : mode === "in"
              ? "Sign in"
              : mode === "reset"
                ? "Send reset link"
                : "Save password"}
        </Button>
        <div className="flex justify-center text-sm">
          {mode === "in" ? (
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setMode("reset")}
            >
              Forgot password?
            </button>
          ) : (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setMode("in");
                nav({ to: "/login", search: {} });
              }}
            >
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
