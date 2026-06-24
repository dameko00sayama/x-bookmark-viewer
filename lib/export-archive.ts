import packageJson from "@/package.json";
import { getBookmarkExportData } from "./db";

function tweetUrl(tweet: { id: string; author: { username: string } | null }) {
  return tweet.author?.username
    ? `https://x.com/${tweet.author.username}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(bookmarks: ReturnType<typeof getBookmarkExportData>) {
  const headers = [
    "tweet_id",
    "source_url",
    "bookmarked",
    "text",
    "author_id",
    "author_name",
    "author_username",
    "created_at",
    "note",
    "note_updated_at",
    "tags",
    "bookmark_accounts",
    "unbookmarked_at",
    "media_urls",
    "media_alt_texts",
    "quoted_tweet_id",
    "quoted_tweet_text",
    "cached_at",
    "updated_at"
  ];

  const lines = bookmarks.map((bookmark) => {
    const unbookmarkedAt = bookmark.accounts
      .map((account) => account.unbookmarkedAt)
      .filter((value): value is string => Boolean(value))
      .join(" | ");
    const accountStates = bookmark.accounts
      .map((account) => {
        const identity = account.username ? `@${account.username}` : account.userId;
        return `${identity}:${account.bookmarked ? "bookmarked" : "unbookmarked"}`;
      })
      .join(" | ");

    return [
      bookmark.id,
      tweetUrl(bookmark),
      bookmark.bookmarked,
      bookmark.text,
      bookmark.author?.id,
      bookmark.author?.name,
      bookmark.author?.username,
      bookmark.createdAt,
      bookmark.note,
      bookmark.noteUpdatedAt,
      bookmark.tags.map((tag) => tag.name).join(" | "),
      accountStates,
      unbookmarkedAt,
      bookmark.media.map((media) => media.videoUrl ?? media.url).join(" | "),
      bookmark.media.map((media) => media.altText ?? "").join(" | "),
      bookmark.quotedTweet?.id,
      bookmark.quotedTweet?.text,
      bookmark.cachedAt,
      bookmark.updatedAt
    ]
      .map(csvCell)
      .join(",");
  });

  return `\uFEFF${[headers.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function zipArchive(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localChunks.push(localHeader, content);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, content.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralChunks.push(centralHeader);
    localOffset += localHeader.length + content.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);

  return concatBytes([...localChunks, centralDirectory, end]);
}

export function createBookmarkExportArchive() {
  const bookmarks = getBookmarkExportData().map((bookmark) => ({
    ...bookmark,
    sourceUrl: tweetUrl(bookmark)
  }));
  const exportedAt = new Date().toISOString();
  const json = JSON.stringify(
    {
      format: "x-bookmark-viewer-export",
      version: packageJson.version,
      exportedAt,
      includesUnbookmarked: true,
      bookmarkCount: bookmarks.length,
      bookmarks
    },
    null,
    2
  );
  const csv = createCsv(bookmarks);

  return {
    bytes: zipArchive([
      { name: "bookmarks.json", content: json },
      { name: "bookmarks.csv", content: csv }
    ]),
    bookmarkCount: bookmarks.length,
    exportedAt
  };
}
