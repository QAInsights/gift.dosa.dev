import { createCard, todayYmd, updateCard, type CardInput } from "./cards";
import {
  deleteUserCards,
  deleteUserDrawers,
  deleteUserRedemptions,
  deleteUserReminders,
  deleteUserTodos,
  type Db,
} from "./db";
import { createDrawer, setDrawerEmoji } from "./drawers";
import { updateProfile } from "./prefs";
import { recordRedemption } from "./redemptions";
import { setCardReminder } from "./reminders";
import { addTodo, setTodoDone } from "./todos";
import { setVault } from "./vault";

export const DEMO_EMAIL = "demo@gift.dosa.dev";
export const DEMO_NAME = "Diya";
export const DEMO_DRAWER_PASSWORD = "cabinet-demo";

const DAY_MS = 86400000;

export async function resetCabinet(db: Db, userId: string): Promise<void> {
  await deleteUserRedemptions(db, userId);
  await deleteUserReminders(db, userId);
  await deleteUserTodos(db, userId);
  await deleteUserCards(db, userId);
  await deleteUserDrawers(db, userId);
}

export async function seedDemoCabinet(
  db: Db,
  userId: string,
  now = Date.now(),
  key: string | null = null,
): Promise<{ sealedDrawerId: string }> {
  await resetCabinet(db, userId);
  await updateProfile(db, userId, {
    name: DEMO_NAME,
    region: "US",
    currency: "USD",
    date_format: "MDY",
  });

  const expiry = (days: number): string => todayYmd(now + days * DAY_MS);
  const ids = new Map<string, string>();
  for (const [name, emoji] of [
    ["Everyday", "🍽️"],
    ["Birthdays", "🎂"],
    ["Travel", "✈️"],
    ["Keepsakes", "🎁"],
    ["Family", "🏠"],
  ] as const) {
    const drawer = await createDrawer(db, userId, name, name === "Family" ? DEMO_DRAWER_PASSWORD : "", now);
    await setDrawerEmoji(db, userId, drawer.id, emoji, now);
    ids.set(name, drawer.id);
  }
  const sealedDrawerId = ids.get("Family") ?? "";
  const sealed = [sealedDrawerId];

  interface DemoCard extends CardInput {
    drawer: string;
    balance: string;
    reminderDays?: number;
  }

  const cards: DemoCard[] = [
    { drawer: "Everyday", retailer: "Whole Foods", balance: "42.18" },
    { drawer: "Everyday", retailer: "Starbucks", nickname: "Kudos card", balance: "12.00", tags: "coffee" },
    { drawer: "Everyday", retailer: "Target", balance: "25.00", expiry: expiry(23), reminderDays: 7 },
    { drawer: "Everyday", retailer: "Shell", balance: "20.00", expiry: expiry(300), reminderDays: 30 },
    { drawer: "Birthdays", retailer: "Bookshop", nickname: "For Maya", occasion: "Birthday", balance: "25.00", expiry: expiry(75), tags: "books", reminderDays: 14 },
    { drawer: "Birthdays", retailer: "Steam", nickname: "For Dev", occasion: "Birthday", balance: "50.00", expiry: expiry(12), reminderDays: 7 },
    { drawer: "Travel", retailer: "Airbnb", occasion: "Anniversary", balance: "120.00", expiry: expiry(180), notes: "Weekend in Asheville, October.", reminderDays: 30 },
    { drawer: "Travel", retailer: "Delta", balance: "150.00" },
    { drawer: "Keepsakes", retailer: "Local Coffee Roasters", balance: "15.00", notes: "First gift from Arjun. Keep." },
    { drawer: "Keepsakes", retailer: "Apple", occasion: "Graduation", balance: "100.00", tags: "tech" },
    { drawer: "Family", retailer: "Amazon", last4: "4402", balance: "60.00" },
    { drawer: "Family", retailer: "Walmart", balance: "35.00", expiry: expiry(45), reminderDays: 14 },
  ];

  for (const { drawer, reminderDays, ...input } of cards) {
    const sealedCard = drawer === "Family";
    const card = await createCard(db, userId, { ...input, drawer_id: ids.get(drawer) }, sealedCard ? sealed : [], now);
    if (reminderDays !== undefined) await setCardReminder(db, userId, card.id, reminderDays, now);
    if (card.retailer === "Starbucks") {
      await recordRedemption(db, userId, card.id, [], { mode: "spent", amount: "4.65" }, now);
    }
    if (card.retailer === "Local Coffee Roasters") {
      await recordRedemption(db, userId, card.id, [], { mode: "remaining", amount: "0.00" }, now);
      await updateCard(db, userId, card.id, [], { is_memory: true }, now);
    }
    if (card.retailer === "Amazon") {
      await setVault(db, userId, card.id, sealed, { number: "6006491234567890", pin: "1234" }, key, now);
    }
  }

  for (const [text, done] of [
    ["Use the Steam card before Dev's birthday on the 14th", false],
    ["Ask Maya which Bookshop branch is near her", false],
    ["Check Target card balance at the register", true],
  ] as const) {
    const todo = await addTodo(db, userId, text, now);
    if (done) await setTodoDone(db, userId, todo.id, true, now);
  }

  return { sealedDrawerId };
}
