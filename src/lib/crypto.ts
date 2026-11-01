import { AuthError, base64Url } from "./auth";

const VERSION_PREFIX = "v1.";
const HKDF_INFO = "gift-cabinet/vault/v1";
const MASTER_BYTES = 32;
const IV_BYTES = 12;

export function readVaultKey(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const raw = (source as Record<string, unknown>).VAULT_KEY;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(VERSION_PREFIX);
}

function decodeBytes(text: string): Uint8Array<ArrayBuffer> {
  let normalized = text.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) normalized += "=";
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new AuthError(500, "That vault entry cannot be opened right now.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeMasterKey(raw: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBytes(raw);
  if (bytes.length !== MASTER_BYTES) {
    throw new AuthError(500, "Card vault is misconfigured. Try again later.");
  }
  return bytes;
}

function requireMasterKey(raw: string | null): Uint8Array<ArrayBuffer> {
  if (!raw) throw new AuthError(503, "Card vault encryption is not switched on yet.");
  return decodeMasterKey(raw);
}

async function userKey(master: Uint8Array<ArrayBuffer>, userId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(userId),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptField(
  masterRaw: string | null,
  userId: string,
  aad: string,
  plaintext: string,
): Promise<string> {
  const key = await userKey(requireMasterKey(masterRaw), userId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION_PREFIX}${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
}

export async function decryptField(
  masterRaw: string | null,
  userId: string,
  aad: string,
  stored: string,
): Promise<string> {
  // Legacy rows were stored in plaintext; they open as-is until rewritten.
  if (!isEncrypted(stored)) return stored;
  const key = await userKey(requireMasterKey(masterRaw), userId);
  try {
    const [, ivText, cipherText] = stored.split(".");
    if (!ivText || !cipherText) throw new Error("shape");
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBytes(ivText),
        additionalData: new TextEncoder().encode(aad),
      },
      key,
      decodeBytes(cipherText),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(500, "That vault entry cannot be opened right now.");
  }
}
