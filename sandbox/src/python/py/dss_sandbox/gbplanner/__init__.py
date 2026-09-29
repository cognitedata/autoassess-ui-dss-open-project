"""dss_sandbox.gbplanner: a simulated gbplanner3 / OmniPlanner (NTNU ARL, BSD-3).

    from dss_sandbox import SimDrone
    from dss_sandbox.gbplanner import SimGbPlanner

    sim_drone = SimDrone(speed_mps=1.0)
    sim_drone.load_plan(plan)                     # the plan's area becomes the (synthetic) tank
    sim_gbplanner = SimGbPlanner(sim_drone, config="bwt_inspection")
    ros = sim_gbplanner.ros                       # call / publish / subscribe / spin, real names
    ros.call("pci_initialization_trigger")
    ros.call("planner_control_interface/std_srvs/automatic_planning")
    ros.spin()
    print(sim_gbplanner.report().summary())

Service/topic names and message fields are gbplanner's (github.com/ntnu-arl/gbplanner_ros,
branch gbplanner3); the planner behind them is a simplified in-browser simulation.
"""

from dss_sandbox.gbplanner import autoassess, geometry_msgs, nav_msgs, planner_msgs, std_msgs, std_srvs
from dss_sandbox.gbplanner.sim import (
    INPUT_TOPICS,
    OUTPUT_TOPICS,
    SERVICES,
    CompartmentCoverage,
    GbPlannerReport,
    SimGbPlanner,
    SimRos,
)
from dss_sandbox.gbplanner.transforms import (
    euler_from_quaternion,
    quaternion_from_euler,
    to_pose_stamped,
    to_sandbox_pose,
)

__all__ = [
    "INPUT_TOPICS",
    "OUTPUT_TOPICS",
    "SERVICES",
    "CompartmentCoverage",
    "GbPlannerReport",
    "SimGbPlanner",
    "SimRos",
    "autoassess",
    "euler_from_quaternion",
    "geometry_msgs",
    "nav_msgs",
    "planner_msgs",
    "quaternion_from_euler",
    "std_msgs",
    "std_srvs",
    "to_pose_stamped",
    "to_sandbox_pose",
]
