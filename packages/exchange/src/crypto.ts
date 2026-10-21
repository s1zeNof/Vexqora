import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function decodeMasterKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_MASTER_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptSecret(plaintext: string, encodedMasterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeMasterKey(encodedMasterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, encodedMasterKey: string): string {
  const [version, ivPart, tagPart, cipherPart] = payload.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !cipherPart) throw new Error("Unsupported encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", decodeMasterKey(encodedMasterKey), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cipherPart, "base64url")), decipher.final()]).toString("utf8");
}

