import { formatCryptoPrice } from "@crypto-bot/shared";

export { formatCryptoPrice };

export function formatPrice(price: number): string {
  if (price === 0) return "0.00";
  return formatCryptoPrice(price);
}
