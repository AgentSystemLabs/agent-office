param(
    [string]$DeploymentDir = 'E:\source\agent-office-deployment',
    [string]$OfficeTask = 'Agent Office Studios Server',
    [string]$TunnelTask = 'Agent Office Studios Tunnel',
    [string]$OfficeUrl = 'http://127.0.0.1:4600/',
    [string]$PreviewPath
)
$ErrorActionPreference = 'Stop'
$DeploymentDir = (Resolve-Path -LiteralPath $DeploymentDir).Path
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Agent Office Launcher" Width="1050" Height="720" MinWidth="850" MinHeight="560" Background="#101827" Foreground="#E6EDF7" WindowStartupLocation="CenterScreen">
 <Window.Resources>
  <Style TargetType="Button"><Setter Property="Margin" Value="0,0,10,0"/><Setter Property="Padding" Value="18,10"/><Setter Property="Background" Value="#DDE8F8"/><Setter Property="Foreground" Value="#14223A"/><Setter Property="FontSize" Value="14"/></Style>
 </Window.Resources>
 <Grid Margin="24"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <StackPanel><TextBlock Text="AGENT OFFICE" FontSize="27" FontWeight="Bold"/><TextBlock Text="Server und Tunnel verwalten" Foreground="#A8B9D2" Margin="0,5,0,20"/></StackPanel>
  <WrapPanel Grid.Row="1" Margin="0,0,0,20"><Button x:Name="Start" Content="▶ Start Office"/><Button x:Name="Stop" Content="■ Stop Office"/><Button x:Name="Restart" Content="↻ Restart Office"/><Button x:Name="Browser" Content="Office öffnen"/></WrapPanel>
  <Border Grid.Row="2" Background="#1E2B40" Padding="14" Margin="0,0,0,16" CornerRadius="8"><StackPanel><TextBlock x:Name="Status" FontSize="15" FontWeight="Bold"/><TextBlock x:Name="Location" Foreground="#A8B9D2" Margin="0,6,0,0"/><TextBlock x:Name="Message" Text="Bereit." Foreground="#8BD5BA" Margin="0,8,0,0" TextWrapping="Wrap"/></StackPanel></Border>
  <TabControl Grid.Row="3" x:Name="Logs" Background="#0B111C">
   <TabItem Header="Office-Logs"><TextBox x:Name="OfficeLog"/></TabItem>
   <TabItem Header="Tunnel-Logs"><TextBox x:Name="TunnelLog"/></TabItem>
   <TabItem Header="Supervisor-Logs"><TextBox x:Name="SupervisorLog"/></TabItem>
  </TabControl>
  <TextBlock Grid.Row="4" Text="Logs werden alle 3 Sekunden aktualisiert. Fenster schließen lässt Office weiterlaufen." Foreground="#A8B9D2" Margin="0,14,0,0"/>
 </Grid>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load([Xml.XmlNodeReader]::new($markup))
