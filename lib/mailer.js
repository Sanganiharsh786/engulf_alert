import nodemailer from "nodemailer";

function makeTransport(email) {
  const port = Number(email.smtpPort);
  return nodemailer.createTransport({
    host: email.smtpServer,
    port,
    secure: port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: email.sender, pass: email.password },
  });
}

export async function sendAlertEmail(email, { subject, text, svg, filename }) {
  const transport = makeTransport(email);
  const attachments = svg
    ? [{ filename: filename || "chart.svg", content: svg, contentType: "image/svg+xml" }]
    : [];
  await transport.sendMail({
    from: email.sender,
    to: (email.recipients || []).join(", "),
    subject,
    text,
    attachments,
  });
}

// confirm credentials work WITHOUT sending anything
export async function verifyEmail(email) {
  const transport = makeTransport(email);
  await transport.verify();
}

// send a real test email to the configured recipients
export async function sendTestEmail(email) {
  const transport = makeTransport(email);
  await transport.sendMail({
    from: email.sender,
    to: (email.recipients || []).join(", "),
    subject: "Engulfing Alerts - test notification",
    text: `This is a test notification from Engulfing Alerts.\n\nSent at ${new Date().toLocaleString()}.\nIf you received this, your email alerts are configured correctly.`,
  });
}
