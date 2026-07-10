import { NextResponse } from "next/server";
import { requireWriteKey } from "@/lib/apiAuth";
import { query } from "@/lib/mysql";

export const runtime = "nodejs";

function numberParam(searchParams, key, fallback) {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const droneId = numberParam(searchParams, "droneId", 1);
  const missionId = numberParam(searchParams, "missionId", null);
  const limit = Math.max(1, Math.min(5000, numberParam(searchParams, "limit", 300)));
  const latest = searchParams.get("latest") === "1";

  const filters = ["drone_id = ?"];
  const params = [droneId];

  if (missionId) {
    filters.push("mission_id = ?");
    params.push(missionId);
  }

  if (searchParams.get("from")) {
    filters.push("recorded_at >= ?");
    params.push(searchParams.get("from"));
  }

  if (searchParams.get("to")) {
    filters.push("recorded_at <= ?");
    params.push(searchParams.get("to"));
  }

  const sql = `
    SELECT
      id, drone_id, mission_id, recorded_at,
      x, y, z, latitude, longitude, altitude_m,
      velocity_x, velocity_y, velocity_z, speed_mps,
      yaw_rad, pitch_rad, roll_rad, heading_deg,
      flight_mode, nav_state
    FROM telemetry_logs
    WHERE ${filters.join(" AND ")}
    ORDER BY recorded_at DESC
    LIMIT ${latest ? 1 : limit}
  `;

  const rows = await query(sql, params);
  return NextResponse.json({ data: latest ? rows[0] || null : rows.reverse() });
}

export async function POST(request) {
  const authError = requireWriteKey(request);
  if (authError) return authError;

  const body = await request.json();
  const droneId = Number(body.droneId || body.drone_id || 1);
  const missionId = body.missionId || body.mission_id || null;
  const recordedAt = body.recordedAt || body.recorded_at || new Date().toISOString();

  await query(
    `
      INSERT INTO telemetry_logs (
        drone_id, mission_id, recorded_at,
        x, y, z, latitude, longitude, altitude_m,
        velocity_x, velocity_y, velocity_z, speed_mps,
        yaw_rad, pitch_rad, roll_rad, heading_deg,
        flight_mode, nav_state, source, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'next_api', ?)
    `,
    [
      droneId,
      missionId,
      recordedAt,
      body.x ?? null,
      body.y ?? null,
      body.z ?? null,
      body.latitude ?? null,
      body.longitude ?? null,
      body.altitudeM ?? body.altitude_m ?? body.z ?? null,
      body.velocityX ?? body.velocity_x ?? null,
      body.velocityY ?? body.velocity_y ?? null,
      body.velocityZ ?? body.velocity_z ?? null,
      body.speedMps ?? body.speed_mps ?? null,
      body.yawRad ?? body.yaw_rad ?? null,
      body.pitchRad ?? body.pitch_rad ?? null,
      body.rollRad ?? body.roll_rad ?? null,
      body.headingDeg ?? body.heading_deg ?? null,
      body.flightMode ?? body.flight_mode ?? null,
      body.navState ?? body.nav_state ?? null,
      JSON.stringify(body),
    ],
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
