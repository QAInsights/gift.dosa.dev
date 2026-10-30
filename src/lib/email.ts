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
