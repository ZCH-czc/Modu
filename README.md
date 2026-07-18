# Modu

A calm, polished, local-first reading app built with React Native and Expo.

Modu combines a native bookshelf, EPUB/PDF/TXT import, dynamic book sources, web discovery, and a focused reader designed for phones, tablets, and desktop use.

[Download the latest release](https://github.com/ZCH-czc/Modu/releases/latest)

[Read the changelog](CHANGELOG.md)

## Highlights

- Local bookshelf with add, import, progress tracking, and removal workflows
- EPUB and TXT reading with chapter navigation, pagination, and persistent reading progress
- PDF import and reading through the integrated document experience
- Nearby transfer from any browser on the same Wi-Fi, with explicit in-app approval
- Dynamic JSON book-source import without hard-coded source rules
- Online search, chapter-by-chapter reading, background continuation, and full-book download
- Built-in WebView discovery with a reader mode that can save books to the bookshelf
- Native-style horizontal pagination and an optional vertical scrolling mode
- Reader themes, typography, spacing, alignment, margins, brightness, orientation, and immersive mode
- Predictive Android back gestures, tablet layouts, onboarding, and animated settings controls
- Android development builds and a Windows Electron wrapper

## Technology

- Expo 57
- React Native 0.86
- React 19
- TypeScript
- Hermes
- React Native Reanimated and Gesture Handler
- React Native WebView
- AsyncStorage
- Electron for Windows packaging

## Requirements

- Node.js 20 or newer
- pnpm 11
- Android Studio with Android SDK 36 for Android development
- JDK 17
- PowerShell 7 or Windows PowerShell for the included Android build script

## Getting Started

```powershell
pnpm install
pnpm start
```

Modu uses an Expo development build for native features:

```powershell
pnpm exec expo run:android
```

After the development build is installed, start Metro with:

```powershell
pnpm start -- --dev-client
```

## Android Release Build

The repository includes a version-aware build script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Version 1.5.2 -VersionCode 6
```

The APK is written to `dist/android`.

Release builds enable Hermes bytecode compilation, the React Native new architecture, R8 optimization, unused-resource shrinking, and Android ART profile compilation.

Signing keys are intentionally not included in this repository. Configure a private production keystore before publishing an official build. A local debug keystore may be used only for development and test distribution.

## Book Sources and Web Reading

Book sources are imported at runtime and stored locally. Modu does not hard-code third-party source rules into the application. The WebView reader can extract readable content from pages opened by the user and can continue across detected chapter links.

Source rules and websites may change, require authentication, use anti-bot protection, or restrict automated access. Users are responsible for complying with the terms and copyright rules of each source they use.

## Project Structure

```text
src/
  components/   Shared UI and animated controls
  screens/      Bookshelf, settings, reader, and web reader screens
  services/     Persistence, import, book-source, and runtime services
android/        Native Android project
desktop/        Windows Electron wrapper
scripts/        Build and book-source test utilities
```

## Privacy

Reading progress, preferences, imported source definitions, and downloaded content are stored locally unless a selected website or book source requires a network request. Modu does not bundle third-party credentials.

## Status

Modu is under active development. Android is the primary tested platform; the Windows wrapper and tablet layouts are also included.
