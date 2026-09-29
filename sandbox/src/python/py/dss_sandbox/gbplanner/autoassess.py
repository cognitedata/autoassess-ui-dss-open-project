"""Simulated autoassess_bridge: the ROS node that connects gbplanner to AutoAssess (CDF).

The real node (`autoassess_bridge`, ROS 1) follows the area's Active plan in CDF — or, when no
plan is Active, the newest Ready plan — and publishes it latched (`/autoassess/plan`, `/autoassess/plan_id`, `/autoassess/inspection_targets`), buffers
findings your detection stack publishes on `/autoassess/findings`, and at mission end uploads
the mission and reports progress on `/autoassess/upload_status`.

This twin answers the same topics through `sim_gbplanner.ros`, fed from the plan loaded into
`sim_drone`. Findings are validated and buffered with the real node's rules (bad entries are
skipped and logged). When the drone lands (or on the `autoassess_bridge/upload_mission`
service) the mission end is simulated: `/autoassess/upload_status` goes through
exporting_mesh -> uploading -> complete, and the buffered findings become simulated defect
detections on the (simulated) campaign. Nothing is written to CDF; in the real AutoAssess app
the defect detections appear in the Defects tab for review.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from dss_sandbox.gbplanner.geometry_msgs import PoseArray
from dss_sandbox.gbplanner.std_msgs import String
from dss_sandbox.gbplanner.transforms import to_pose_stamped
from dss_sandbox.pose import pose_for_task, task_target

if TYPE_CHECKING:
    from collections.abc import Callable

    from dss_sandbox.simdrone import MissionEvent, SimDrone

FRAME_ID = "world"
#: The inspection standoff the real node uses for /autoassess/inspection_targets.
STANDOFF_M = 0.8
DEFAULT_RADIUS_M = 0.3
MAX_ID_LENGTH = 200
_INSPECTION_TYPES = ("visual", "ndt_thickness")

PLAN_TOPIC = "/autoassess/plan"
PLAN_ID_TOPIC = "/autoassess/plan_id"
TARGETS_TOPIC = "/autoassess/inspection_targets"
FINDINGS_TOPIC = "/autoassess/findings"
UPLOAD_STATUS_TOPIC = "/autoassess/upload_status"
UPLOAD_MISSION_SERVICE = "autoassess_bridge/upload_mission"

#: Topics the simulated bridge publishes (latched: a subscriber gets the current value at once).
BRIDGE_OUTPUT_TOPICS: dict[str, type] = {
    PLAN_TOPIC: String,
    PLAN_ID_TOPIC: String,
    TARGETS_TOPIC: PoseArray,
    UPLOAD_STATUS_TOPIC: String,
}
#: Topics the simulated bridge subscribes to.
BRIDGE_INPUT_TOPICS: dict[str, type] = {FINDINGS_TOPIC: String}


@dataclass(frozen=True)
class Finding:
    """One validated /autoassess/findings entry (same fields as the real node's)."""

    id: str
    position: tuple[float, float, float]
    normal: tuple[float, float, float] | None = None
    radius_m: float | None = None
    inspection_type: str | None = None  # visual | ndt_thickness
    finding_class: str | None = None
    confidence: float | None = None
    description: str | None = None


class _InvalidEntry(ValueError):
    pass


def parse_findings_payload(payload: Any) -> tuple[list[Finding], list[str]]:
    """Parse one /autoassess/findings message: a JSON object or array (the real node's rules).

    `payload` may be a std_msgs String, a JSON string, or a plain dict / list. Bad entries
    become error strings, not raises.
    """
    if isinstance(payload, String):
        payload = payload.data
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError as exc:
            return [], [f"not JSON: {exc}"]
    if isinstance(payload, dict):
        entries: list[Any] = [payload]
    elif isinstance(payload, list):
        entries = payload
    else:
        return [], [f"expected a JSON object or array, got {type(payload).__name__}"]

    findings: list[Finding] = []
    errors: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"entry {index}: not an object")
            continue
        try:
            findings.append(_parse_entry(entry))
        except _InvalidEntry as exc:
            errors.append(f"entry {index}: {exc}")
    return findings, errors


