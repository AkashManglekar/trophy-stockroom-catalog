import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Mail, Power, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { OWNER_EMAIL, ROLE_INFO, type Role } from "@/lib/domain";
import {
  createMember,
  listMembers,
  removeMember,
  sendMemberReset,
  setMemberDisabled,
  setMemberEmail,
  setMemberPassword,
  updateMember,
  type Member,
} from "@/lib/users.functions";
import { Card, CardTitle, Field, Notice, Pill, Select, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Assignable = Exclude<Role, "owner">;
const ROLES = Object.keys(ROLE_INFO) as Assignable[];

function strongPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (n) => a[n % a.length]).join("");
}
function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function BillAccess({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <Select
      value={value ? "direct" : "approval"}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "direct")}
    >
      <option value="approval">Bills need approval</option>
      <option value="direct">Publishes bills directly</option>
    </Select>
  );
}

/** Owner-only: create people, set roles and bill rights, reset credentials, switch off or remove. */
export function TeamManager() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["members"], queryFn: () => listMembers() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const [adding, setAdding] = useState(false);
  const members = q.data ?? [];
  return (
    <Card>
      <CardTitle
        right={
          <Button size="sm" className="rounded-full" onClick={() => setAdding((v) => !v)}>
            <UserPlus className="size-4" /> {adding ? "Close" : "Add person"}
          </Button>
        }
      >
        Team & access
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        Only you ({OWNER_EMAIL}) can add people — there is no public sign-up. Anyone who adds bills
        either <b>publishes directly</b> (stock updates at once) or <b>needs approval</b> (you, or
        an editor who publishes directly, approve it first).
      </p>
      {adding && (
        <AddMember
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {q.error && <Notice tone="bad">{msg(q.error)}</Notice>}
      <div className="grid gap-2">
        {members.map((m) => (
          <MemberRow key={m.userId} m={m} onChange={refresh} />
        ))}
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading people…</p>}
      </div>
    </Card>
  );
}

function AddMember({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    fullName: "",
    email: "",
    password: strongPassword(),
    role: "contributor" as Assignable,
    canPublish: false,
  });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  async function save() {
    setBusy(true);
    try {
      await createMember({ data: f });
      setMade({ email: f.email.trim().toLowerCase(), password: f.password });
      toast.success("Account created");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  }
  if (made) {
    const text = `Sportagon Stockroom\n${window.location.origin}/login\nEmail: ${made.email}\nPassword: ${made.password}`;
    return (
      <div className="grid gap-2 rounded-xl border border-success bg-success/5 p-3 text-sm">
        <strong>Account ready — share these details privately</strong>
        <pre className="wrap-any whitespace-pre-wrap rounded-lg bg-card p-2.5 font-mono text-xs">
          {text}
        </pre>
        <p className="text-xs text-muted-foreground">
          The password isn't shown again. They can change it from Settings → My account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Copied"))}
          >
            Copy details
          </Button>
          <Button size="sm" className="rounded-full" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-xl border bg-muted/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
        </Field>
        <Field label="Email (their login)">
          <TextInput
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Field>
        <Field label="Starting password" hint="At least 8 characters. Generated for you.">
          <div className="flex gap-2">
            <TextInput
              className="font-mono"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 rounded-lg"
              onClick={() => setF({ ...f, password: strongPassword() })}
            >
              New
            </Button>
          </div>
        </Field>
        <Field label="Role" hint={ROLE_INFO[f.role].does}>
          <Select
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value as Assignable })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r].label}
              </option>
            ))}
          </Select>
        </Field>
        {f.role !== "viewer" && (
          <Field label="Bills">
            <BillAccess value={f.canPublish} onChange={(v) => setF({ ...f, canPublish: v })} />
          </Field>
        )}
      </div>
      <Button
        className="w-fit rounded-full"
        disabled={busy || !f.email.trim() || f.password.length < 8}
        onClick={save}
      >
        {busy ? "Creating…" : "Create account"}
      </Button>
    </div>
  );
}

