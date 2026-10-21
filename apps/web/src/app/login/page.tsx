import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="shell">
      <p className="eyebrow">Account access</p>
      <h1>Sign in</h1>
      <form className="auth">
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        {error ? <p className="error">{error}</p> : null}
        <button formAction={signIn}>Sign in</button>
        <button formAction={signUp}>Create account</button>
      </form>
    </main>
  );
}

