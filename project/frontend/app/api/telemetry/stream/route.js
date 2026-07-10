import { query } from "@/lib/mysql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function numberParam(searchParams, key, fallback) {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

async function latestTelemetry(droneId) {
  const rows = await query(
    `
      SELECT
        id, drone_id, mission_id, recorded_at,
        x, y, z, altitude_m, speed_mps,
        yaw_rad, pitch_rad, roll_rad, heading_deg,
        flight_mode, nav_state
      FROM telemetry_logs
      WHERE drone_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `,
    [droneId],
  );
  return rows[0] || null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const droneId = numberParam(searchParams, "droneId", 1);
  const intervalMs = Math.max(500, Math.min(5000, numberParam(searchParams, "intervalMs", 1000)));

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      request.signal.addEventListener("abort", () => {
        closed = true;
        controller.close();
      });

      while (!closed) {
        try {
          const data = await latestTelemetry(droneId);
          controller.enqueue(encoder.encode(`event: telemetry\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
