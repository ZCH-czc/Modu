[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version = '1.5.7',

  [int]$VersionCode = 0,

  [string]$OutputDirectory = '',

  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $projectRoot 'android'
$gradleFile = Join-Path $androidRoot 'app\build.gradle'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Update-RequiredText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Replacement
  )

  $content = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
  $regex = [regex]::new($Pattern)
  if (-not $regex.IsMatch($content)) {
    throw "没有在 $Path 中找到版本字段：$Pattern"
  }

  $updated = $regex.Replace($content, $Replacement, 1)
  if ($updated -ne $content) {
    [System.IO.File]::WriteAllText($Path, $updated, $utf8NoBom)
  }
}

if (-not (Test-Path -LiteralPath $gradleFile)) {
  throw "未找到 Android 工程：$gradleFile"
}

# Expo 57 / React Native 0.86 release flags require explicit Android C++ runtime links.
$nativeCppLinks = @(
  @{ Path = 'node_modules\react-native-worklets\android\CMakeLists.txt'; Pattern = 'target_link_libraries\(worklets android log (?!c\+\+_shared )'; Replacement = 'target_link_libraries(worklets android log c++_shared ' },
  @{ Path = 'node_modules\react-native-reanimated\android\CMakeLists.txt'; Pattern = '(?m)^  log\r?\n  ReactAndroid::reactnative$'; Replacement = "  log`n  c++_shared`n  ReactAndroid::reactnative" },
  @{ Path = 'node_modules\expo-modules-core\android\cmake\main.cmake'; Pattern = '(?m)^  android\r?\n  \$\{JSEXECUTOR_LIB\}$'; Replacement = "  android`n  c++_shared`n  `${JSEXECUTOR_LIB}" },
  @{ Path = 'node_modules\react-native-gesture-handler\android\src\main\jni\CMakeLists.txt'; Pattern = '(?m)(^target_link_libraries\(\r?\n  \$\{PACKAGE_NAME\}\r?\n)(?!  c\+\+_shared)'; Replacement = "`$1  c++_shared`n" },
  @{ Path = 'node_modules\react-native\ReactAndroid\cmake-utils\ReactNative-application.cmake'; Pattern = '(?m)^(target_link_libraries\(\$\{CMAKE_PROJECT_NAME\})\r?\n(?!        c\+\+_shared)'; Replacement = "`$1`n        c++_shared`n" },
  @{ Path = 'node_modules\react-native\ReactAndroid\cmake-utils\ReactNative-application.cmake'; Pattern = 'target_link_libraries\(\$\{CMAKE_PROJECT_NAME\} \$\{AUTOLINKED_LIBRARIES\}\)'; Replacement = 'target_link_libraries(${CMAKE_PROJECT_NAME} ${AUTOLINKED_LIBRARIES} c++_shared)' },
  @{ Path = 'node_modules\react-native\ReactAndroid\cmake-utils\ReactNative-application.cmake'; Pattern = 'target_link_libraries\(\$\{autolinked_library\} common_flags\)'; Replacement = 'target_link_libraries(${autolinked_library} common_flags c++_shared)' }
)
foreach ($nativeCppLink in $nativeCppLinks) {
  $nativeCmake = Join-Path $projectRoot $nativeCppLink.Path
  if (Test-Path -LiteralPath $nativeCmake) {
    $nativeContent = [System.IO.File]::ReadAllText($nativeCmake, $utf8NoBom)
    if ([regex]::IsMatch($nativeContent, $nativeCppLink.Pattern)) {
      $nativeContent = [regex]::Replace($nativeContent, $nativeCppLink.Pattern, $nativeCppLink.Replacement, 1)
      [System.IO.File]::WriteAllText($nativeCmake, $nativeContent, $utf8NoBom)
    }
  }
}
$gradleContent = [System.IO.File]::ReadAllText($gradleFile, $utf8NoBom)
$currentNameMatch = [regex]::Match($gradleContent, 'versionName\s+"(\d+\.\d+\.\d+)"')
$currentCodeMatch = [regex]::Match($gradleContent, 'versionCode\s+(\d+)')
if (-not $currentNameMatch.Success -or -not $currentCodeMatch.Success) {
  throw '无法读取当前 Android versionName 或 versionCode。'
}

$currentVersion = $currentNameMatch.Groups[1].Value
$currentVersionCode = [int]$currentCodeMatch.Groups[1].Value
if (-not $PSBoundParameters.ContainsKey('VersionCode')) {
  $VersionCode = if ($currentVersion -eq $Version) { $currentVersionCode } else { $currentVersionCode + 1 }
}
if ($VersionCode -lt 1) {
  throw 'VersionCode 必须是大于 0 的整数。'
}

