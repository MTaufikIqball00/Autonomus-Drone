import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

export const runtime = "nodejs";

function numberParam(searchParams, key, fallback) {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const droneId = numberParam(searchParams, "droneId", 1);

  const [missionStatus, batteryUsage, recentErrors, obstacleSummary] = await Promise.all([
    // 1. Statistik status misi
    query(
      `
        SELECT status, COUNT(*) AS total
        FROM missions
        WHERE drone_id = ?
        GROUP BY status
      `,
      [droneId],
    ),
    // 2. Penggunaan baterai per misi
    query(
      `
        SELECT
          m.id AS mission_id,
          m.flight_mode AS mode,
          m.status,
          MIN(bl.battery_percent) AS min_battery_percent,
          MAX(bl.battery_percent) AS max_battery_percent,
          MAX(bl.battery_percent) - MIN(bl.battery_percent) AS battery_used_percent,
          AVG(bl.voltage_v) AS avg_voltage_v,
          AVG(bl.current_a) AS avg_current_a
        FROM missions m
        JOIN battery_logs bl ON bl.mission_id = m.id
        WHERE m.drone_id = ?
        GROUP BY m.id, m.flight_mode, m.status
        ORDER BY m.start_time DESC
        LIMIT 20
      `,
      [droneId],
    ),
    // 3. Error logs terbaru
    query(
      `
        SELECT occurred_at, severity, subsystem, event_type, message
        FROM error_logs
        WHERE drone_id = ?
        ORDER BY occurred_at DESC
        LIMIT 20
      `,
      [droneId],
    ),
    // 4. Ringkasan obstacle
    query(
      `
        SELECT obstacle_type, source, COUNT(*) AS total
        FROM obstacle_logs
        WHERE drone_id = ?
        GROUP BY obstacle_type, source
        ORDER BY total DESC
      `,
      [droneId],
    ),
  ]);

  return NextResponse.json({
    missionStatus,
    batteryUsage,
    manualVsAuto: [],
    recentErrors,
    obstacleSummary,
  });
}
