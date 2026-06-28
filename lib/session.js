// Helper for reading the logged-in user inside API route handlers.
// (Uses next/headers, so it must NOT be imported from middleware.)
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./auth.js";

export async function currentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
