import { OnedriveConfigSchema } from "@/lib/onedrive";
import { env } from "cloudflare:workers";

const getEnvValue = (key: string): string | undefined => {
  const workerValue = (env as unknown as Record<string, string | undefined>)[key];
  const processValue = process.env[key];
  const value = workerValue || processValue;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const getOnedriveSetting = () =>
  OnedriveConfigSchema.parse({
    clientID: getEnvValue("ONEDRIVE_CLIENT_ID"),
    clientSecret: getEnvValue("ONEDRIVE_CLIENT_SECRET"),
    tenantID: getEnvValue("ONEDRIVE_TENANT_ID"),
    userEmail: getEnvValue("ONEDRIVE_USER_EMAIL"),
    storagePath: getEnvValue("ONEDRIVE_STORAGE_PATH"),
  });

export const getUploadToken = (): string | undefined => getEnvValue("UPLOAD_TOKEN");

export const getMissingOnedriveSettings = (): string[] => {
  const requiredKeys = [
    "ONEDRIVE_CLIENT_ID",
    "ONEDRIVE_CLIENT_SECRET",
    "ONEDRIVE_TENANT_ID",
    "ONEDRIVE_USER_EMAIL",
    "ONEDRIVE_STORAGE_PATH",
  ];

  return requiredKeys.filter((key) => !getEnvValue(key));
};
