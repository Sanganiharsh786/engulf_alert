import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { sendTestEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = await readStore();
    const email = store.settings.email || {};
    if (!email.recipients || email.recipients.length === 0) {
      return NextResponse.json({ ok: false, error: "No recipients configured." }, { status: 400 });
    }
    await sendTestEmail(email);
    return NextResponse.json({ ok: true, sentTo: email.recipients });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
