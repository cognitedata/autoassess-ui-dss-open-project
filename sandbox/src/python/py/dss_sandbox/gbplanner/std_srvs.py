"""std_srvs (ROS): Trigger and SetBool, with Request/Response like rospy's generated classes."""

from __future__ import annotations

from dataclasses import dataclass


class Trigger:
    @dataclass
    class Request:
        pass

    @dataclass
    class Response:
        success: bool = False
        message: str = ""


class SetBool:
    @dataclass
    class Request:
        data: bool = False

    @dataclass
    class Response:
        success: bool = False
        message: str = ""


# rospy also generates <Srv>Request / <Srv>Response names.
TriggerRequest = Trigger.Request
TriggerResponse = Trigger.Response
SetBoolRequest = SetBool.Request
SetBoolResponse = SetBool.Response
