param(
  [Parameter(Mandatory=$true)][string]$BuildTools,
  [Parameter(Mandatory=$true)][string]$AndroidJar,
  [Parameter(Mandatory=$true)][string]$SigningDirectory,
  [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
$BuildTools = (Resolve-Path -LiteralPath $BuildTools).Path
$AndroidJar = (Resolve-Path -LiteralPath $AndroidJar).Path
$SigningDirectory = (Resolve-Path -LiteralPath $SigningDirectory).Path
if (-not $JavaHome) {
  $javaProperties = (& java -XshowSettings:properties -version 2>&1 | Out-String)
  $JavaHome = [regex]::Match($javaProperties,'java.home = ([^\r\n]+)').Groups[1].Value.Trim()
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) { throw 'Install a JDK and set JAVA_HOME.' }
$passwordFile = Join-Path $SigningDirectory 'password.txt'
$keystore = Join-Path $SigningDirectory 'raksha-field.p12'
if (-not (Test-Path -LiteralPath $passwordFile) -or -not (Test-Path -LiteralPath $keystore)) { throw 'The existing Raksha Field signing key was not found; refusing to make an APK that cannot update the installed app.' }
$work = Join-Path $env:TEMP ('raksha-field-build-' + [guid]::NewGuid().ToString('N'))
$classes = Join-Path $work 'classes'
$tempOutput = Join-Path $work 'output'
$apkOutputDirectory = Join-Path $PSScriptRoot 'output'
$apkName = 'raksha-field-v1.2.apk'
New-Item -ItemType Directory -Force -Path $work,$tempOutput,$apkOutputDirectory,$classes,(Join-Path $work 'dex') | Out-Null
function Check-Tool { if ($LASTEXITCODE -ne 0) { throw "Android build step failed (exit $LASTEXITCODE)." } }
$sources = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Recurse -Filter '*.java' | ForEach-Object FullName
& (Join-Path $JavaHome 'bin/javac.exe') --release 8 -encoding UTF-8 -classpath $AndroidJar -d $classes $sources
Check-Tool
& (Join-Path $JavaHome 'bin/jar.exe') cf (Join-Path $work 'classes.jar') -C $classes .
Check-Tool
& (Join-Path $BuildTools 'd8.bat') --lib $AndroidJar --min-api 26 --output (Join-Path $work 'dex') (Join-Path $work 'classes.jar')
Check-Tool
& (Join-Path $BuildTools 'aapt2.exe') link -I $AndroidJar --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') --min-sdk-version 26 --target-sdk-version 35 -o (Join-Path $work 'unsigned.apk')
Check-Tool
& (Join-Path $JavaHome 'bin/jar.exe') uf (Join-Path $work 'unsigned.apk') -C (Join-Path $work 'dex') classes.dex
Check-Tool
& (Join-Path $BuildTools 'zipalign.exe') -f -p 4 (Join-Path $work 'unsigned.apk') (Join-Path $work 'aligned.apk')
Check-Tool
$env:RAKSHA_SIGNING_PASS = [IO.File]::ReadAllText($passwordFile)
try {
  & (Join-Path $BuildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias raksha-field --ks-pass env:RAKSHA_SIGNING_PASS --out (Join-Path $tempOutput $apkName) (Join-Path $work 'aligned.apk')
  Check-Tool
  & (Join-Path $BuildTools 'apksigner.bat') verify --verbose (Join-Path $tempOutput $apkName)
  Check-Tool
} finally { $env:RAKSHA_SIGNING_PASS = $null }
$builtApk = (Resolve-Path -LiteralPath (Join-Path $tempOutput $apkName)).Path
Copy-Item -LiteralPath $builtApk -Destination $apkOutputDirectory -Force
Get-Item (Join-Path $apkOutputDirectory $apkName) | Select-Object FullName,Length
