import { generateSecret, generateURI, verifySync } from "otplib";
import { decryptNullable, encryptNullable } from "./crypto";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(username: string, secret: string): string {
  return generateURI({ issuer: "Bastion", label: username, secret });
}

export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    return verifySync({ secret, token }).valid;
  } catch {
    return false;
  }
}

export function encryptTotpSecret(secret: string): string {
  return encryptNullable(secret) ?? secret;
}

export function decryptTotpSecret(stored: string | null | undefined): string | null {
  return decryptNullable(stored ?? null);
}
