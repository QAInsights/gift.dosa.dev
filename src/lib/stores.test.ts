import { describe, expect, it } from "vitest";
import { faviconUrl, storeDomain } from "./stores";

describe("storeDomain", () => {
  it("maps known retailers, including wordy and regional names", () => {
    expect(storeDomain("Amazon")).toBe("amazon.com");
    expect(storeDomain("Amazon UK")).toBe("amazon.com");
    expect(storeDomain("Target")).toBe("target.com");
    expect(storeDomain("Whole Foods")).toBe("wholefoodsmarket.com");
    expect(storeDomain("Whole Foods Market")).toBe("wholefoodsmarket.com");
    expect(storeDomain("Steam")).toBe("steampowered.com");
    expect(storeDomain("Starbucks")).toBe("starbucks.com");
    expect(storeDomain("Airbnb")).toBe("airbnb.com");
    expect(storeDomain("Sainsbury's")).toBe("sainsburys.co.uk");
    expect(storeDomain("Best Buy")).toBe("bestbuy.com");
    expect(storeDomain("BestBuy")).toBe("bestbuy.com");
    expect(storeDomain("Marks & Spencer")).toBe("marksandspencer.com");
    expect(storeDomain("J.Crew")).toBe("jcrew.com");
    expect(storeDomain("Target Store")).toBe("target.com");
  });

  it("does not borrow a brand for shops that merely contain its name", () => {
    expect(storeDomain("Sea Shell")).toBeNull();
    expect(storeDomain("Green Apple")).toBeNull();
    expect(storeDomain("Target Practice")).toBeNull();
    expect(storeDomain("127.0.0.1")).toBeNull();
    expect(storeDomain("-.com")).toBeNull();
  });

  it("accepts a retailer filed as a domain", () => {
    expect(storeDomain("amazon.com")).toBe("amazon.com");
    expect(storeDomain("www.Tesco.com")).toBe("tesco.com");
    expect(storeDomain("https://www.starbucks.com")).toBe("starbucks.com");
  });

  it("leaves generic or unknown shops to the monogram", () => {
    expect(storeDomain("Bookshop")).toBeNull();
    expect(storeDomain("Example Mart")).toBeNull();
    expect(storeDomain("Mart")).toBeNull();
    expect(storeDomain("")).toBeNull();
    expect(storeDomain("Steamed Buns")).toBeNull();
  });
});

describe("faviconUrl", () => {
  it("builds the Google favicon URL from the domain", () => {
    expect(faviconUrl("amazon.com")).toBe("https://www.google.com/s2/favicons?domain=amazon.com&sz=64");
    expect(faviconUrl("tesco.com", 128)).toBe("https://www.google.com/s2/favicons?domain=tesco.com&sz=128");
  });

  it("clamps the requested size", () => {
    expect(faviconUrl("amazon.com", 9999)).toContain("sz=256");
    expect(faviconUrl("amazon.com", 1)).toContain("sz=16");
  });
});
