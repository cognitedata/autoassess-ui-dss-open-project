"""Build integration-week-walkthrough.html from deck.template.html.

Usage:  python3 build.py <images-dir>
The images dir must hold: overview.jpg, verify.jpg, inflight.jpg, landed.jpg, demo.jpg.
Regenerate the sequence SVGs first with `python3 seqdiag.py .` (they are inlined
into the template already; rerun the swap below if they changed).
Then print to PDF with `node deck-pdf.mjs <html> <pdf>` (headless Chrome).
"""

import base64
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent / "integration-week-walkthrough.html"
SANDBOX_URL = (
    "https://cog-autoassess.fusion.cognite.com/autoassess-dev/flows-apps/app/"
    "autoassess-drone-sandbox?cluster=westeurope-1.cognitedata.com&amp;"
    "customAppVersion=0.0.1&amp;workspace=flows"
)

IMAGES = {
    "__IMG_overview__": ("overview.jpg", "Drone Sandbox in Fusion after a simulated mission", "top left", "cover"),
    "__IMG_verify__": ("verify.jpg", "Verify example output: one Draft plan fails three checks", "top left", "contain"),
    "__IMG_inflight__": ("inflight.jpg", "Simulator mid-flight with task states", "top left", "cover"),
    "__IMG_landed__": ("landed.jpg", "Simulator after landing: plan simulated Complete", "top left", "cover"),
    "__IMG_demo__": ("demo.jpg", "Live demo: automatic upload status and the findings plan in the viewer", "top left", "cover"),
}

CODE_FLY = """<pre class="code small"><span class="k">from</span> dss_sandbox <span class="k">import</span> (SimDrone, pose_for_task,
                         BatteryLowError)

sim_drone = SimDrone(speed_mps=<span class="s">0.5</span>, max_flight_time_s=<span class="s">900</span>)
issues = sim_drone.load_plan(plan)    <span class="c"># pre-flight checks</span>

sim_drone.takeoff(height_m=<span class="s">1.0</span>)
<span class="k">for</span> task <span class="k">in</span> plan[<span class="s">"tasks"</span>]:        <span class="c"># you pick the order</span>
    <span class="c"># Pose(x, y, z, roll, pitch, yaw), map frame</span>
    pose = pose_for_task(task, standoff_m=<span class="s">0.8</span>,
                         approach_from=sim_drone.pose)
    <span class="k">try</span>:
        sim_drone.goto(pose)
        sim_drone.inspect(task[<span class="s">"id"</span>])
    <span class="k">except</span> BatteryLowError:
        <span class="k">break</span>
sim_drone.return_home()
sim_drone.land()
print(sim_drone.report().summary())</pre>"""

TABLE_API = """<table class="spec">
          <thead><tr><th>Call</th><th>On your drone</th><th>In the sandbox</th></tr></thead>
          <tbody>
            <tr><td><code>load_plan(plan)</code></td><td>Parse <code>plan.json</code>, run your own pre-flight checks</td><td>Checks pose, bounds, normals; returns issues</td></tr>
            <tr><td><code>takeoff(height_m)</code></td><td>Arm and climb</td><td>Climbs 1 m from the take-off point</td></tr>
            <tr><td><code>goto(Pose)</code></td><td>Fly to x, y, z in the map frame, hold roll/pitch/yaw</td><td>Straight line at constant speed; battery check</td></tr>
            <tr><td><code>inspect(task_id)</code></td><td>Capture images, take the UT reading, log the pose</td><td>Hover 3 s visual / 8 s NDT; task &rarr; inspected</td></tr>
            <tr><td><code>return_home()</code>, <code>land()</code></td><td>Return and land; write the mission folder</td><td>Flies home, lands, builds the report</td></tr>
            <tr><td><code>on_event(cb)</code>, <code>report()</code></td><td>Stream progress to the operator</td><td>Events, task panel, mission summary</td></tr>
            <tr><td><code>plans.update_status(&hellip;)</code></td><td>Done automatically by <code>autoassess_bridge</code> at mission end (campaign; the plan stays for the inspector)</td><td>Simulated; nothing written to CDF</td></tr>
          </tbody>
        </table>"""


def img_tag(path: Path, alt: str, pos: str, fit: str) -> str:
    data = base64.b64encode(path.read_bytes()).decode()
    return (
        f'<img alt="{alt}" style="object-fit:{fit};object-position:{pos}" '
        f'src="data:image/jpeg;base64,{data}">'
    )


def main() -> None:
    images_dir = Path(sys.argv[1])
    s = (HERE / "deck.template.html").read_text()
    for key, (name, alt, pos, fit) in IMAGES.items():
        s = s.replace(key, img_tag(images_dir / name, alt, pos, fit))
    s = s.replace("__CODE_fly__", CODE_FLY)
    s = s.replace("__TABLE_api__", TABLE_API)
    s = s.replace("__SANDBOX_URL__", SANDBOX_URL)
    n = s.count('<section class="slide')
    s = re.sub(r'id="count">\d+ / \d+<', f'id="count">1 / {n}<', s)
    leftovers = re.findall(r"__[A-Za-z_]+__", s)
    if leftovers:
        raise SystemExit(f"unfilled placeholders: {leftovers}")
    OUT.write_text(s)
    print(f"wrote {OUT} ({len(s)} bytes, {n} slides)")


if __name__ == "__main__":
    main()
