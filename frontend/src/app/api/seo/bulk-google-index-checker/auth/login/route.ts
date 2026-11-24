import { NextRequest, NextResponse } from 'next/server';
import {
  STATE_COOKIE_NAME,
  VERIFIER_COOKIE_NAME,
  REDIRECT_URI_COOKIE_NAME,
  generatePkcePair,
  generateCsrfState,
} from '@/lib/seo/bulk-google-index-checker/sessionUtils';
import {
  getGoogleConfig,
  getTrustedOrigin,
  buildGoogleAuthUrl,
} from '@/lib/seo/bulk-google-index-checker/gscService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const referer = req.headers.get('referer');
  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {}
  }
  const originParam = req.nextUrl.searchParams.get('origin');
  const hostHeader = req.headers.get('host');

  // Candidate priority: origin param > referer > forwarded host > non-vercel host > nextUrl.origin
  const candidate =
    originParam ||
    refererOrigin ||
    (forwardedHost ? `${forwardedProto}://${forwardedHost.split(',')[0].trim()}` : null) ||
    (hostHeader && !hostHeader.includes('vercel.app') ? `${forwardedProto}://${hostHeader}` : null) ||
    req.nextUrl.origin;

  const trustedOrigin = getTrustedOrigin(candidate);
  const config = getGoogleConfig(trustedOrigin);

  if (!config) {
    return NextResponse.json(
      {
        success: false,
        error: 'Google Search Console OAuth is not configured yet on this server.',
      },
      { status: 500 }
    );
  }

  const state = generateCsrfState();
  const { verifier, challenge } = generatePkcePair();

  const authUrl = buildGoogleAuthUrl(config, state, challenge);
  const response = NextResponse.redirect(authUrl);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600, // 10 minutes
  };

  response.cookies.set(STATE_COOKIE_NAME, state, cookieOptions);
  response.cookies.set(VERIFIER_COOKIE_NAME, verifier, cookieOptions);
  response.cookies.set(REDIRECT_URI_COOKIE_NAME, config.redirectUri, cookieOptions);

  return response;
}
