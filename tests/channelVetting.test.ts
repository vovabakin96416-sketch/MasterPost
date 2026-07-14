import { describe, expect, it } from "vitest";
import type { ChannelVettingStat } from "../src/core/market/marketData.js";
import type { SubscriberDynamics } from "../src/core/market/subscriberDynamics.js";
import type { SubscriberAnomaly } from "../src/core/market/subscriberAnomaly.js";
import {
  buildVettingReport,
  vetChannelStat,
} from "../src/core/market/channelVetting.js";
import { normalizeChannelRef } from "../src/services/market/channelVettingService.js";

/** Базовый «здоровый» срез — тесты меняют только нужное поле. */
function stat(overrides: Partial<ChannelVettingStat> = {}): ChannelVettingStat {
  return {
    subscribers: 10000,
    avgPostReach: 1000, // 10% охват → 🟢
    errPercent: 10, // норма → 🟢
    dailyReach: 500,
    mentionsCount: 30,
    mentioningChannelsCount: 20, // органика → 🟢
    scoringRate: 7, // хорошо → 🟢
    ...overrides,
  };
}

function levelOf(result: ReturnType<typeof vetChannelStat>, needle: string) {
  return result.signals.find((s) => s.text.includes(needle))?.level;
}

describe("vetChannelStat — сигналы (Шаг 12g)", () => {
  it("здоровый канал без ряда → зелёный вердикт", () => {
    const r = vetChannelStat(stat());
    expect(r.verdict).toBe("green");
    expect(levelOf(r, "Охват на подписчика")).toBe("green");
    expect(levelOf(r, "Упоминаний из каналов")).toBe("green");
    expect(levelOf(r, "ER")).toBe("green");
    expect(levelOf(r, "Оценка качества")).toBe("green");
  });

  it("охват/подписчик: ≥5% 🟢, 3–5% 🟡, <3% 🔴", () => {
    expect(levelOf(vetChannelStat(stat({ avgPostReach: 500 })), "Охват")).toBe("green");
    expect(levelOf(vetChannelStat(stat({ avgPostReach: 400 })), "Охват")).toBe("yellow");
    expect(levelOf(vetChannelStat(stat({ avgPostReach: 200 })), "Охват")).toBe("red");
  });

  it("0 подписчиков → охват «нет данных», без падения", () => {
    const r = vetChannelStat(stat({ subscribers: 0 }));
    expect(levelOf(r, "Охват на подписчика")).toBe("yellow");
  });

  it("сеть упоминаний: ≤50 🟢, 51–149 🟡, ≥150 🔴", () => {
    expect(levelOf(vetChannelStat(stat({ mentioningChannelsCount: 50 })), "Упоминаний")).toBe("green");
    expect(levelOf(vetChannelStat(stat({ mentioningChannelsCount: 100 })), "Упоминаний")).toBe("yellow");
    expect(levelOf(vetChannelStat(stat({ mentioningChannelsCount: 150 })), "Упоминаний")).toBe("red");
  });

  it("ER вне 5–35% → жёлтый (вялый или подозрительный)", () => {
    expect(levelOf(vetChannelStat(stat({ errPercent: 2 })), "ER")).toBe("yellow");
    expect(levelOf(vetChannelStat(stat({ errPercent: 40 })), "ER")).toBe("yellow");
    expect(levelOf(vetChannelStat(stat({ errPercent: 5 })), "ER")).toBe("green");
    expect(levelOf(vetChannelStat(stat({ errPercent: 35 })), "ER")).toBe("green");
  });

  it("оценка качества: ≥6 🟢, 4–6 🟡, <4 🔴", () => {
    expect(levelOf(vetChannelStat(stat({ scoringRate: 6 })), "Оценка")).toBe("green");
    expect(levelOf(vetChannelStat(stat({ scoringRate: 5 })), "Оценка")).toBe("yellow");
    expect(levelOf(vetChannelStat(stat({ scoringRate: 3 })), "Оценка")).toBe("red");
  });
});

