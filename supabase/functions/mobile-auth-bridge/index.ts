/**
 * mobile-auth-bridge
 *
 * Problem: Supabase GoTrue refuses to redirect to exp:// schemes (Expo Go URLs).
 * Solution: Use this HTTPS Edge Function as redirect target, which HTTP 307 redirects to the exp:// URL.
 *
 * Deploy with: supabase functions deploy mobile-auth-bridge --no-verify-jwt
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const expRedirect = url.searchParams.get('exp');

  // ponytail: read fallback from env rather than hardcoding developer's local IP
  const decoded = expRedirect
    ? decodeURIComponent(expRedirect)
    : Deno.env.get('DEV_EXPO_URL') || 'taskerai://auth-callback';

  if (!decoded.startsWith('exp://') && !decoded.startsWith('taskerai://')) {
    return new Response('Invalid redirect scheme', { status: 400 });
  }

  // ponytail: filter out 'exp' parameter natively
  url.searchParams.delete('exp');
  const queryString = url.searchParams.toString();
  const separator = queryString ? (decoded.includes('?') ? '&' : '?') : '';
  const redirectTarget = `${decoded}${separator}${queryString}`;

  return Response.redirect(redirectTarget, 307);
});
