import { describe, expect, it } from "vitest";

import {
  dailyCronFromLocalTime,
  getNewArchNews,
  isNearLocalTime,
} from "../server/agent-tasks";
import type { ArchNewsItem } from "../server/arch-news";

const item = (key: string, publishedAt = "2026-11-09T12:00:00Z"): ArchNewsItem => ({
  key,
  title: key,
  url: `https://archlinux.org/news/${key}/`,
  publishedAt,
});

describe("getNewArchNews", () => {
  it("returns all entries since the last check in chronological order", () => {
    const items = [item("newest"), item("middle"), item("previous"), item("older")];
    expect(getNewArchNews("previous", items).map((entry) => entry.key)).toEqual(["middle", "newest"]);
  });

  it("returns no entries when the newest item was already seen", () => {
    expect(getNewArchNews("newest", [item("newest"), item("older")])).toEqual([]);
  });

  it("recovers every available new entry by publication date when the cursor rolled out of the feed", () => {
    const items = [
      item("newest", "2026-11-09T14:00:00Z"),
      item("middle", "2026-11-09T13:00:00Z"),
      item("old", "2026-11-09T10:00:00Z"),
    ];
    expect(getNewArchNews("not-in-feed", items, new Date("2026-11-09T12:00:00Z")).map((entry) => entry.key)).toEqual([
      "middle",
      "newest",
    ]);
  });

  it("does not treat old feed entries as new on a first run after feed initialization failed", () => {
    expect(getNewArchNews(null, [item("old", "2026-11-08T10:00:00Z")], new Date("2026-11-09T11:00:00Z"))).toEqual([]);
  });
});

describe("daily local-time scheduling", () => {
  it("uses one UTC time for UTC and both seasonal candidates for a DST zone", () => {
    expect(dailyCronFromLocalTime("09:30", "UTC")).toBe("0 30 9 * * *");
    expect(dailyCronFromLocalTime("09:00", "America/New_York")).toBe("0 0 13,14 * * *");
  });

  it("runs only at the requested local minute and skips the other seasonal cron candidate", () => {
    expect(isNearLocalTime(new Date("2026-07-15T13:00:00Z"), "09:00", "America/New_York")).toBe(true);
    expect(isNearLocalTime(new Date("2026-07-15T14:00:00Z"), "09:00", "America/New_York")).toBe(false);
    expect(isNearLocalTime(new Date("2026-07-15T13:04:00Z"), "09:00", "America/New_York")).toBe(true);
  });
});
