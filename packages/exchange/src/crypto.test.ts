import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

describe("secret encryption", () => {
  it("round-trips with AES-256-GCM without embedding plaintext", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptSecret("top-secret", key);
    expect(encrypted).not.toContain("top-secret");
    expect(decryptSecret(encrypted, key)).toBe("top-secret");
  });

  it("rejects an invalid key size", () => {
    expect(() => encryptSecret("secret", Buffer.from("short").toString("base64"))).toThrow(/32-byte/);
  });
});

