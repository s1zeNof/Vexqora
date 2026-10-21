import type { ProfileRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { signOut } from "../../login/actions";
import { updateProfile } from "../actions";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const profileRes = user ? await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle() : { data: null };
  const profile = profileRes.data as ProfileRow | null;
  const query = (await searchParams) ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "800px" }}>
      <div>
        <span className="eyebrow">User Profile</span>
        <h1 style={{ marginTop: "6px" }}>Account & Security</h1>
        <p className="lead">Manage your Vexqora account details and authentication methods.</p>
      </div>
      {query.saved ? <p className="notice success">Profile updated.</p> : null}

      <div className="card">
        <h3>SaaS Profile</h3>
        <div style={{ display: "grid", gap: "16px", marginTop: "16px" }}>
          <form action={updateProfile} className="form-group">
            <label>Display name</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input name="displayName" defaultValue={profile?.display_name ?? user?.email?.split("@")[0] ?? "Trader"} maxLength={80} required />
              <button className="button primary">Save</button>
            </div>
          </form>
          <div>
            <div className="kicker">Plan</div>
            <div style={{ marginTop: "6px" }}><span className="badge demo">Free · Paper Trading</span></div>
          </div>
          <div>
            <div className="kicker">Email Address</div>
            <div style={{ fontSize: "16px", fontWeight: "600", marginTop: "4px" }}>{user?.email}</div>
          </div>
          <div>
            <div className="kicker">Authentication Provider</div>
            <div style={{ marginTop: "6px" }}>
              <span className="badge" style={{ background: "#4285f422", color: "#4285f4", border: "1px solid #4285f444" }}>
                {user?.app_metadata?.provider ? `Connected via ${String(user.app_metadata.provider).toUpperCase()}` : "Email / Password"}
              </span>
            </div>
          </div>
          <div>
            <div className="kicker">User ID</div>
            <div className="mono" style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>{user?.id}</div>
          </div>
          <div>
            <div className="kicker">Member Since</div>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>
              {new Date(profile?.created_at || user?.created_at || Date.now()).toLocaleDateString("uk-UA", { dateStyle: "long" })}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Session</h3>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "6px" }}>
          Sign out of your active browser session on this device.
        </p>
        <form action={signOut} style={{ marginTop: "16px" }}>
          <button className="button danger" type="submit">
            Log Out of Vexqora
          </button>
        </form>
      </div>
    </div>
  );
}
