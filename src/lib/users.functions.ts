import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_EMAIL, type Role } from "@/lib/domain";

export type Member = {
  userId: string;
  email: string;
  fullName: string;
  role: Role | null;
  canPublish: boolean;
  disabled: boolean;
  createdAt: string;
  lastSignIn: string | null;
};

type Assignable = Exclude<Role, "owner">;
const ASSIGNABLE: Assignable[] = ["editor", "contributor", "viewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAN_FOREVER = "876000h";

/** Service-role client, only after confirming the caller is the owner. */
async function asOwner(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.role !== "owner") throw new Error("Only the owner can manage users");
  return supabaseAdmin;
}

async function notOwner(admin: Awaited<ReturnType<typeof asOwner>>, target: string) {
  const { data } = await admin.auth.admin.getUserById(target);
  if (!data.user) throw new Error("User not found");
  if ((data.user.email ?? "").toLowerCase() === OWNER_EMAIL)
    throw new Error("The owner account can't be changed here");
  return data.user;
}

function checkPassword(pw: string) {
  if (typeof pw !== "string" || pw.length < 8)
    throw new Error("Password must be at least 8 characters");
  if (pw.length > 72) throw new Error("Password is too long");
}
function checkRole(r: unknown): Assignable {
  if (!ASSIGNABLE.includes(r as Assignable)) throw new Error("Pick a role");
  return r as Assignable;
}

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Member[]> => {
    const admin = await asOwner(context.userId);
    const [{ data: users, error }, { data: roles }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from("user_roles").select("user_id,role,can_publish,full_name"),
    ]);
    if (error) throw new Error(error.message);
    const byId = new Map((roles ?? []).map((r) => [r.user_id, r]));
    const now = Date.now();
    return users.users
      .map((u) => {
        const r = byId.get(u.id);
        const banned = (u as { banned_until?: string | null }).banned_until;
        return {
          userId: u.id,
          email: u.email ?? "",
          fullName: r?.full_name ?? String(u.user_metadata?.["full_name"] ?? ""),
          role: (r?.role as Role | undefined) ?? null,
          canPublish: !!r?.can_publish,
          disabled: !!banned && new Date(banned).getTime() > now,
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at ?? null,
        };
      })
      .sort((a, b) =>
        a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.email.localeCompare(b.email),
      );
  });

export const createMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { email: string; password: string; fullName: string; role: string; canPublish: boolean }) =>
      d,
  )
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    const email = String(data.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email");
    if (email === OWNER_EMAIL) throw new Error("That is the owner account");
    checkPassword(data.password);
    const role = checkRole(data.role);
    const fullName = String(data.fullName ?? "").trim();
    const { data: made, error } = await admin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) {
      throw new Error(
        /already|registered|exists/i.test(error.message)
          ? "A user with this email already exists"
          : error.message,
      );
    }
    const { error: e2 } = await admin.from("user_roles").upsert(
      {
        user_id: made.user.id,
        email,
        role,
        can_publish: role !== "viewer" && !!data.canPublish,
        full_name: fullName || null,
      },
      { onConflict: "user_id" },
    );
    if (e2) {
      await admin.auth.admin.deleteUser(made.user.id);
      throw new Error(e2.message);
    }
    return { userId: made.user.id };
  });

export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; role: string; canPublish: boolean; fullName: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    const u = await notOwner(admin, data.userId);
    const role = checkRole(data.role);
    const { error } = await admin.from("user_roles").upsert(
      {
        user_id: u.id,
        email: (u.email ?? "").toLowerCase(),
        role,
        can_publish: role !== "viewer" && !!data.canPublish,
        full_name: String(data.fullName ?? "").trim() || null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; password: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    checkPassword(data.password);
    if (data.userId !== context.userId) await notOwner(admin, data.userId);
    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMemberEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; email: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    await notOwner(admin, data.userId);
    const email = String(data.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email");
    if (email === OWNER_EMAIL) throw new Error("That is the owner's email");
    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await admin.from("user_roles").update({ email }).eq("user_id", data.userId);
    return { ok: true };
  });

export const setMemberDisabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; disabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    await notOwner(admin, data.userId);
    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.disabled ? BAN_FOREVER : "none",
    });
    if (error) throw new Error(error.message);
    if (data.disabled) await admin.auth.admin.signOut(data.userId).catch(() => undefined);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    await notOwner(admin, data.userId);
    const { error } = await admin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendMemberReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    const admin = await asOwner(context.userId);
    const { data: u } = await admin.auth.admin.getUserById(data.userId);
    if (!u.user?.email) throw new Error("User not found");
    const origin = new URL(getRequest().url).origin;
    const { error } = await admin.auth.resetPasswordForEmail(u.user.email, {
      redirectTo: `${origin}/login?setpw=1`,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
