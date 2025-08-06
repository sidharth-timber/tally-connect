[Setup]
AppName=Tally Agent
AppVersion=1.0
; These two lines will be overwritten dynamically in your Node server:
OutputDir=.
OutputBaseFilename=TallyAgent

DefaultDirName={pf}\TallyAgent
DefaultGroupName=TallyAgent
UninstallDisplayIcon={app}\agent.exe
Compression=lzma
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "agent.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: ".env"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Tally Agent"; Filename: "{app}\agent.js"

[Run]
Filename: "{cmd}"; Parameters: "/K node ""{app}\install-service.js"""; WorkingDir: "{app}";
