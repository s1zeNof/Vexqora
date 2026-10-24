export function formatTimeAgo(dateInput?: string | number | null): string {
  if (!dateInput) return "just now";
  const timestamp = typeof dateInput === "number" ? dateInput : new Date(dateInput).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d ago`;
}
