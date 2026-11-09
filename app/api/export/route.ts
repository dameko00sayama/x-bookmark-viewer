import { NextResponse } from "next/server";
import { createBookmarkExportArchive } from "@/lib/export-archive";
import { getAppSessionUser, isSameOriginRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getAppSessionUser()) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const archive = createBookmarkExportArchive();
  const date = archive.exportedAt.slice(0, 10);

  return new Response(archive.bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="x-bookmarks-${date}.zip"`,
      "Cache-Control": "no-store",
      "X-Bookmark-Count": String(archive.bookmarkCount)
    }
  });
}
