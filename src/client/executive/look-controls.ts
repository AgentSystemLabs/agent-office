export interface LookAngles { yaw: number; pitch: number }
export function updateLook(look:LookAngles, dx:number, dy:number, sensitivity=.0022):LookAngles {
  return { yaw:look.yaw-dx*sensitivity, pitch:Math.max(-1.15,Math.min(1.15,look.pitch-dy*sensitivity)) };
}
export function movementVector(yaw:number,forward:number,side:number):{x:number;z:number} {
  const length=Math.hypot(forward,side)||1;
  return {x:(-Math.sin(yaw)*forward+Math.cos(yaw)*side)/length,z:(-Math.cos(yaw)*forward-Math.sin(yaw)*side)/length};
}
