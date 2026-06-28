import { NextResponse } from "next/server";
import { verifyCredentials, createSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    if (!verifyCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    const token = await createSession(username);
    const res = NextResponse.json({ ok: true, user: username });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