function MemberRow({ m, onChange }: { m: Member; onChange: () => void }) {
  const { userId } = useAuth();
  const owner = m.role === "owner";
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState(m.email);
  const [name, setName] = useState(m.fullName);
  const [sure, setSure] = useState("");
  const [busy, setBusy] = useState("");

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChange();
      return true;
    } catch (e) {
      toast.error(msg(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  const access = (role: Assignable, canPublish: boolean) =>
    act(
      "access",
      () => updateMember({ data: { userId: m.userId, role, canPublish, fullName: name } }),
      "Access updated",
    );
  const twice = (key: string, fn: () => void) => {
    if (sure !== key) {
      setSure(key);
      return;
    }
    setSure("");
    fn();
  };

  return (
    <div className={cn("grid gap-2 rounded-xl border p-3", m.disabled && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <strong className="wrap-any block text-sm">
            {m.fullName || m.email}
            {m.userId === userId ? " (you)" : ""}
          </strong>
          <span className="wrap-any block text-xs text-muted-foreground">
            {m.fullName ? `${m.email} · ` : ""}
            {m.lastSignIn ? `last in ${m.lastSignIn.slice(0, 10)}` : "never signed in"}
          </span>
        </div>
        {owner ? (
          <Pill tone="brand">Owner · super admin</Pill>
        ) : !m.role ? (
          <Pill tone="bad">no access</Pill>
        ) : (
          <>
            <Pill>{ROLE_INFO[m.role as Assignable].label}</Pill>
            {m.role !== "viewer" && (
              <Pill tone={m.canPublish ? "ok" : "warn"}>
                {m.canPublish ? "publishes bills" : "bills need approval"}
              </Pill>
            )}
          </>
        )}
        {m.disabled && <Pill tone="bad">switched off</Pill>}
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Manage"}
        </Button>
      </div>

      {open && (
        <div className="grid gap-3 border-t pt-3">
          {!owner && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Name">
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    if (name !== m.fullName && m.role && m.role !== "owner")
                      access(m.role as Assignable, m.canPublish);
                  }}
                />
              </Field>
              <Field
                label="Role"
                hint={m.role ? ROLE_INFO[m.role as Assignable]?.does : "Pick a role to give access"}
              >
                <Select
                  value={m.role ?? ""}
                  disabled={!!busy}
                  onChange={(e) => access(e.target.value as Assignable, m.canPublish)}
                >
                  {!m.role && <option value="">No access</option>}
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </option>
                  ))}
                </Select>
              </Field>
              {m.role && m.role !== "viewer" && (
                <Field label="Bills">
                  <BillAccess
                    value={m.canPublish}
                    disabled={!!busy}
                    onChange={(v) => access(m.role as Assignable, v)}
                  />
                </Field>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={owner ? "Set your password" : "Set a new password"}>
              <div className="flex gap-2">
                <TextInput
                  className="font-mono"
                  placeholder="min 8 characters"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                {!owner && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0 rounded-lg"
                    onClick={() => setPw(strongPassword())}
                  >
                    New
                  </Button>
                )}
                <Button
                  className="h-10 shrink-0 rounded-lg"
                  disabled={pw.length < 8 || !!busy}
                  onClick={async () => {
                    const shown = pw;
                    if (
                      await act(
                        "pw",
                        () => setMemberPassword({ data: { userId: m.userId, password: shown } }),
                        "Password changed",
                      )
                    ) {
                      if (!owner)
                        navigator.clipboard
                          ?.writeText(shown)
                          .then(() => toast("New password copied — share it privately"));
                      setPw("");
                    }
                  }}
                >
                  <KeyRound className="size-4" />
                </Button>
              </div>
            </Field>
            {!owner && (
              <Field label="Login email">
                <div className="flex gap-2">
                  <TextInput
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="h-10 shrink-0 rounded-lg"
                    disabled={email.trim().toLowerCase() === m.email || !!busy}
                    onClick={() =>
                      act(
                        "email",
                        () => setMemberEmail({ data: { userId: m.userId, email } }),
                        "Email changed",
                      )
                    }
                  >
                    Save
                  </Button>
                </div>
              </Field>
            )}
          </div>

          {!owner && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "reset",
                    () => sendMemberReset({ data: { userId: m.userId } }),
                    "Reset link emailed",
                  )
                }
              >
                <Mail className="size-4" /> Email a reset link
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "off",
                    () => setMemberDisabled({ data: { userId: m.userId, disabled: !m.disabled } }),
                    m.disabled ? "Switched back on" : "Switched off — they can't sign in",
                  )
                }
              >
                <Power className="size-4" /> {m.disabled ? "Switch on" : "Switch off"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-destructive"
                disabled={!!busy}
                onClick={() =>
                  twice("rm", () =>
                    act(
                      "rm",
                      () => removeMember({ data: { userId: m.userId } }),
                      "Removed — their bills and history stay",
                    ),
                  )
                }
              >
                <Trash2 className="size-4" />{" "}
                {sure === "rm" ? "Tap again to remove for good" : "Remove"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Any signed-in person can change their own password. */
export function MyAccount() {
  const { email } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pw.length < 8) {
      toast.error("Use at least 8 characters");
      return;
    }
    if (pw !== pw2) {
      toast.error("The two passwords don't match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPw("");
    setPw2("");
    toast.success("Password changed");
  }
  return (
    <Card>
      <CardTitle>My account</CardTitle>
      <p className="wrap-any text-sm text-muted-foreground">Signed in as {email}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="New password">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </Field>
        <Field label="Repeat">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        </Field>
        <Button className="self-end rounded-full" disabled={busy || !pw} onClick={save}>
          Change password
        </Button>
      </div>
    </Card>
  );
}