def _parse_entry(entry: dict[str, Any]) -> Finding:
    row = {k: v for k, v in entry.items() if v is not None and v != ""}
    position = (_number(row, "x"), _number(row, "y"), _number(row, "z"))
    return Finding(
        id=_entry_id(row),
        position=position,
        normal=_normal(row),
        radius_m=_radius(row),
        inspection_type=_inspection_type(row),
        finding_class=_text(row, "class"),
        confidence=_confidence(row),
        description=_text(row, "description"),
    )


def _entry_id(row: dict[str, Any]) -> str:
    finding_id = str(row.get("id", "") or "")
    if not finding_id:
        canonical = "\x1f".join(f"{k}={row[k]}" for k in sorted(row) if k != "id")
        return "row-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
    if "+" in finding_id:
        raise _InvalidEntry(f"id {finding_id!r} must not contain '+'")
    if len(finding_id) > MAX_ID_LENGTH:
        raise _InvalidEntry(f"id is longer than {MAX_ID_LENGTH} characters")
    return finding_id


def _number(row: dict[str, Any], key: str) -> float:
    if key not in row:
        raise _InvalidEntry(f"{key} is missing")
    raw = row[key]
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise _InvalidEntry(f"{key} {raw!r} is not a number")
    try:
        value = float(raw)
    except ValueError:
        raise _InvalidEntry(f"{key} {raw!r} is not a number") from None
    if not math.isfinite(value):
        raise _InvalidEntry(f"{key} {raw!r} is not a finite number")
    return value


def _normal(row: dict[str, Any]) -> tuple[float, float, float] | None:
    given = [key in row for key in ("nx", "ny", "nz")]
    if not any(given):
        return None
    if not all(given):
        raise _InvalidEntry("nx, ny and nz must all be set or all be missing")
    v = (_number(row, "nx"), _number(row, "ny"), _number(row, "nz"))
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if length < 1e-9:
        raise _InvalidEntry("normal (nx, ny, nz) is zero-length")
    return (v[0] / length, v[1] / length, v[2] / length)


def _radius(row: dict[str, Any]) -> float | None:
    if "radius" not in row:
        return None
    radius = _number(row, "radius")
    if radius <= 0:
        raise _InvalidEntry(f"radius must be a positive number of metres, got {radius}")
    return radius


def _inspection_type(row: dict[str, Any]) -> str | None:
    raw = str(row.get("inspection_type", "") or "").lower()
    if not raw:
        return None
    if raw not in _INSPECTION_TYPES:
        raise _InvalidEntry(f"inspection_type must be visual or ndt_thickness, got {raw!r}")
    return raw


def _confidence(row: dict[str, Any]) -> float | None:
    if "confidence" not in row:
        return None
    confidence = _number(row, "confidence")
    if not 0 <= confidence <= 1:
        raise _InvalidEntry(f"confidence must be between 0 and 1, got {confidence}")
    return confidence


