/** Windows CurrentUser DPAPI. Secrets enter via stdin, never shell arguments or diagnostics. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ClientError } from '../client/dist/index.js';
const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'start'
try {
  $stage = 'load_crypto'
  Add-Type -AssemblyName System.Security
  $stage = 'read_input'
  # With -EncodedCommand, PowerShell owns stdin and presents it as pipeline input.
  # The caller sends ASCII-escaped JSON; user paths never become command text.
  $json = $input | Out-String
  if ($json.Length -gt 131072 -or $json.Length -lt 2) { throw 'input size' }
  $stage = 'parse_input'
  $r = ConvertFrom-Json -InputObject $json
  $stage = 'validate_path'
  if ([string]$r.path -notmatch '^[A-Za-z]:\\') { throw 'absolute local path required' }
  # GetFullPath expands valid 8.3 names (for example the Windows temp home).
  # Validate the supplied path lexically in Node; enforce ACLs on this canonical target.
  $p = [IO.Path]::GetFullPath([string]$r.path)
  if ($p -notmatch '^[A-Za-z]:\\') { throw 'local canonical path required' }
  $stage = 'identity'
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $entropy = [Text.Encoding]::UTF8.GetBytes('zenith-agent-credential-v1')
  function PrivateAcl($target, $directory) {
    if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() }
    else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
    foreach ($who in @($sid, $system)) {
      if ($directory) { $rule = [Security.AccessControl.FileSystemAccessRule]::new($who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow') }
      else { $rule = [Security.AccessControl.FileSystemAccessRule]::new($who, 'FullControl', 'Allow') }
      $acl.AddAccessRule($rule)
    }
    if ($directory) { [IO.Directory]::SetAccessControl($target, $acl) }
    else { [IO.File]::SetAccessControl($target, $acl) }
  }
  function VerifyAcl($target) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'links refused' }
    $acl = Get-Acl -LiteralPath $target
    if (!$acl.AreAccessRulesProtected) { throw 'inherited ACL refused' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign owner' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,$system.Value)) { throw 'non-private ACL' }
    }
  }
  if ($r.verb -eq 'store') {
    $stage = 'validate_token'
    $raw = [Text.Encoding]::UTF8.GetBytes([string]$r.token)
    if ($raw.Length -lt 1 -or $raw.Length -gt 16384) { throw 'credential size' }
    $dir = [IO.Path]::GetDirectoryName($p)
    $stage = 'create_directory'
    if (!(Test-Path -LiteralPath $dir)) { [IO.Directory]::CreateDirectory($dir) | Out-Null; PrivateAcl $dir $true }
    $stage = 'verify_directory'
    VerifyAcl $dir
    $stage = 'create_only'
    if (Test-Path -LiteralPath $p) { throw 'never overwrite' }
    $stage = 'encrypt'
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $stage = 'write_file'
    $stream = [IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($encrypted,0,$encrypted.Length); $stream.Flush($true) } finally { $stream.Dispose(); [Array]::Clear($raw,0,$raw.Length) }
    $stage = 'protect_file'
    PrivateAcl $p $false
    [Console]::Out.Write('stored')
  } elseif ($r.verb -eq 'read') {
    $stage = 'verify_file'
    VerifyAcl $p
    $stage = 'read_file'
    $stream = [IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
      if ($stream.Length -gt 32768 -or $stream.Length -lt 1) { throw 'ciphertext size' }
      $encrypted = New-Object byte[] ([int]$stream.Length)
      $offset = 0
      while ($offset -lt $encrypted.Length) { $n = $stream.Read($encrypted,$offset,$encrypted.Length-$offset); if ($n -eq 0) { throw 'incomplete read' }; $offset += $n }
    } finally { $stream.Dispose() }
    $stage = 'decrypt'
    $raw = [Security.Cryptography.ProtectedData]::Unprotect($encrypted,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { if ($raw.Length -gt 16384) { throw 'credential size' }; [Console]::Out.Write([Convert]::ToBase64String($raw)) }
    finally { [Array]::Clear($raw,0,$raw.Length) }
  } else { throw 'unknown operation' }
} catch { [Console]::Error.Write('zenith-vault:' + $stage); exit 1 }
`;
const stages = new Set(['start','load_crypto','read_input','parse_input','validate_path','identity','validate_token','create_directory','verify_directory','create_only','encrypt','write_file','protect_file','verify_file','read_file','decrypt']);
/** Only a constant stage identifier may cross the native error boundary. */
export function vaultFailureStage(value:string):string {
  const match = /^zenith-vault:([a-z_]+)$/.exec(value.trim());
  return match && stages.has(match[1]!) ? match[1]! : 'unavailable';
}
export function vaultInput(verb:'store'|'read',file:string,token?:string):string {
  return JSON.stringify({verb,path:file,...(token===undefined?{}:{token})})
    .replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`) + '\n';
}
export function validateVaultPath(file:string):void {
  const segments=file.slice(3).split('\\');
  if(file.length>4096||!/^[A-Za-z]:\\/.test(file)||path.win32.normalize(file)!==file||segments.some(part=>
    !part||/[<>:\"/|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
    throw new ClientError('configuration_path','Use a normalized absolute local Windows vault path without devices, streams or ambiguous segments.');
}
async function invoke(verb:'store'|'read',file:string,token?:string):Promise<string>{
  if(process.platform!=='win32')throw new ClientError('vault_platform','DPAPI credentials require Windows; use an owned private token file on POSIX.');
  validateVaultPath(file);
  const root=process.env.SystemRoot;
  if(!root||!/^[A-Za-z]:\\/.test(root))throw new ClientError('vault_unavailable','A trusted Windows SystemRoot is required.');
  const executable=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-InputFormat','Text','-OutputFormat','Text','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    let output='',diagnostic='',failed=false;const fail=()=>{failed=true;child.kill();};
    const timer=setTimeout(fail,15000);
    child.stdout.on('data',(b:Buffer)=>{output+=b.toString('utf8');if(output.length>32768)fail();});
    child.stderr.on('data',(b:Buffer)=>{diagnostic+=b.toString('utf8');if(diagnostic.length>8192)fail();});child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(new ClientError('vault_unavailable','Windows credential protection could not start.'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||failed)reject(new ClientError('vault_refused',`DPAPI credential access refused at ${vaultFailureStage(diagnostic)}. Verify owned private ACLs, a local regular file, and the current Windows user. Existing vaults are never overwritten.`));else resolve(output);});
    // ASCII escaping avoids Windows code-page corruption without passing secrets as arguments.
    child.stdin.end(vaultInput(verb,file,token));
  });
}
export async function storeVault(file:string,token:string):Promise<void>{
  if(!/^(za_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(token)||Buffer.byteLength(token)>16384)throw new ClientError('invalid_credential','Supply a bounded Zenith credential or OAuth JWT through stdin, not arguments.');
  await invoke('store',file,token);
}
export async function readVault(file:string):Promise<string>{const value=await invoke('read',file);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new ClientError('vault_refused','Invalid protected credential response.');return Buffer.from(value,'base64').toString('utf8');}
