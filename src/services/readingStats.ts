import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "modu.reading-stats.v1";
const MAX_DAYS = 366;
const MAX_SESSION_MS = 10 * 60 * 1000;

export type ReadingDay = {
  durationMs: number;
  pageTurns: number;
  bookIds: string[];
};

export type ReadingBookStat = {
  durationMs: number;
  pageTurns: number;
  lastReadAt: number;
};

export type ReadingStats = {
  version: 1;
  days: Record<string, ReadingDay>;
  books: Record<string, ReadingBookStat>;
};

export const emptyReadingStats: ReadingStats = {
  version: 1,
  days: {},
  books: {},
};

export type ReadingStatsSummary = {
  todayMs: number;
  weekMs: number;
  totalMs: number;
  streak: number;
  pagesTurned: number;
  week: Array<{ date: string; durationMs: number }>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function localDateKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStats(value: unknown): ReadingStats {
  if (!value || typeof value !== "object") return emptyReadingStats;
  const candidate = value as Partial<ReadingStats>;
  const days: ReadingStats["days"] = {};
  const books: ReadingStats["books"] = {};

  if (candidate.days && typeof candidate.days === "object") {
    Object.entries(candidate.days).forEach(([date, entry]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || typeof entry !== "object") return;
      const day = entry as Partial<ReadingDay>;
      days[date] = {
        durationMs: isFiniteNumber(day.durationMs) ? day.durationMs : 0,
        pageTurns: isFiniteNumber(day.pageTurns) ? Math.floor(day.pageTurns) : 0,
        bookIds: Array.isArray(day.bookIds)
          ? [...new Set(day.bookIds.filter((item): item is string => typeof item === "string"))].slice(0, 100)
          : [],
      };
    });
  }
  if (candidate.books && typeof candidate.books === "object") {
    Object.entries(candidate.books).forEach(([bookId, entry]) => {
      if (!bookId || !entry || typeof entry !== "object") return;
      const book = entry as Partial<ReadingBookStat>;
      books[bookId] = {
        durationMs: isFiniteNumber(book.durationMs) ? book.durationMs : 0,
        pageTurns: isFiniteNumber(book.pageTurns) ? Math.floor(book.pageTurns) : 0,
        lastReadAt: isFiniteNumber(book.lastReadAt) ? book.lastReadAt : 0,
      };
    });
  }
  return { version: 1, days, books };
}

export async function loadReadingStats() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalizeStats(JSON.parse(raw)) : emptyReadingStats;
  } catch {
    return emptyReadingStats;
  }
}

export async function saveReadingStats(stats: ReadingStats) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function addReadingSession(
  stats: ReadingStats,
  bookId: string,
  startedAt: number,
  endedAt: number,
  pageTurns: number,
): ReadingStats {
  const durationMs = Math.min(MAX_SESSION_MS, Math.max(0, endedAt - startedAt));
  if (!bookId || durationMs < 1000) return stats;
  const date = localDateKey(endedAt);
  const currentDay = stats.days[date] ?? { durationMs: 0, pageTurns: 0, bookIds: [] };
  const currentBook = stats.books[bookId] ?? { durationMs: 0, pageTurns: 0, lastReadAt: 0 };
  const days = {
    ...stats.days,
    [date]: {
      durationMs: currentDay.durationMs + durationMs,
      pageTurns: currentDay.pageTurns + Math.max(0, Math.floor(pageTurns)),
      bookIds: currentDay.bookIds.includes(bookId)
        ? currentDay.bookIds
        : [...currentDay.bookIds, bookId],
    },
  };
  const oldest = Object.keys(days).sort().slice(0, Math.max(0, Object.keys(days).length - MAX_DAYS));
  oldest.forEach((key) => delete days[key]);
  return {
    version: 1,
    days,
    books: {
      ...stats.books,
      [bookId]: {
        durationMs: currentBook.durationMs + durationMs,
        pageTurns: currentBook.pageTurns + Math.max(0, Math.floor(pageTurns)),
        lastReadAt: endedAt,
      },
    },
  };
}

export function summarizeReadingStats(stats: ReadingStats, now = new Date()): ReadingStatsSummary {
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    const key = localDateKey(date);
    return { date: key, durationMs: stats.days[key]?.durationMs ?? 0 };
  });
  let streak = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if ((stats.days[localDateKey(cursor)]?.durationMs ?? 0) < 60_000) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while ((stats.days[localDateKey(cursor)]?.durationMs ?? 0) >= 60_000) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    todayMs: week[6].durationMs,
    weekMs: week.reduce((sum, day) => sum + day.durationMs, 0),
    totalMs: Object.values(stats.books).reduce((sum, book) => sum + book.durationMs, 0),
    pagesTurned: Object.values(stats.books).reduce((sum, book) => sum + book.pageTurns, 0),
    streak,
    week,
  };
}
