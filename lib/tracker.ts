import { z } from "zod";

export const WEEK_RANGES = [
  "12–18 октября 2026",
  "19–25 октября 2026",
  "26 октября – 1 ноября 2026",
  "2–8 ноября 2026",
  "9–15 ноября 2026",
  "16–22 ноября 2026",
  "23–29 ноября 2026",
  "30 ноября – 6 декабря 2026",
  "7–13 декабря 2026",
  "14–20 декабря 2026",
  "21–27 декабря 2026",
  "28 декабря 2026 – 3 января 2027",
  "4–9 января 2027 · финал",
] as const;

export const TASKS = [
  "Выпустить основное авторское видео",
  "Опубликовать посты в Telegram",
  "Проверить аналитику YouTube и Telegram",
  "Записать одно узкое место и изменение",
  "Подготовить следующий сценарий с источниками",
  "Продвинуть дополнительные проекты",
  "Подвести итоги недели",
] as const;

export const FIELD_KEYS = [
  "goal",
  "hoursAvailable",
  "hoursActual",
  "mainResult",
  "worked",
  "notWorked",
  "improve",
  "nextPriority",
  "videoUrl",
  "videosPublished",
  "views48",
  "views7",
  "views28",
  "ytStart",
  "ytEnd",
  "ctr",
  "ctrSurface",
  "avgView",
  "retention30",
  "traffic",
  "tgStart",
  "tgEnd",
  "tgPosts",
  "tgUrls",
  "tgViews48",
  "tgReactions",
  "ytToTg",
  "tasksPlan",
  "tasksFact",
  "hoursYt",
  "hoursTg",
  "hoursTech",
  "hoursSk",
  "otherUrls",
  "income",
  "incomeProof",
  "expenses",
  "hypothesis",
  "change",
  "constant",
  "measure",
  "expResult",
  "decision",
  "studioProof",
  "notes",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];
export type WeekData = { fields: Record<FieldKey, string>; checks: boolean[] };
export type TrackerData = {
  version: 1;
  baseline: {
    youtubeSubscribers: string;
    youtubeViews28: string;
    telegramSubscribers: string;
    availableHours: string;
    lastVideoDate: string;
  };
  weeks: WeekData[];
};

const weekSchema = z.object({
  fields: z.record(z.string(), z.string()),
  checks: z.array(z.boolean()),
});
const backupSchema = z.object({
  version: z.literal(1),
  baseline: z
    .object({
      youtubeSubscribers: z.string(),
      youtubeViews28: z.string(),
      telegramSubscribers: z.string(),
      availableHours: z.string(),
      lastVideoDate: z.string(),
    })
    .optional(),
  weeks: z.array(weekSchema).length(WEEK_RANGES.length),
});

export function createTracker(): TrackerData {
  return {
    version: 1,
    baseline: {
      youtubeSubscribers: "",
      youtubeViews28: "",
      telegramSubscribers: "",
      availableHours: "",
      lastVideoDate: "",
    },
    weeks: WEEK_RANGES.map(() => ({
      fields: Object.fromEntries(FIELD_KEYS.map((key) => [key, ""])) as Record<FieldKey, string>,
      checks: TASKS.map(() => false),
    })),
  };
}

export function parseTracker(value: unknown): TrackerData | null {
  const result = backupSchema.safeParse(value);
  if (!result.success) return null;
  const empty = createTracker();
  return {
    version: 1,
    baseline: { ...empty.baseline, ...result.data.baseline },
    weeks: result.data.weeks.map((week) => ({
      fields: Object.fromEntries(FIELD_KEYS.map((key) => [key, week.fields[key] ?? ""])) as Record<
        FieldKey,
        string
      >,
      checks: TASKS.map((_, taskIndex) => week.checks[taskIndex] ?? false),
    })),
  };
}

export function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function difference(start: string, end: string): number | null {
  const a = numberOrNull(start);
  const b = numberOrNull(end);
  return a === null || b === null ? null : b - a;
}

export function sumField(data: TrackerData, key: FieldKey): number {
  return data.weeks.reduce((sum, week) => sum + (numberOrNull(week.fields[key]) ?? 0), 0);
}

export function formatNumber(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("ru-RU").format(value);
}

export function formatSigned(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

export function toCsv(data: TrackerData): string {
  const rows: (string | number)[][] = [
    [
      "Неделя",
      "Период",
      "Главная цель",
      "Видео",
      "Просмотры 7д",
      "YouTube Δ",
      "Telegram Δ",
      "Переходы YT→TG",
      "Задачи факт",
      "Часы факт",
    ],
  ];
  data.weeks.forEach((week, index) => {
    const f = week.fields;
    rows.push([
      index === 12 ? "Финал" : index + 1,
      WEEK_RANGES[index],
      f.goal,
      f.videosPublished,
      f.views7,
      difference(f.ytStart, f.ytEnd) ?? "",
      difference(f.tgStart, f.tgEnd) ?? "",
      f.ytToTg,
      f.tasksFact,
      f.hoursActual,
    ]);
  });
  return (
    "\ufeff" +
    rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\r\n")
  );
}
