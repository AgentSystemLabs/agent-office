# Smoother floor travel

When you choose another floor, an elevator cabin stays on screen while the destination is built, requested models settle, graphics programs compile, and the first frames upload textures. The doors then open automatically. The cabin shows the current preparation step and elapsed time rather than a guessed percentage.

Quiet original elevator music follows your office volume, music volume, and both mute controls. It stops when the cabin closes, and is silent while the tab is hidden. A browser that has not yet allowed audio may keep the ride silent.

After **15 seconds**, **Emergency · let me out** appears. It closes a stalled loading screen and restores movement. If the server has not delivered the destination, the ride is cancelled and the office requests the floor you came from. If the destination has arrived but its graphics are still warming, it lets you out there. Preparation errors expose the button immediately. Late preparation results cannot take control after you leave.

The top-right **✕** and **Esc** can end the wait at any time; they return you to the same mouse-look handling as other windows. Cancelling during the initial door animation prevents its delayed floor request from sending you away afterwards.

The 3D renderer starts with a pixel-ratio ceiling of **1.25** instead of rendering up to four device pixels per CSS pixel. Text and interface panels stay at the browser's normal resolution. While you are moving around, sustained frame times above 30 ms gradually lower the 3D resolution, down to 0.65. Above 40 ms, expensive real-time shadows and the extra outline rendering pass turn off for that page session. Hidden tabs, open windows and floor-loading spikes are excluded from these decisions. Reloading resets the automatic graphics adjustments.

The elevator covers preparation work; it cannot make a frozen browser thread responsive while that thread is executing a synchronous task. Saved floors, files, and project data are unchanged by graphics adjustments.
