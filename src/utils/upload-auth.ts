import { getUploadToken } from "@/utils/env";

const normalizeTokenValue = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearerMatch) {
    return bearerMatch[1].trim() || null;
  }

  return trimmed;
};

const unauthorizedResponse = () =>
  Response.json(
    {
      error: "Unauthorized",
      message: "Provide Authorization or x-authorization header",
    },
    { status: 401 },
  );

const serverTokenMisconfiguredResponse = () =>
  Response.json(
    {
      error: "Server misconfigured: UPLOAD_TOKEN is empty",
    },
    { status: 500 },
  );

export const getUploadTokenSecret = (): string | null =>
  normalizeTokenValue(getUploadToken());

export const requireUploadAuthorization = (
  request: Request,
): Response | null => {
  const expectedToken = getUploadTokenSecret();
  if (!expectedToken) {
    return serverTokenMisconfiguredResponse();
  }

  const authHeaderToken = normalizeTokenValue(
    request.headers.get("authorization"),
  );
  const customHeaderToken = normalizeTokenValue(
    request.headers.get("x-authorization"),
  );

  if (
    authHeaderToken === expectedToken ||
    customHeaderToken === expectedToken
  ) {
    return null;
  }

  return unauthorizedResponse();
};
