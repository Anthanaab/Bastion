import crypto from "crypto";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.BASTION_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      cachedKey = Buffer.from(raw, "hex");
      return cachedKey;
    }
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      cachedKey = decoded;
      return cachedKey;
    }
    throw new Error(
      "BASTION_ENCRYPTION_KEY doit faire 32 octets (64 caractères hex ou 44 base64)"
    );
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error(
      "BASTION_ENCRYPTION_KEY ou JWT_SECRET (16+ caractères) requis pour chiffrer les identifiants"
    );
  }

  cachedKey = crypto.scryptSync(jwtSecret, "bastion-secrets", 32);
  return cachedKey;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** À appeler au démarrage : échoue tôt et clairement plutôt que de laisser
 * chaque chiffrement (création/édition d'hôte) planter en 500 plus tard. */
export function assertEncryptionKeyConfigured(): void {
  resolveKey();
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]);
  return `${PREFIX}${payload.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext;

  const key = resolveKey();
  const payload = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("Secret chiffré invalide");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptNullable(value: string | null): string | null {
  if (!value) return null;
  return encryptSecret(value);
}

export function decryptNullable(value: string | null): string | null {
  if (!value) return null;
  return decryptSecret(value);
}
