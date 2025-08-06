[Setup]
AppName=TallyAgent
AppVersion=1.0
AppPublisher=Your Company Name
AppPublisherURL=https://yourcompany.com
AppSupportURL=https://yourcompany.com/support
AppUpdatesURL=https://yourcompany.com/updates
DefaultDirName={autopf}\TallyAgent
DefaultGroupName=TallyAgent
AllowNoIcons=yes
LicenseFile=
InfoAfterFile=
OutputDir={#MyBuildDir}
OutputBaseFilename={#OutputFilename}
SetupIconFile=
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startservice"; Description: "Install and start as Windows service"; GroupDescription: "Service Options"; Flags: checkedonce

[Files]
Source: "{#MyBuildDir}/TallyAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyBuildDir}/.env"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\TallyAgent"; Filename: "{app}\TallyAgent.exe"
Name: "{group}\{cm:UninstallProgram,TallyAgent}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\TallyAgent"; Filename: "{app}\TallyAgent.exe"; Tasks: desktopicon

[Run]
; Install as service
Filename: "{app}\TallyAgent.exe"; Parameters: "install"; WorkingDir: "{app}"; StatusMsg: "Installing TallyAgent service..."; Tasks: startservice; Flags: runhidden waituntilterminated
; Start the service
Filename: "sc"; Parameters: "start TallyGoAgent1"; WorkingDir: "{app}"; StatusMsg: "Starting TallyAgent service..."; Tasks: startservice; Flags: runhidden waituntilterminated

[UninstallRun]
; Stop and remove service
Filename: "sc"; Parameters: "stop TallyGoAgent1"; Flags: runhidden waituntilterminated
Filename: "{app}\TallyAgent.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated