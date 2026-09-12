/** Windows CurrentUser DPAPI. Secrets enter via stdin, never shell arguments or diagnostics. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ClientError } from '../client/dist/index.js';
const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $p = [IO.Path]::GetFullPath([string]$r.path)
  if ($p -notmatch '^[A-Za-z]:\\' -or $p -ne [string]$r.path) { throw 'absolute local path required' }
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
    Set-Acl -LiteralPath $target -AclObject $acl
  }
  function VerifyAcl($target) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'links refused' }
    $acl = Get-Acl -LiteralPath $target
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign owner' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,$system.Value)) { throw 'non-private ACL' }
    }
  }
  if ($r.verb -eq 'store') {
    $raw = [Text.Encoding]::UTF8.GetBytes([string]$r.token)
    if ($raw.Length -lt 1 -or $raw.Length -gt 16384) { throw 'credential size' }
    $dir = [IO.Path]::GetDirectoryName($p)
    if (!(Test-Path -LiteralPath $dir)) { [IO.Directory]::CreateDirectory($dir) | Out-Null; PrivateAcl $dir $true }
    VerifyAcl $dir
    if (Test-Path -LiteralPath $p) { throw 'never overwrite' }
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $stream = [IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($encrypted,0,$encrypted.Length); $stream.Flush($true) } finally { $stream.Dispose(); [Array]::Clear($raw,0,$raw.Length) }
    PrivateAcl $p $false
    [Console]::Out.Write('stored')
  } elseif ($r.verb -eq 'read') {
    VerifyAcl $p
    $stream = [IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
      if ($stream.Length -gt 32768 -or $stream.Length -lt 1) { throw 'ciphertext size' }
      $encrypted = New-Object byte[] ([int]$stream.Length)
      $offset = 0
      while ($offset -lt $encrypted.Length) { $n = $stream.Read($encrypted,$offset,$encrypted.Length-$offset); if ($n -eq 0) { throw 'incomplete read' }; $offset += $n }
    } finally { $stream.Dispose() }
    $raw = [Security.Cryptography.ProtectedData]::Unprotect($encrypted,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { if ($raw.Length -gt 16384) { throw 'credential size' }; [Console]::Out.Write([Convert]::ToBase64String($raw)) }
    finally { [Array]::Clear($raw,0,$raw.Length) }
  } else { throw 'unknown operation' }
} catch { [Console]::Error.Write('Private credential operation failed.'); exit 1 }
`;
async function invoke(verb:'store'|'read',file:string,token?:string):Promise<string>{
  if(process.platform!=='win32')throw new ClientError('vault_platform','DPAPI credentials require Windows; use an owned private token file on POSIX.');
  if(!/^[A-Za-z]:\\/.test(file)||path.win32.normalize(file)!==file)throw new ClientError('configuration_path','Use a normalized absolute local Windows vault path.');
  const root=process.env.SystemRoot;
  if(!root||!/^[A-Za-z]:\\/.test(root))throw new ClientError('vault_unavailable','A trusted Windows SystemRoot is required.');
  const executable=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    let output='',failed=false;const fail=()=>{failed=true;child.kill();};
    const timer=setTimeout(fail,15000);
    child.stdout.on('data',(b:Buffer)=>{output+=b.toString('utf8');if(output.length>32768)fail();});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(new ClientError('vault_unavailable','Windows credential protection could not start.'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||failed)reject(new ClientError('vault_refused','DPAPI credential access refused. Verify owned private ACLs, a local regular file, and the current Windows user. Existing vaults are never overwritten.'));else resolve(output);});
    child.stdin.end(JSON.stringify({verb,path:file,...(token===undefined?{}:{token})}));
  });
}
export async function storeVault(file:string,token:string):Promise<void>{
  if(!/^(za_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(token)||Buffer.byteLength(token)>16384)throw new ClientError('invalid_credential','Supply a bounded Zenith credential or OAuth JWT through stdin, not arguments.');
  await invoke('store',file,token);
}
export async function readVault(file:string):Promise<string>{const value=await invoke('read',file);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new ClientError('vault_refused','Invalid protected credential response.');return Buffer.from(value,'base64').toString('utf8');}
