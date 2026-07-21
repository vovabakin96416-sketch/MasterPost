import type { Api } from "grammy";
import type { Logger } from "pino";
import type { PrismaClient } from "../db/client.js";
import { getOwnerIdByChannelId } from "../db/repositories/channelRepository.js";
import type { OwnerBotRegistry } from "./botRegistry.js";

/**
 * Маршрутизация «каким ботом писать» (Шаг 14b-bis-3).
 *
 * До этого шага весь исходящий трафик рантайма шёл ОДНИМ ботом из `BOT_TOKEN`:
 * подписчики клиента видели чужое имя и аватар. Теперь пост в канал и служебные
 * сообщения владельцу идут ботом ВЛАДЕЛЬЦА КАНАЛА, если он его подключил
 * (`channel → owner → registry.getApi`).
 *
 * 🔒 ГЛАВНОЕ СВОЙСТВО — ФОЛБЭК. Бот клиента может не суметь отправить: его забыли
 * добавить админом в канал, у него отобрали права, владелец не нажал ему /start
 * (403 на личку). Такой сбой НЕ должен стоить поста или уведомления, поэтому
 * каждая отправка при неудаче повторяется общим ботом. Пока публикация не
 * переехала окончательно, «пост ушёл не тем ботом» — меньшее зло, чем «пост
 * пропал».
 */

/** Зависимости, в которых маршрутизация умеет подменять адресата отправки. */
export interface RoutedDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  /** Бот, которым отправляем сейчас (после маршрутизации — бот владельца канала). */
  readonly api: Api;
  /** Общий бот: страховка, если основной не смог. `undefined` — страховать нечем. */
  readonly fallbackApi?: Api | undefined;
  /** Реестр ботов клиентов (14b-bis-2). `undefined` — мультибот не собран. */
  readonly ownerBots?: OwnerBotRegistry | undefined;
}

/**
 * Возвращает те же зависимости, но с ботом ВЛАДЕЛЬЦА канала в `api` и общим ботом
 * в `fallbackApi`. Всё, что вызывается дальше с этими зависимостями (публикация,
 * превью одобрения, уведомления), автоматически идёт нужным ботом.
 *
 * Никогда не бросает: не смогли определить владельца — оставляем как было. Сбой
 * маршрутизации не должен стоить публикации.
 */
export async function routeChannel<T extends RoutedDeps>(
  deps: T,
  channelId: string,
): Promise<T> {
  const registry = deps.ownerBots;
  if (registry === undefined) {
    return deps;
  }
  let ownerApi: Api | undefined;
  try {
    const ownerId = await getOwnerIdByChannelId(deps.prisma, channelId);
    ownerApi = ownerId === null ? undefined : registry.getApi(ownerId);
  } catch (err) {
    deps.logger.warn(
      { err, channelId },
      "не смог определить бота владельца канала — пишу как раньше",
    );
    return deps;
  }

  const api = ownerApi ?? deps.api;
  const mainApi = registry.getMainApi();
  // Страховка нужна только когда она — ДРУГОЙ бот: иначе повтор тем же ботом
  // просто удвоит одну и ту же ошибку (или, что хуже, задвоит сообщение).
  const fallbackApi = mainApi !== undefined && mainApi !== api ? mainApi : undefined;
  return { ...deps, api, fallbackApi };
}

/**
 * Выполняет отправку основным ботом, а при сбое повторяет общим.
 *
 * ⚠️ Повтор делаем на ЛЮБОЙ ошибке, а не только на 403: причин, по которым бот
 * клиента не может писать в канал, много (нет прав, кикнули, токен отозвали
 * между тиками), и разбирать их по кодам — способ однажды потерять пост на
 * неучтённом коде. Задвоения не будет: сюда попадают только сбойные отправки.
 */
export async function sendVia<T>(
  deps: Pick<RoutedDeps, "logger" | "api" | "fallbackApi">,
  action: (api: Api) => Promise<T>,
): Promise<T> {
  const { fallbackApi } = deps;
  if (fallbackApi === undefined) {
    return action(deps.api);
  }
  try {
    return await action(deps.api);
  } catch (err) {
    deps.logger.warn(
      { err },
      "бот владельца не смог отправить — повторяю общим ботом",
    );
    return action(fallbackApi);
  }
}
