import { describe, expect, it } from "vitest";
import { otpSubject, otpText, sendOtpEmail } from "./email";

describe("sendOtpEmail", () => {
  it("sends a plain-text code with a short expiry note", async () => {
    const sent: unknown[] = [];
    await sendOtpEmail({ send: async (m) => void sent.push(m) }, "ada@e.com", "cabinet@gift.dosa.dev", "123456");
    expect(sent).toEqual([
      {
        to: "ada@e.com",
        from: "cabinet@gift.dosa.dev",
        subject: otpSubject(),
        text: otpText("123456"),
      },
    ]);
    expect(otpText("123456")).toContain("123456");
    expect(otpText("123456")).toContain("10 minutes");
  });
});
