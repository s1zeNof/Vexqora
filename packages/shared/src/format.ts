export function formatCryptoPrice(price?: number | null): string {
  if (price == null || !Number.isFinite(price) || price === 0) return "—";

  const abs = Math.abs(price);
  if (abs >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (abs >= 0.01) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  if (abs >= 0.0001) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 7 });
  }
  return price.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}
