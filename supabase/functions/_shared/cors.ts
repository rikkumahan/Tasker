const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "https://tasker-kappa-flame.vercel.app",
];

export function getCorsHeaders(req?: Request): Record<string, string> {
  const envOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const requestOrigin = req?.headers.get("origin") || "";
  let allowOrigin = envOrigin || "https://tasker-kappa-flame.vercel.app";
  if (requestOrigin && (ALLOWED_ORIGINS.includes(requestOrigin) || requestOrigin === envOrigin)) {
    allowOrigin = requestOrigin;
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export const corsHeaders = getCorsHeaders();
