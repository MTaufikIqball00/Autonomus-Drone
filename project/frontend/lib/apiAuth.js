import { NextResponse } from "next/server";

export function requireWriteKey(request) {
  const expected = process.env.API_WRITE_KEY;
  if (!expected) return null;

  const provided = request.headers.get("x-api-key");
  if (provided === expected) return null;

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
