import type { DroneImage } from '../features/viewer/DroneImageService';

let counter = 0;

export function createMockDroneImage(overrides: Partial<DroneImage> = {}): DroneImage {
  counter += 1;
  return {
    space: 'autoassess',
    externalId: `drone-image-result-ship-ch-sim-frame-${counter}`,
    campaignExternalId: 'result-ship-ch-sim',
    frameId: counter,
    timestamp: 1762179077.257 + counter * 0.08,
    position: [0.04, -0.10, 4.40],
    orientationQuat: [0.001, 0.0003, -0.683, 0.730],
    cdfFileId: 1000 + counter,
    bboxMin: [-2.0, -13.0, 6.0],
    bboxMax: [10.0, 0.0, 9.0],
    focalLengthX: 390.598938,
    focalLengthY: 390.598938,
    principalPointX: 320.0,
    principalPointY: 240.0,
    imageWidth: 640,
    imageHeight: 480,
    nearPlane: 0.4,
    farPlane: 35.0,
    ...overrides,
  };
}
