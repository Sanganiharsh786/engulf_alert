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

export async function sendAlertEmail(email, { subject, text, svg, filename }) {
  const { transport, cfg } = makeTransport(email);
  const attachments = svg
    ? [{ filename: filename || "chart.svg", content: svg, contentType: "image/svg+xml" }]
    : [];
  await transport.sendMail({
    from: cfg.sender,
    to: (cfg.recipients || []).join(", "),
    subject,
    text,
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
