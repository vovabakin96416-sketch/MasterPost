import type { ChannelSeed } from "../db/repositories/channelRepository.js";

/**
 * Метаданные «канала №1» (таро @sofia_gada1ka) — данные обкаточного канала,
 * НЕ хардкод тематики в коде. Вся таро-специфика живёт здесь как настройки;
 * новый канал = новый такой конст, код не меняется.
 *
 * triggerWords (карта/кофе/руна/знак/любовь/деньги/свет/да/нет) подхватит Шаг 2;
 * campaignStart выставим на Шаге 4 при запуске автопостинга. Слова «да»/«нет»
 * мапятся на общий пул «оракул» (см. triggerStage.ts).
 *
 * chatId — цель автопостинга (Шаг 4). СЕЙЧАС это тестовый канал @supertestmaster
 * (чтобы не дублировать публикации в живой @sofia_gada1ka, который ведёт Python-бот).
 * Для прода поменять на реальный канал — это данные, код не меняется.
 */
export const taroChannel: ChannelSeed = {
  title: "Таро · София",
  username: "sofia_gada1ka",
  chatId: "@supertestmaster",
  niche: "эзотерика/таро",
  language: "ru",
  region: "RU",
  goal: "Вести подписчиц к продукту «30 дней с Таро» (воронка taro30)",
  toneOfVoice: "Тёплый, мистический, женственный, поддерживающий — без запугивания",
  timezone: "Europe/Moscow",
  triggerWords: ["карта", "кофе", "руна", "знак", "любовь", "деньги", "свет", "да", "нет"],
  isActive: true,
  campaignStart: null,
};