def _text(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    return str(value) if value else None


class SimAutoassessBridge:
    """The simulated bridge behind `sim_gbplanner.ros`'s /autoassess/* topics.

    `deliver(topic, msg)` hands a message to the SimRos subscribers of that topic.
    """

    def __init__(self, sim_drone: SimDrone, deliver: Callable[[str, Any], None]) -> None:
        self._drone = sim_drone
        self._deliver = deliver
        self._buffer: dict[str, Finding] = {}
        self._reported_errors: set[str] = set()
        self._mission = 1
        self._mission_ended = False
        self._status: dict[str, Any] | None = None
        sim_drone.on_event(self._on_event)

    # --- latched plan topics ---------------------------------------------------------------

    def latched(self, topic: str) -> list[Any]:
        """The current value(s) of a latched topic, delivered on subscribe (like ROS latching)."""
        if topic == UPLOAD_STATUS_TOPIC:
            return [String(data=json.dumps(self._status or self._status_message("idle")))]
        plan = self._drone.plan
        if plan is None:
            return []  # like the real node before it has found an Active or Ready plan
        if topic == PLAN_TOPIC:
            return [String(data=json.dumps(plan))]
        if topic == PLAN_ID_TOPIC:
            return [String(data=str(plan.get("planExternalId", "")))]
        if topic == TARGETS_TOPIC:
            stamp = self._drone.flight_time_s
            poses = []
            for task in plan.get("tasks", []):
                if task_target(task) is None:
                    self._log(f"task {task.get('id')} has no target point: left out of {TARGETS_TOPIC}")
                    continue
                poses.append(to_pose_stamped(pose_for_task(task, STANDOFF_M), FRAME_ID, stamp).pose)
            msg = PoseArray(poses=poses)
            msg.header.frame_id = FRAME_ID
            msg.header.stamp = stamp
            return [msg]
        return []

    # --- findings --------------------------------------------------------------------------

    def handle_findings(self, msg: Any) -> None:
        """One /autoassess/findings message: validate, buffer good entries, log bad ones."""
        findings, errors = parse_findings_payload(msg)
        for error in errors:
            if error not in self._reported_errors:  # once per distinct error, like the node
                self._reported_errors.add(error)
                self._log(f"skipping finding: {error}")
        added = 0
        for finding in findings:
            if finding.id not in self._buffer:  # deduped by id, the first report wins
                self._buffer[finding.id] = finding
                added += 1
        if findings:
            self._log(f"{added} finding(s) buffered for the mission ({len(self._buffer)} total)")

    @property
    def buffered_findings(self) -> list[Finding]:
        return list(self._buffer.values())

    # --- mission end -----------------------------------------------------------------------

    def upload_mission(self) -> tuple[bool, str]:
        """The autoassess_bridge/upload_mission service: simulate the upload now."""
        if self._drone.plan is None:
            message = "No plan followed yet: nothing to upload"
            self._publish_status(self._status_message("failed", message=message))
            return False, message
        return True, self._mission_end()

    def _on_event(self, event: MissionEvent) -> None:
        if event.kind == "takeoff" and self._mission_ended:
            self._mission_ended = False  # a new flight starts a new mission
        if event.kind == "landed" and not self._mission_ended and self._drone.plan is not None:
            self._mission_end()

    def _mission_end(self) -> str:
        """Simulate the real node's mission end: status transitions + defect detections."""
        self._mission_ended = True
        mission_id = f"mission-{self._mission:03d}"
        campaign = f"result-sim-{mission_id}"
        self._publish_status(self._status_message("exporting_mesh", mission_id=mission_id))
        self._publish_status(self._status_message("uploading", mission_id=mission_id))
        findings = list(self._buffer.values())
        defect_ids = [f"defect-{f.id}" for f in findings]
        final = self._status_message(
            "complete",
            mission_id=mission_id,
            campaign=campaign,
            message="Simulated upload: nothing was written to CDF",
            findings=(
                {"count": len(findings), "defectExternalIds": defect_ids} if findings else None
            ),
        )
        self._publish_status(final)
        if findings:
            print(
                f"simulated: {len(findings)} defect detections created on the campaign "
                "(not written to CDF)"
            )
        self._buffer.clear()
        self._mission += 1
        return f"Simulated upload of {mission_id}: campaign {campaign}, {len(defect_ids)} defect detection(s)"

    def _status_message(
        self,
        state: str,
        mission_id: str | None = None,
        campaign: str | None = None,
        message: str = "",
        findings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        plan = self._drone.plan or {}
        return {
            "findings": findings,
            "state": state,  # idle | exporting_mesh | uploading | complete | failed
            "missionId": mission_id,
            "areaExternalId": plan.get("areaExternalId"),
            "planExternalId": plan.get("planExternalId"),
            "campaignExternalId": campaign,
            "cdfFileIds": [],
            "pcdFileIds": [],
            "pcdFileLabels": [],
            "failedFiles": [],
            "skippedFiles": [],
            "message": message,
            "updatedAt": self._drone.flight_time_s,  # simulated seconds (real node: wall time)
        }

    def _publish_status(self, status: dict[str, Any]) -> None:
        self._status = status
        self._deliver(UPLOAD_STATUS_TOPIC, String(data=json.dumps(status)))

    def _log(self, line: str) -> None:
        print(f"[autoassess_bridge] {line}")
