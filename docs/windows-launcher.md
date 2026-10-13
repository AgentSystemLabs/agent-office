# Windows supervisor launcher

`bin/office-launcher.ps1` provides a Windows WPF GUI for an office already supervised by scheduled tasks. It does not install tasks or change the office configuration.

Run in Windows PowerShell with `-STA -File bin/office-launcher.ps1`. The defaults target `E:\source\agent-office-deployment`, tasks `Agent Office Studios Server` and `Agent Office Studios Tunnel`, and `http://localhost:4600/`. Override them with `-DeploymentDir`, `-OfficeTask`, `-TunnelTask` and `-OfficeUrl`. Use the same Windows account and permissions as the existing launcher; elevated tasks may require running the GUI as administrator.

**Start Office** starts both tasks. **Stop Office** stops the supervisors and their direct office-server/SSH children. **Restart Office** performs those actions in order. Worker process trees are not recursively killed. The supervisor scripts must be named `office.ps1` and `tunnel.ps1` in the deployment directory and launch their server/SSH process directly. The GUI only stops children of those exact script processes, never every Node or SSH process on the machine.

The status shows the local health endpoint and task states. A running tunnel task means the supervisor is running, not that the public endpoint is necessarily reachable. Separate tabs show the latest 64 KiB of the office, tunnel and supervisor logs, refreshed every three seconds. Scroll upward to read older visible lines without automatic scrolling. Closing the window leaves the services running.

For a visual smoke check without running control actions, pass `-PreviewPath` pointing to a PNG in an existing task temporary directory.