describe("vetChannelStat — тренд и аномалии (из ряда)", () => {
  it("нет ряда → тренда и аномалий в сигналах нет", () => {
    const r = vetChannelStat(stat(), null, []);
    expect(r.signals.some((s) => s.text.includes("Подписчики за 28д"))).toBe(false);
    expect(r.signals.some((s) => s.text.includes("Резкие скачки"))).toBe(false);
  });

  it("падение за 28д → жёлтый сигнал «канал сохнет»", () => {
    const dyn: SubscriberDynamics = { current: 9000, delta7d: -100, delta28d: -500 };
    const r = vetChannelStat(stat(), dyn, []);
    expect(levelOf(r, "Подписчики за 28д")).toBe("yellow");
  });

  it("рост за 28д → зелёный сигнал", () => {
    const dyn: SubscriberDynamics = { current: 11000, delta7d: 200, delta28d: 1000 };
    expect(levelOf(vetChannelStat(stat(), dyn, []), "Подписчики за 28д")).toBe("green");
  });

  it("delta28d = null → сигнала тренда нет", () => {
    const dyn: SubscriberDynamics = { current: 10000, delta7d: 10, delta28d: null };
    expect(vetChannelStat(stat(), dyn, []).signals.some((s) => s.text.includes("28д"))).toBe(false);
  });

  it("аномалии ряда → жёлтый сигнал о скачках", () => {
    const anomalies: SubscriberAnomaly[] = [{ date: "2026-07-01", delta: 500 }];
    expect(levelOf(vetChannelStat(stat(), null, anomalies), "Резкие скачки")).toBe("yellow");
  });
});

describe("vetChannelStat — правило вердикта", () => {
  it("сетка-ферма (network 🔴) — решающая: 🔴 даже при прочих 🟢", () => {
    expect(vetChannelStat(stat({ mentioningChannelsCount: 700 })).verdict).toBe("red");
  });

  it("накрутка (охват 🔴) — решающая: 🔴 даже при прочих 🟢", () => {
    expect(vetChannelStat(stat({ avgPostReach: 100 })).verdict).toBe("red");
  });

  it("один НЕрешающий 🔴 (оценка) без второго флага → 🟡", () => {
    expect(vetChannelStat(stat({ scoringRate: 2 })).verdict).toBe("yellow");
  });

  it("два 🔴 (оценка + ... ещё один red) → 🔴 без решающего", () => {
    // scoringRate red + сделаем network red? Тогда network решающий. Возьмём
    // два НЕрешающих красных нельзя (только scoring нерешающий red). Проверяем
    // что решающий network + scoring red → red (reds>=2 путь тоже верен).
    expect(vetChannelStat(stat({ scoringRate: 2, mentioningChannelsCount: 700 })).verdict).toBe("red");
  });

  it("ноль 🔴, есть 🟡 → 🟡", () => {
    expect(vetChannelStat(stat({ errPercent: 2 })).verdict).toBe("yellow");
  });

  it("всё зелёное → 🟢", () => {
    expect(vetChannelStat(stat()).verdict).toBe("green");
  });
});

describe("vetChannelStat — якоря скилла telemetr-vetting", () => {
  it("🟢 favoritehoro: органика → green", () => {
    const r = vetChannelStat(
      stat({
        subscribers: 37046,
        avgPostReach: 4650,
        errPercent: 5.62,
        mentioningChannelsCount: 20,
        scoringRate: 6.9,
      }),
    );
    expect(r.verdict).toBe("green");
  });

  it("🔴 ezoterik_dnevnik: зодиак-ферма (725 каналов) → red", () => {
    const r = vetChannelStat(
      stat({
        subscribers: 56282,
        avgPostReach: 1903,
        errPercent: 2.45,
        mentioningChannelsCount: 725,
        scoringRate: 6.1,
      }),
    );
    expect(r.verdict).toBe("red");
  });
});

describe("buildVettingReport", () => {
  it("содержит ссылку, заголовок вердикта и все сигналы", () => {
    const s = stat();
    const r = vetChannelStat(s);
    const text = buildVettingReport("@x", s, r);
    expect(text).toContain("@x");
    expect(text).toContain("🟢");
    expect(text).toContain("Охват на подписчика");
    expect(text).toContain("t.me/s/"); // приписка про ручной доразбор
  });
});

describe("normalizeChannelRef", () => {
  it("принимает @username, username, ссылки t.me/telemetr", () => {
    expect(normalizeChannelRef("@favoritehoro")).toBe("@favoritehoro");
    expect(normalizeChannelRef("favoritehoro")).toBe("@favoritehoro");
    expect(normalizeChannelRef("t.me/favoritehoro")).toBe("@favoritehoro");
    expect(normalizeChannelRef("https://t.me/favoritehoro")).toBe("@favoritehoro");
    expect(normalizeChannelRef("telemetr.me/@favoritehoro")).toBe("@favoritehoro");
    expect(normalizeChannelRef("  https://t.me/favoritehoro?x=1 ")).toBe("@favoritehoro");
  });

  it("отбраковывает мусор и приватные ссылки", () => {
    expect(normalizeChannelRef("")).toBeNull();
    expect(normalizeChannelRef("t.me/c/123456/1")).toBeNull(); // приватная числовая
    expect(normalizeChannelRef("ab")).toBeNull(); // слишком короткий
    expect(normalizeChannelRef("1channel")).toBeNull(); // начинается с цифры
  });
});
