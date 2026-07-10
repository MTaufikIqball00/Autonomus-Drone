import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireWriteKey } from "@/lib/apiAuth";
import { query, transaction } from "@/lib/mysql";

export const runtime = "nodejs";

function numberParam(searchParams, key, fallback) {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const droneId = numberParam(searchParams, "droneId", 1);
  const limit = Math.max(1, Math.min(500, numberParam(searchParams, "limit", 50)));

  const rows = await query(
    `
      SELECT
        id, drone_id, flight_mode AS mode, status,
        start_x, start_y, dest_x, dest_y,
        start_time, end_time, total_distance_m, battery_used_percent
      FROM missions
      WHERE drone_id = ?
      ORDER BY start_time DESC
      LIMIT ${limit}
    `,
    [droneId],
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request) {
  const authError = requireWriteKey(request);
  if (authError) return authError;

  const body = await request.json();
  const droneId = Number(body.droneId || body.drone_id || 1);
  const mode = body.mode || "auto";
  const status = body.status || "in_progress";

  // Convert ISO string (e.g. 2026-06-20T08:00:31.862Z) to MySQL format (2026-06-20 08:00:31)
  const formatSqlDate = (dateStr) => {
    if (!dateStr) return null;
    try { return new Date(dateStr).toISOString().slice(0, 19).replace('T', ' '); } 
    catch (e) { return null; }
  };

  const result = await query(
    `
      INSERT INTO missions (
        drone_id, operator_id, flight_mode, status,
        start_x, start_y, dest_x, dest_y,
        start_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      droneId,
      body.operatorId || body.operator_id || 1,
      mode,
      status,
      body.start?.x ?? body.start_x ?? null,
      body.start?.y ?? body.start_y ?? null,
      body.target?.x ?? body.target_x ?? body.dest_x ?? null,
      body.target?.y ?? body.target_y ?? body.dest_y ?? null,
      formatSqlDate(body.startedAt || body.started_at) || new Date().toISOString().slice(0, 19).replace('T', ' '),
    ],
  );

  return NextResponse.json({ id: result.insertId }, { status: 201 });
}

export async function PATCH(request) {
  const authError = requireWriteKey(request);
  if (authError) return authError;

  const body = await request.json();
  const missionId = Number(body.id || body.missionId || body.mission_id);
  if (!missionId) {
    return NextResponse.json({ error: "mission id is required" }, { status: 400 });
  }

  // Convert ISO string to MySQL format
  const formatSqlDate = (dateStr) => {
    if (!dateStr) return null;
    try { return new Date(dateStr).toISOString().slice(0, 19).replace('T', ' '); }
    catch (e) { return null; }
  };

  await query(
    `
      UPDATE missions
      SET
        status = COALESCE(?, status),
        end_time = COALESCE(?, end_time),
        total_distance_m = COALESCE(?, total_distance_m),
        battery_used_percent = COALESCE(?, battery_used_percent)
      WHERE id = ?
    `,
    [
      body.status || null,
      formatSqlDate(body.endedAt || body.ended_at || body.end_time) || null,
      body.distanceM ?? body.distance_m ?? body.total_distance_m ?? null,
      body.batteryUsedPercent ?? body.battery_used_percent ?? null,
      missionId,
    ],
  );

  return NextResponse.json({ ok: true });
}
