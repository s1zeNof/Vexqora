import { signIn, signUp, signInWithGoogle } from "./actions";
import Link from "next/link";
import { VexqoraLogo } from "../../components/logo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth-page">
      <div className="panel auth-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <VexqoraLogo size={24} />
            <strong style={{ fontSize: "16px" }}>Vexqora Trade</strong>
          </div>
          <Link href="/" className="eyebrow" style={{ fontSize: "11px" }}>Home →</Link>
        </div>

        <div>
          <h2 style={{ fontSize: "22px", marginTop: "4px" }}>Sign In</h2>
          <p style={{ color: "var(--muted)", fontSize: "13px", marginTop: "4px" }}>
            Intelligent trade execution and risk workspace.
          </p>
        </div>

        {error ? <p className="notice error">{error}</p> : null}

        <form action={signInWithGoogle}>
          <button className="button google-btn" type="submit">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </button>
        </form>

        <div className="auth-divider">or with email</div>

        <form style={{ display: "grid", gap: "14px" }}>
          <div className="form-group">
            <label>Email</label>
            <input name="email" type="email" autoComplete="email" placeholder="name@example.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input name="password" type="password" autoComplete="current-password" minLength={8} placeholder="••••••••" required />
          </div>
          <button formAction={signIn} className="button primary" style={{ width: "100%", marginTop: "4px" }}>
            Sign In
          </button>
          <button formAction={signUp} className="button secondary" style={{ width: "100%" }}>
            Create Account
          </button>
        </form>
      </div>
    </div>
  );
}
