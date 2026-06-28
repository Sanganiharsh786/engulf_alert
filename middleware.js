import { NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

// Protect the dashboard page: redirect to /login when not authenticated.
// API routes do their own auth checks (so the cron endpoint keeps working).
export async function middleware(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySession(token);
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
