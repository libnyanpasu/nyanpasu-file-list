const textEncoder = new TextEncoder();

export interface UploadSessionTokenPayload {
  uploadUrl: string;
  fileSize: number;
  filename: string;
  mimeType: string | null;
  fileId: string;
  folderPath: string | null;
  exp: number;
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }

  return out;
};

const hmacSign = async (secret: string, data: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return new Uint8Array(sig);
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
};

export const createUploadSessionToken = async (
  payload: UploadSessionTokenPayload,
  secret: string,
): Promise<string> => {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = textEncoder.encode(payloadJson);
  const payloadBase64 = toBase64Url(payloadBytes);
  const signature = await hmacSign(secret, payloadBase64);
  const signatureBase64 = toBase64Url(signature);
  return `${payloadBase64}.${signatureBase64}`;
};

export const verifyUploadSessionToken = async (
  token: string,
  secret: string,
): Promise<UploadSessionTokenPayload | null> => {
  const [payloadBase64, signatureBase64] = token.split(".");

  if (!payloadBase64 || !signatureBase64) {
    return null;
  }

  const actualSignature = fromBase64Url(signatureBase64);
  const expectedSignature = await hmacSign(secret, payloadBase64);

  if (!constantTimeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  try {
    const payloadBytes = fromBase64Url(payloadBase64);
    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as UploadSessionTokenPayload;

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    if (!payload.uploadUrl || !payload.filename || !payload.fileId) {
      return null;
    }

    if (!payload.fileSize || payload.fileSize <= 0) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};
