import { OnedriveConfigSchema } from "@/lib/onedrive";
import { env } from "cloudflare:workers";

export const getOnedriveSetting = () =>
  OnedriveConfigSchema.parse({
    clientID: env.ONEDRIVE_CLIENT_ID,
    clientSecret: env.ONEDRIVE_CLIENT_SECRET,
    tenantID: env.ONEDRIVE_TENANT_ID,
    userEmail: env.ONEDRIVE_USER_EMAIL,
    storagePath: env.ONEDRIVE_STORAGE_PATH,
  });

export const getUploadToken = (): string => env.UPLOAD_TOKEN;