Write-Host "同步应用版本：$Version (versionCode $VersionCode)" -ForegroundColor Cyan
Update-RequiredText -Path (Join-Path $projectRoot 'app.json') -Pattern '"version"\s*:\s*"\d+\.\d+\.\d+"' -Replacement ('"version": "{0}"' -f $Version)
Update-RequiredText -Path (Join-Path $projectRoot 'package.json') -Pattern '"version"\s*:\s*"\d+\.\d+\.\d+"' -Replacement ('"version": "{0}"' -f $Version)
Update-RequiredText -Path (Join-Path $projectRoot 'desktop\package.json') -Pattern '"version"\s*:\s*"\d+\.\d+\.\d+"' -Replacement ('"version": "{0}"' -f $Version)
Update-RequiredText -Path (Join-Path $projectRoot 'app.json') -Pattern '"versionCode"\s*:\s*\d+' -Replacement ('"versionCode": {0}' -f $VersionCode)
Update-RequiredText -Path (Join-Path $projectRoot 'src\services\appUpdate.ts') -Pattern 'CURRENT_APP_VERSION = "\d+\.\d+\.\d+"' -Replacement ('CURRENT_APP_VERSION = "{0}"' -f $Version)
Update-RequiredText -Path $gradleFile -Pattern 'versionCode\s+\d+' -Replacement ('versionCode {0}' -f $VersionCode)
Update-RequiredText -Path $gradleFile -Pattern 'versionName\s+"\d+\.\d+\.\d+"' -Replacement ('versionName "{0}"' -f $Version)
Update-RequiredText -Path (Join-Path $projectRoot 'src\screens\SettingsScreen.tsx') -Pattern 'value="v\d+\.\d+\.\d+"' -Replacement ('value="v{0}"' -f $Version)
Update-RequiredText -Path (Join-Path $projectRoot 'src\screens\SettingsScreen.tsx') -Pattern '墨读 \d+\.\d+\.\d+' -Replacement ('墨读 {0}' -f $Version)

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  $nodeCandidates = @(
    $env:NODE_BINARY,
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $nodeCandidates = @($nodeCandidates)

  if ($nodeCandidates.Count -eq 0) {
    throw '未找到 Node.js。请安装 Node.js，或通过 NODE_BINARY 环境变量指定 node.exe。'
  }
  $nodePath = $nodeCandidates[0]
} else {
  $nodePath = $nodeCommand.Source
}

$env:NODE_BINARY = $nodePath
$nodeDirectory = Split-Path -Parent $nodePath
if (($env:PATH -split [System.IO.Path]::PathSeparator) -notcontains $nodeDirectory) {
  $env:PATH = "$nodeDirectory$([System.IO.Path]::PathSeparator)$env:PATH"
}

$javaCommand = Get-Command java -ErrorAction SilentlyContinue
if ($null -eq $javaCommand -and [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
  $javaCandidates = @(
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jre')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe')) }

  $javaCandidates = @($javaCandidates)
  $gradleJdkRoot = Join-Path $env:USERPROFILE '.gradle\jdks'
  if (Test-Path -LiteralPath $gradleJdkRoot) {
    $javaCandidates += @(
      Get-ChildItem -LiteralPath $gradleJdkRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
        Select-Object -ExpandProperty FullName
    )
  }

  if ($javaCandidates.Count -gt 0) {
    $env:JAVA_HOME = $javaCandidates[0]
    $env:PATH = "$(Join-Path $env:JAVA_HOME 'bin')$([System.IO.Path]::PathSeparator)$env:PATH"
  }
}

if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) {
  $androidSdkCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Android\android-sdk'),
    (Join-Path $env:ProgramFiles 'Android\Sdk'),
    'C:\Android\android-sdk',
    'D:\Android\Sdk'
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $androidSdkCandidates = @($androidSdkCandidates)
  if ($androidSdkCandidates.Count -eq 0) {
    throw 'Android SDK was not found. Install it with Android Studio or Visual Studio, or set ANDROID_HOME.'
  }
  $env:ANDROID_HOME = $androidSdkCandidates[0]
}

if ([string]::IsNullOrWhiteSpace($env:ANDROID_SDK_ROOT)) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}

Write-Host "Android SDK: $env:ANDROID_HOME" -ForegroundColor DarkCyan

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot 'dist\android'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot $OutputDirectory
}

Push-Location $androidRoot
try {
  if ($Clean) {
    Write-Host '清理旧的 Android 构建缓存…' -ForegroundColor DarkCyan
    & '.\gradlew.bat' clean --no-daemon
    if ($LASTEXITCODE -ne 0) {
      throw "Gradle clean 失败，退出码：$LASTEXITCODE"
    }
  }

  Write-Host '开始构建 Android release APK…' -ForegroundColor Cyan
  & '.\gradlew.bat' ':app:assembleRelease' --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Android release 构建失败，退出码：$LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$sourceApk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path -LiteralPath $sourceApk)) {
  throw "Gradle 已结束，但未找到 APK：$sourceApk"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$targetApk = Join-Path $OutputDirectory "modu-reader-v$Version-android.apk"
Copy-Item -LiteralPath $sourceApk -Destination $targetApk -Force

$apk = Get-Item -LiteralPath $targetApk
$hash = Get-FileHash -LiteralPath $targetApk -Algorithm SHA256
$sizeMb = [math]::Round($apk.Length / 1MB, 2)

Write-Host ''
Write-Host 'Android APK 构建完成' -ForegroundColor Green
Write-Host "文件：$($apk.FullName)"
Write-Host "大小：$sizeMb MB"
Write-Host "SHA-256：$($hash.Hash)"
