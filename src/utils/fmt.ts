import { ZodError } from "zod";

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    if (err instanceof ZodError) {
      return err.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
    }
    return err.message;
  }

  // Handle case where error might be a ZodError-like object
  if (
    err &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as any).issues)
  ) {
    try {
      return (err as any).issues
        .map(
          (e: any) =>
            `${e.path?.join?.(".") || "unknown"}: ${e.message || "Invalid value"}`,
        )
        .join("; ");
    } catch (formatErr) {
      console.error("Error formatting ZodError-like object:", formatErr);
    }
  }

  return String(err);
}
