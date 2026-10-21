import Link from "next/link";

const features = [
  ["Signals", "Parse, preview and confirm every trade before execution."],
  ["Risk controls", "One risk engine for demo and live accounts."],
  ["Recovery", "Exchange-hosted protection and worker reconciliation."]
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">Vexqora Trade</p>
      <h1>Intelligent Trade Execution Platform</h1>
      <p className="lead">Signals · Execution · Risk Management · Automation</p>
      <p><Link href="/login">Sign in to continue →</Link></p>
      <section className="grid">
        {features.map(([title, description]) => (
          <article className="card" key={title}><h2>{title}</h2><p>{description}</p></article>
        ))}
      </section>
    </main>
  );
}

