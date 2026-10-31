export interface Mailer {
  send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown>;
}

export function otpSubject(): string {
  return "Your Gift Cabinet code";
}

export function otpText(code: string): string {
  return `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not request it, ignore this email.`;
}

export async function sendOtpEmail(mailer: Mailer, to: string, from: string, code: string): Promise<void> {
  await mailer.send({ to, from, subject: otpSubject(), text: otpText(code) });
}

export interface ReminderMail {
  retailer: string;
  balance: string;
  expiry: string | null;
  daysUntil: number | null;
  reason: "expiry" | "low";
}

function expiryPhrase(mail: ReminderMail): string {
  if (mail.daysUntil === 0) return "expires today";
  if (mail.daysUntil === 1) return "expires tomorrow";
  return `expires in ${mail.daysUntil} days (${mail.expiry})`;
}

export function reminderSubject(mail: ReminderMail): string {
  if (mail.reason === "expiry") return `Gift Cabinet: ${mail.retailer} ${expiryPhrase(mail)}`;
  return `Gift Cabinet: ${mail.retailer} is down to ${mail.balance}`;
}

export function reminderText(mail: ReminderMail): string {
  const lead =
    mail.reason === "expiry"
      ? `Your ${mail.retailer} gift card (${mail.balance}) ${expiryPhrase(mail)}. Spend it soon so the balance is not lost.`
      : `Your ${mail.retailer} gift card is down to ${mail.balance}. Worth using before it slips your mind.`;
  return `${lead}\n\nOpen your cabinet: https://gift.dosa.dev/cabinet`;
}
