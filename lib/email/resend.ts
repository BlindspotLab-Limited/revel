import { Resend } from "resend";
import { runInBackground } from "@/lib/runtime/cloudflare";
import { siteConfig } from "@/lib/site-config";

let client: Resend | null = null;

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

export function getFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    `Revel <${siteConfig.organization.email}>`
  );
}

export function getAdminNotifyEmail(): string {
  return (
    process.env.REVEL_ADMIN_NOTIFY_EMAIL?.trim() ||
    siteConfig.organization.email
  );
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.warn("[Revel] email_skipped", input.subject, "(RESEND_API_KEY not set)");
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      console.error("[Revel] email_failed", input.subject, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "[Revel] email_failed",
      input.subject,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export function sendEmailAsync(input: SendEmailInput): void {
  runInBackground(sendEmail(input));
}