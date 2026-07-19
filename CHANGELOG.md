# Changelog

All notable changes to Modu are documented in this file.

The project follows [Semantic Versioning](https://semver.org/). Changes that have not shipped in a tagged GitHub Release remain under **Unreleased**.

## [Unreleased]

## [1.5.4] - 2026-07-19

### Fixed

- Rebalanced reader page spacing with a tighter top edge and a safer bottom reading margin.
- Web-captured books now repaginate for the current screen, font size, and line spacing so the last lines remain visible.
- Pre-layout adjacent reader pages and commit page text before resetting the native page-turn transform, eliminating the visible text refresh after an animation.

## [1.5.3] - 2026-07-18

### Added

- Added nearby transfer on Android: devices on the same Wi-Fi can open a responsive Modu-styled web page and send EPUB, TXT, or PDF books.
- Added an in-app approval queue for nearby transfers. Files remain temporary until the reader accepts them, and declined or abandoned files are removed.
- Added streamed uploads with a 25 MB per-file limit, bounded pending requests, Wi-Fi-aware address selection, and automatic server shutdown when the transfer screen closes.
- Added TXT import and reading alongside EPUB and PDF.
- Added reader font selection across the native reader and WebView reader mode.
- Added bilingual Chinese and English copy for nearby transfer, including browser-side progress and approval states.

### Changed

- Refined the launch sequence with a more expressive animated Modu wordmark.
- Reworked web captures so saved pages open directly in the native reader while retaining links back to the original page and detected table of contents.
- Improved reader pagination state, chapter preloading, toolbar presentation, and page-turn behavior.
- Refreshed bookshelf, settings, reader, web discovery, and onboarding copy with a quieter literary tone.

## [1.5.2] - 2026-07-18

### Added

- Added a livelier branded launch sequence and new Modu app, adaptive Android, and native splash icons.
- Added in-app update checks backed by GitHub Releases with direct APK downloads.

### Changed

- Refined bookshelf, reader, web discovery, dialogs, tablet layouts, and localization.
- Improved reader preloading, pagination state, transition performance, and Android release metadata synchronization.
- Updated the Android build script for Expo 57 and React Native 0.86 native linking.

## [1.5.1] - 2026-07-17

### Added

- Added system-aware runtime internationalization with Simplified Chinese and English.
- Added persistent in-app language switching across the library, settings, readers, web discovery, book sources, onboarding, dialogs, and reminders.

### Changed

- Improved development-build access to local Expo Metro while preserving release network security.
- Enabled Hermes, React Native New Architecture, R8, resource shrinking, and Android ART baseline profiles.

## [1.5.0] - 2026-07-17

### Added

- Published the first public release of Modu.
- Added a responsive bookshelf for phones and tablets, EPUB/PDF import, persistent progress, and chapter navigation.
- Added dynamic JSON book sources, online search, chapter-by-chapter reading, and full-book downloads.
- Added built-in web discovery with reader mode, horizontal pagination, and optional vertical scrolling.
- Added animated reader settings, onboarding, predictive Android back gestures, and initial performance optimizations.

[Unreleased]: https://github.com/ZCH-czc/Modu/compare/v1.5.4...HEAD
[1.5.4]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.4
[1.5.3]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.3
[1.5.2]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.2
[1.5.1]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.1
[1.5.0]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.0
