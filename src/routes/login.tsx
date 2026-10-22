import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Field, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · Sportagon Stockroom" }] }),
  component: Login,
});

function Login() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav({ to: "/receive" });
  }, [session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/receive` },
        });
        if (error) throw error;
        toast.success(
          "Account created. If asked, confirm your email, then sign in. New accounts start as viewers until the owner changes the role.",
        );
        setMode("in");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw error;
        toast.success("Password reset link sent — check your email.");
        setMode("in");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-hero flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="panel grid w-full max-w-sm gap-4 p-6">
        <div>
          <p className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">
            Sportagon
          </p>
          <h1 className="heading mt-1 text-2xl">
            {mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Reset password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stockroom — inventory, codes, pricing and catalogue.
          </p>
        </div>
        <Field label="Email">
          <TextInput
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {mode !== "reset" && (
          <Field label="Password">
            <TextInput
              type="password"
              required
              minLength={8}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              : mode === "up"
                ? "Create account"
                : "Send reset link"}
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          {mode !== "in" ? (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setMode("in")}
            >
              Back to sign in
            </button>
          ) : (
            <>
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setMode("up")}
              >
                Create an account
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setMode("reset")}
              >
                Forgot password?
              </button>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