$controls = @{}
foreach ($name in 'Start','Stop','Restart','Browser','Status','Location','Message','OfficeLog','TunnelLog','SupervisorLog') { $controls[$name] = $window.FindName($name) }
foreach ($name in 'OfficeLog','TunnelLog','SupervisorLog') {
    $box = $controls[$name]
    $box.IsReadOnly = $true; $box.FontFamily = 'Consolas'; $box.FontSize = 12
    $box.Background = '#0B111C'; $box.Foreground = '#DDE8F8'; $box.Padding = 12
    $box.VerticalScrollBarVisibility = 'Auto'; $box.HorizontalScrollBarVisibility = 'Auto'
}
$controls.Location.Text = "$OfficeUrl  ·  $DeploymentDir"
function Read-LogTail([string]$name) {
    $file = Join-Path $DeploymentDir $name
    if (-not (Test-Path -LiteralPath $file)) { return "Noch keine Logdatei: $name" }
    $stream = [IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
    try {
        # Bounded reads even when a supervisor log has grown to many gigabytes.
        $first = $stream.ReadByte(); $second = $stream.ReadByte()
        $encoding = [Text.Encoding]::UTF8
        if ($first -eq 255 -and $second -eq 254) { $encoding = [Text.Encoding]::Unicode }
        if ($first -eq 254 -and $second -eq 255) { $encoding = [Text.Encoding]::BigEndianUnicode }
        $offset = [Math]::Max(0, $stream.Length - 65536)
        if ($encoding -ne [Text.Encoding]::UTF8) { $offset -= $offset % 2 }
        [void]$stream.Seek($offset, 'Begin')
        $reader = [IO.StreamReader]::new($stream, $encoding, $true)
        try { if ($offset -gt 0) { [void]$reader.ReadLine() }; return $reader.ReadToEnd() }
        finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}
function Refresh-Office {
    try {
        $tasks = @(Get-ScheduledTask -TaskName $OfficeTask,$TunnelTask)
        $server = ($tasks | Where-Object TaskName -EQ $OfficeTask).State
        $tunnel = ($tasks | Where-Object TaskName -EQ $TunnelTask).State
        $healthy = $false
        try { $healthy = (Invoke-RestMethod ($OfficeUrl.TrimEnd('/') + '/api/health') -TimeoutSec 1).ok } catch {}
        $controls.Status.Text = "Office: $(if ($healthy) {'ONLINE'} else {'nicht erreichbar'})  ·  Server: $server  ·  Tunnel: $tunnel"
        $controls.Status.Foreground = $(if ($healthy) {'#8BD5BA'} else {'#FFD28A'})
        $entries = @{ OfficeLog = (Read-LogTail 'office.log'); TunnelLog = (Read-LogTail 'tunnel.log'); SupervisorLog = ("OFFICE SUPERVISOR`r`n" + (Read-LogTail 'office-supervisor.log') + "`r`n`r`nTUNNEL SUPERVISOR`r`n" + (Read-LogTail 'tunnel-supervisor.log')) }
        foreach ($key in $entries.Keys) {
            $box = $controls[$key]
            if ($box.Text -ne $entries[$key]) {
                $follow = $box.VerticalOffset -ge ($box.ExtentHeight - $box.ViewportHeight - 3)
                $box.Text = $entries[$key]
                if ($follow) { $box.ScrollToEnd() }
            }
        }
    } catch { $controls.Message.Text = "Status/Logs: $($_.Exception.Message)" }
}
function Stop-OfficeTasks {
    # Only the direct server/tunnel children of our known supervisors are stopped.
    # Do not kill the entire process tree: worker terminals have their own lifecycle.
    $processes = @(Get-CimInstance Win32_Process)
    $children = @()
    foreach ($scriptName in 'office.ps1','tunnel.ps1') {
        $scriptFile = Join-Path $DeploymentDir $scriptName
        $parents = @($processes | Where-Object { $_.Name -match '^(powershell|pwsh)\.exe$' -and $_.CommandLine -match ('(?i)(?:"|\s)' + [regex]::Escape($scriptFile) + '(?:"|\s|$)') })
        foreach ($parent in $parents) {
            $children += @($processes | Where-Object {
                $_.ParentProcessId -eq $parent.ProcessId -and (
                    ($scriptName -eq 'office.ps1' -and $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bin[/\\]agent-office\.js') -or
                    ($scriptName -eq 'tunnel.ps1' -and $_.Name -eq 'ssh.exe' -and $_.CommandLine -like "*$DeploymentDir*")
                )
            })
        }
    }
    foreach ($taskName in $OfficeTask,$TunnelTask) { Stop-ScheduledTask -TaskName $taskName }
    foreach ($child in $children) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)"
        if ($current -and $current.CreationDate -eq $child.CreationDate) { Stop-Process -Id $child.ProcessId -Force }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $running = @(Get-ScheduledTask -TaskName $OfficeTask,$TunnelTask | Where-Object State -EQ 'Running')
        if (-not $running.Count) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Supervisor wird noch beendet. Bitte kurz warten und erneut starten.'
}
function Invoke-OfficeAction([string]$action) {
    try {
        if ($action -in 'Stop','Restart') { Stop-OfficeTasks }
        if ($action -in 'Start','Restart') { foreach ($taskName in $OfficeTask,$TunnelTask) { Start-ScheduledTask -TaskName $taskName } }
        $controls.Message.Text = "$action ausgeführt. Der Status wird automatisch aktualisiert."
    } catch { $controls.Message.Text = "Fehler: $($_.Exception.Message)" }
    Refresh-Office
}
$controls.Start.Add_Click({ Invoke-OfficeAction 'Start' })
$controls.Stop.Add_Click({ Invoke-OfficeAction 'Stop' })
$controls.Restart.Add_Click({ Invoke-OfficeAction 'Restart' })
$controls.Browser.Add_Click({ Start-Process $OfficeUrl })
Refresh-Office
if ($PreviewPath) {
    $PreviewPath = [IO.Path]::GetFullPath($PreviewPath)
    if (-not (Test-Path -LiteralPath (Split-Path $PreviewPath -Parent))) { throw 'Preview directory must already exist' }
    $window.Show(); $window.UpdateLayout()
    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new(1050,720,96,96,[Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($window)
    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $file = [IO.File]::Create($PreviewPath)
    try { $encoder.Save($file) } finally { $file.Dispose(); $window.Close() }
    exit
}
$timer = [Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(3)
$timer.Add_Tick({ Refresh-Office }); $timer.Start()
$window.Add_Closed({ $timer.Stop() })
[void]$window.ShowDialog()
