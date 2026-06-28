import nodemailer from "nodemailer";

// Merge env vars over the stored email config.
// Secrets (sender + app password) should live in env vars on Vercel,
// NOT in store.json / KV. The stored values are only a fallback for local dev.
function resolveEmail(email = {}) {
  return {
    smtpServer: process.env.SMTP_SERVER || email.smtpServer || "smtp.gmail.com",
    smtpPort: process.env.SMTP_PORT || email.smtpPort || 587,
    sender: process.env.GMAIL_SENDER || email.sender,
    password: process.env.GMAIL_PASSWORD || email.password,
    recipients: email.recipients || [],
  };
}

function makeTransport(email) {
  const cfg = resolveEmail(email);
  const port = Number(cfg.smtpPort);
  return {
    transport: nodemailer.createTransport({
      host: cfg.smtpServer,
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS
      auth: { user: cfg.sender, pass: cfg.password },
    }),
    cfg,
  };
}

// Rasterize the chart SVG to PNG so it renders inline in Gmail (which won't
// display SVG attachments). Returns null if rasterization isn't available.
async function svgToPng(svg) {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1000 } });
    return resvg.render().asPng();
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendAlertEmail(email, { subject, text, svg, filename }) {
  const { transport, cfg } = makeTransport(email);
  const base = (filename || "chart").replace(/\.svg$/i, "");
  const attachments = [];
  let html;

  if (svg) {
    const png = await svgToPng(svg);
    if (png) {
      const cid = "chart@engulf";
      attachments.push({
        filename: `${base}.png`,
        content: png,
        contentType: "image/png",
        cid, // referenced by the inline <img> below
      });
      html =
        `<div style="font-family:ui-monospace,monospace;white-space:pre-wrap;color:#111">${escapeHtml(text)}</div>` +
        `<img src="cid:${cid}" alt="chart" style="display:block;margin-top:14px;max-width:100%;border-radius:8px;border:1px solid #ddd"/>`;
    } else {
      // fallback if PNG rasterization isn't available
      attachments.push({
        filename: `${base}.svg`,
        content: svg,
        contentType: "image/svg+xml",
      });
    }
  }

  await transport.sendMail({
    from: cfg.sender,
    to: (cfg.recipients || []).join(", "),
    subject,
    text,
    html,
    attachments,
  });
}

// confirm credentials work WITHOUT sending anything
export async function verifyEmail(email) {
  const { transport } = makeTransport(email);
  await transport.verify();
}

// send a real test email to the configured recipients
export async function sendTestEmail(email) {
  const { transport, cfg } = makeTransport(email);
  await transport.sendMail({
    from: cfg.sender,
    to: (cfg.recipients || []).join(", "),
    subject: "Engulfing Alerts - test notification",
    text: `This is a test notification from Engulfing Alerts.\n\nSent at ${new Date().toLocaleString()}.\nIf you received this, your email alerts are configured correctly.`,
  });
}
