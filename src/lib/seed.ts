import { createCard, todayYmd, type CardInput } from "./cards";
import { createDrawer } from "./drawers";
import type { Db } from "./db";

export const STARTER_DRAWERS = ["Family", "Birthdays", "Anniversaries", "Work"] as const;

interface StarterCard extends CardInput {
  drawer: (typeof STARTER_DRAWERS)[number];
  balance: string;
}

const DAY_MS = 86400000;

function starterCards(now: number): StarterCard[] {
  const expiry = (days: number): string => todayYmd(now + days * DAY_MS);
  return [
    { drawer: "Family", retailer: "Whole Foods", balance: "42.18" },
    { drawer: "Family", retailer: "Shell", balance: "20.00", expiry: expiry(335) },
    { drawer: "Birthdays", retailer: "Bookshop", nickname: "For Maya", occasion: "birthday", balance: "25.00", expiry: expiry(90) },
    { drawer: "Birthdays", retailer: "Steam", nickname: "For Dev", balance: "50.00", expiry: expiry(20) },
    { drawer: "Anniversaries", retailer: "Airbnb", occasion: "anniversary", balance: "120.00", expiry: expiry(180) },
    { drawer: "Work", retailer: "Starbucks", nickname: "Kudos card", balance: "0.00" },
  ];
}

export async function seedStarterCabinet(db: Db, userId: string, now = Date.now()): Promise<void> {
  const ids = new Map<string, string>();
  for (const name of STARTER_DRAWERS) {
    const drawer = await createDrawer(db, userId, name, "");
    ids.set(name, drawer.id);
  }
  for (const { drawer, ...input } of starterCards(now)) {
    await createCard(db, userId, { ...input, drawer_id: ids.get(drawer) }, [], now, true);
  }
}
