import type { ChannelSeed } from "../db/repositories/channelRepository.js";

/**
 * Метаданные «канала №1» (таро @sofia_gada1ka) — данные обкаточного канала,
 * НЕ хардкод тематики в коде. Вся таро-специфика живёт здесь как настройки;
 * новый канал = новый такой конст, код не меняется.
 *
 * triggerWords (карта/кофе/руна) подхватит Шаг 2; campaignStart выставим на
 * Шаге 4 при запуске автопостинга.
 */
export const taroChannel: ChannelSeed = {
  title: "Таро · София",
  username: "sofia_gada1ka",
  niche: "эзотерика/таро",
  language: "ru",
  region: "RU",
  goal: "Вести подписчиц к продукту «30 дней с Таро» (воронка taro30)",
  toneOfVoice: "Тёплый, мистический, женственный, поддерживающий — без запугивания",
  timezone: "Europe/Moscow",
  triggerWords: ["карта", "кофе", "руна"],
  isActive: true,
  campaignStart: null,
};
