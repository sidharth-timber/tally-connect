[Setup]
AppName=Timber Tally Agent
AppVersion=1.0
AppPublisher=Timber Technologies
OutputDir=.
OutputBaseFilename=TallyAgent-Setup
DefaultDirName={pf}\TallyAgent
DefaultGroupName=Timber TallyAgent
UninstallDisplayIcon={app}\agent.js
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "agent.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "tally-pull.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Timber Tally Agent"; Filename: "{app}\agent.js"

[Run]
Filename: "{cmd}"; Parameters: "/C node ""{app}\install-service.js"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated

[Code]
var
  AgentKeyPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  AgentKeyPage := CreateInputQueryPage(wpWelcome,
    'Connect to Timber',
    'Enter your Timber Agent Key',
    'Paste the Agent Key from Timber ' + #8594 + ' CA Settings ' + #8594 + ' Integrations:');
  AgentKeyPage.Add('Agent Key:', False);
  AgentKeyPage.Values[0] := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = AgentKeyPage.ID then begin
    if Trim(AgentKeyPage.Values[0]) = '' then begin
      MsgBox('Please enter your Agent Key before continuing.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvContent, EnvFile: string;
begin
  if CurStep = ssPostInstall then begin
    EnvFile := ExpandConstant('{app}\.env');
    EnvContent :=
      'CA_KEY=' + Trim(AgentKeyPage.Values[0]) + #13#10 +
      'SERVER_URL=http://localhost:6010/api/v1/user/webhook/tally' + #13#10;
    SaveStringToFile(EnvFile, EnvContent, False);
  end;
end;
