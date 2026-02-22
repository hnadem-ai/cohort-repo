// services/emailService.js
const { BrevoClient } = require("@getbrevo/brevo"); // v4.x

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
  // optional:
  // timeoutInSeconds: 30,
  // maxRetries: 3,
});

async function sendVerificationEmail({ toEmail, toName, code }) {
  const senderEmail =
    process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@cohortbox.com";

  try {
    const result = await brevo.transactionalEmails.sendTransacEmail({
      subject: "Your CohortBox Verification Code",
      sender: { name: "CohortBox", email: senderEmail },
      to: [{ email: toEmail, name: toName || "" }],
      htmlContent: `
        <div style="font-family: Arial, sans-serif; line-height:1.5">
          <h2>Welcome to CohortBox</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; letter-spacing: 6px; font-weight: 700; margin: 12px 0;">
            ${code}
          </div>
          <p>This code expires in <b>1 hour</b>.</p>
          <p>If you didn’t sign up, ignore this email.</p>
        </div>
      `,
    });

    return { ok: true, result };
  } catch (err) {
    // v4 throws typed errors, but you can log generically:
    console.error("Brevo sendVerificationEmail failed:", err);
    return { ok: false, error: err };
  }
}

module.exports = { sendVerificationEmail };