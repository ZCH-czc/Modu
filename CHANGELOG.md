# Changelog

All notable changes to Modu are documented in this file.

The project follows [Semantic Versioning](https://semver.org/). Changes that have not shipped in a tagged GitHub Release remain under **Unreleased**.

## [Unreleased]

## [1.5.12] - 2026-07-22

### Added
- Add contextual spotlight tours that point to real controls across the library, Web Finder, Web Reader, local EPUB/TXT reader, and PDF reader.
- Persist guide completion locally and let users replay the complete onboarding flow from Settings.
- Add complete English copy and accessibility labels for the new guided experience.

### Changed
- Adapt guide highlights and instruction cards to phone and tablet safe areas, including display cutouts and Android gesture navigation.
- Use bounded motion and scale transitions for guide steps without continuous animations or full-screen fade flashes.
## [1.5.11] - 2026-07-21

### Fixed
- Align the tablet cover editor header, preview content, color fields, and actions on one content axis, and render deterministic 10-column tablet and 5-column phone color palettes.

## [1.5.10] - 2026-07-21

### Fixed
- Center the Web Finder bottom toolbar as a compact control group on tablets while preserving the responsive phone layout.

## [1.5.9] - 2026-07-21

### Added
- Let Web Finder users mark the current page as a chapter list, rescan it with relaxed catalog heuristics, and reuse the locally stored result on later visits.

## [1.5.8] - 2026-07-21

### Added
- Discover and persist web novel chapter catalogs, lazily extract unopened chapters, and restore saved web-reading sessions when returning to the original site.
- Fall back to an enabled same-domain book source when generic Web Reader extraction cannot identify readable chapter text.
- Parse safe Legado JSON and JSONP book-source responses across search, book details, chapter catalogs, and chapter content.
- Support common JSONPath properties, wildcards, recursive fields, negative indexes, slices, unions, alternatives, interpolation, and regex replacements without executing source JavaScript.
- Support Legado page-list URL templates such as `<first,next>` while preserving existing request options and browser fallback behavior.

### Changed
- Simplify Web Finder, book-source management, and native reader controls into compact icon-first toolbars with translated accessibility labels.
- Keep primary Library and Settings navigation labels while exposing correct tab roles and selected states to Android accessibility services.

### Fixed
- Prevent English settings headings from pushing the app seal outside narrow phone layouts.
- Prevent page-turn flashes by keeping the destination page pre-rendered through the state commit, then releasing the frozen frame only after the new page has painted.
- Keep pagination calibration from remounting the reader or accepting gestures before the measured layout is ready.
- Settle completed and cancelled swipe gestures by remaining distance with linear motion, avoiding sticky short returns and abrupt end-of-page deceleration.

## [1.5.7] - 2026-07-20

### Changed
- Store imported EPUB and TXT books as per-chapter cache files, loading only the active chapter while prefetching its neighbors and preserving cross-chapter progress, search, bookmarks, and annotations.
- Keep imported EPUB and TXT content out of the bookshelf state, hydrating only the active book and migrating legacy TXT pages into a dedicated content cache.
- Render PDF canvases in a bounded viewport window and recycle pages more than two positions away.

### Fixed
- Jump from full-book search results directly to the prepared target page without replaying intermediate page-turn animations.
- Prevent rapid reverse page swipes from racing the active page-settle animation and leaving the reader locked.
- Reduce reader memory and layout pressure by bounding the paragraph cache and memoizing the current and adjacent pre-laid-out pages.
- Keep paragraph spacing identical before, during, and after a page turn, and move both pages together in slide mode to eliminate the post-animation text jump.

### Added
- Implement Android volume-key page turns across EPUB/TXT, PDF, and the paged Web Reader, restoring normal volume behavior as soon as reading closes.

## [1.5.6] - 2026-07-20

### Changed
- Reduced bookshelf density on phones and tablets by removing the separate daily-reading card and consolidating search, filtering, and sorting controls.
- Bounded the native reader paragraph cache around the active page while retaining adjacent-page pre-layout.
- Pre-layout adjacent pages in Web Reader mode so page text is ready before the outgoing-page animation completes.
- Keep the native reader mounted across online chapter changes and synchronize the new chapter before paint.

### Fixed
- Jump from full-book search results directly to the prepared target page without replaying intermediate page-turn animations.
- Repaired corrupted Simplified Chinese labels in bookshelf sorting, empty states, and in-book search.
- Hid inactive tabs and the bookshelf layer from accessibility and pointer input while another page or the reader is active.
- Retry transient book-source network failures once and fall back to the internal browser bridge when native TLS or socket requests fail.
- Normalize Yiove share links in the automated book-source test so diagnostics follow the same import path as the app.
- Recover chapter lists from explicit table-of-contents links and conservative chapter-link detection when a source layout changes.
- Return rendered DOM for GET requests handled by the internal source browser bridge, improving compatibility with JavaScript-rendered catalog pages.

## [1.5.5] - 2026-07-19

### Added
- Added local-first reading traces with foreground-only session timing, page-turn counts, streaks, a seven-day chart, and per-book totals.
- Added a persistent adjustable daily reading goal with live progress and an animated completion state.
- Added an animated daily reading progress card to the bookshelf with direct access to reading traces, using local calendar dates across midnight.


- Added persistent library search, local and web filters, recently-read/title/progress sorting, animated controls, and a focused empty state.

- Added responsive in-book full-text search with batched scanning, contextual excerpts, highlighted matches, and direct page navigation.

- Added paragraph highlights and reading notes with four colors, animated editing, chapter-sheet navigation, pagination-safe quote relocation, and Markdown export.

- Added persistent page bookmarks with animated reader controls and bookmark navigation inside the chapter sheet.
- Added Android library backup and restore for settings, books, reading progress, bookmarks, and referenced local files.

- Added persistent bookshelf cover customization with two-color gradients, custom HEX colors, and local image covers.
- Added animated, stage-aware import progress for EPUB, TXT, and PDF files, including per-chapter EPUB parsing and layout progress.

### Fixed
- Jump from full-book search results directly to the prepared target page without replaying intermediate page-turn animations.

- Measure the active Android font and safe reading viewport at runtime, then repaginate local text books without losing the reader's relative position.

- Repaginate imported EPUB and TXT books using the current viewport, font, line height, and paragraph spacing.
- Account for short paragraph-heavy pages such as EPUB tables of contents so their last rows stay above Android system navigation.

## [1.5.4] - 2026-07-19

### Fixed
- Jump from full-book search results directly to the prepared target page without replaying intermediate page-turn animations.

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

[Unreleased]: https://github.com/ZCH-czc/Modu/compare/v1.5.9...HEAD
[1.5.9]: https://github.com/ZCH-czc/Modu/compare/v1.5.8...v1.5.9
[1.5.8]: https://github.com/ZCH-czc/Modu/compare/v1.5.7...v1.5.8
[1.5.4]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.4
[1.5.3]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.3
[1.5.2]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.2
[1.5.1]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.1
[1.5.0]: https://github.com/ZCH-czc/Modu/releases/tag/v1.5.0
