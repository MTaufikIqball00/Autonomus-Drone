"use client";

import ControlPanel from "@/components/ControlPanel";
import MapView from "@/components/MapView";
import MetricsChart from "@/components/MetricsChart";
import StatusBar from "@/components/StatusBar";
import { useRos } from "@/lib/useRos";

export default function DashboardPage() {
  const ros = useRos();

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Robotics Ecosystem Network Architecture</p>
          <h1>UAV Operations Center</h1>
        </div>
        <StatusBar connected={ros.connected} url={ros.url} error={ros.error} />
      </section>

      <section className="dashboard-grid">
        <ControlPanel
          connected={ros.connected}
          odom={ros.odom}
          goal={ros.goal}
          state={ros.dashboardState}
          callService={ros.callTriggerService}
          publishVelocity={ros.publishVelocity}
          publishGoal={ros.publishGoal}
          clearTrail={ros.clearTrail}
          sensorScan={ros.sensorScan}
        />
        <MapView
          connected={ros.connected}
          odomRef={ros.odomRef}
          yawRef={ros.yawRef}
          trail={ros.trail}
          goal={ros.goal}
          pathDraft={ros.pathDraft}
          plannedPath={ros.plannedPath}
          pathsJsonRef={ros.pathsJsonRef}
          obstaclesRef={ros.obstaclesRef}
          sensorScan={ros.sensorScan}
          setPathDraft={ros.setPathDraft}
          setGoal={ros.setGoal}
          publishGoal={ros.publishGoal}
        />
      </section>
      <MetricsChart metrics={ros.metrics} />
    </main>
  );
}
