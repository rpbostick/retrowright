# Emulator interfaces players love: research for retrowright

Research only: this file holds no code and copies no images or code from other projects. Links point to other apps' pages and screenshots; nothing from them is in this repository.

This survey is the prior art behind retrowright's library, menu, save slots, touch controls, display settings and offline app; the README describes what they are. In the recommendations, **now** marks what retrowright does, **later** what it may take up (some of which, such as export and import, fast-forward, the scanline filter and the offline app, it does), and **not for us** what it declines.

## Method and its limits

- Sources are project docs, the libretro forums, review sites, RetroAchievements docs, and the few Reddit threads that could be reached. Most Reddit threads could not be read, so Reddit opinion is under-represented; where a thread was seen only through a search summary, that is said.
- Opinion counts: "repeated" means at least two independent sources say it. A claim from one source is marked by the kind of source: "(single post)", "(single review)", "(one thread)", "(single page)", "(project docs only)" for a feature known only from the project's own description (its site, docs or help pages, or a mirror of them), "(review aggregator)" for a page that summarises many app-store reviews, or "seen through a search summary only". A list of features from an encyclopedia article is cited as a feature list, not as praise.
- Several licence questions could not be settled from public pages. The table at the end says which, and what to do before relying on them.

Sources are numbered and listed at the end; `[n]` cites them.

## Ranked short list: the interfaces most worth learning from

1. **Delta (iOS)**: the touch and skin model.
   - *Take:* controller skins as data. A `.deltaskin` is a ZIP of images and an `info.json` with per-device, per-orientation layouts, button frames with enlarged touch edges, and where the game screen sits [11]. It has built-in skins for every system and orientation, user-importable skins [10][11], and animated button presses [9]. A review and app-store reviews both praise its ease of use and its skins [9][13] ([13] review aggregator).
   - *Avoid:* a fixed default layout that cannot be rearranged (an app-store review asks to place buttons anywhere [13], single review), and paywalls on core features: RetroAchievements withheld hardcore mode and planned delisting over a paywalled system [5].
2. **OpenEmu (macOS)**: the library that "just works".
   - *Take:* drop a file in and it is sorted into a library by system, with box art [14][15] (project docs only). One r/emulation thread holds it up as the model of a combined frontend and emulator ([16], seen through a search summary only).
   - *Avoid:* depending on a box-art database that a public open-source web page cannot legally hotlink (see the licence table).
3. **ES-DE (EmulationStation Desktop Edition)**: onboarding with no games, collections, and modes.
   - *Take:* on first run with no games, a dialog explains where game files go and offers to import them [17] (project docs only). It has favourites (one button), custom collections, and Full/Kiosk/Kid UI modes [17] (project docs only). It is the only one of the big three with native Windows, macOS, Linux and Android builds [18] (single review).
   - *Avoid:* setup that needs scraper accounts and directory layouts. Its docs have no accessibility section, and font size and colours depend on the theme [17].
4. **Lemuroid (Android)**: RetroArch's power behind a simple face.
   - *Take:* it scans a folder, downloads the core it needs by itself, and works without config files. Repeated praise calls it simpler than RetroArch [19][20][21] ([21] seen through a search summary only).
   - *Avoid:* touch controls you can only move and resize, not change button by button [22] (single review).
5. **RetroArch (Ozone menu)**: the feature reference, and a warning about menus.
   - *Take:* rewind, run-ahead, integer scaling, CRT shaders (a feature list [23][24][25], not praise); controller auto-configuration by vendor and product ID, whose profile data is MIT-licensed [26][27]; and an OS-narrator accessibility mode for blind players [28].
   - *Avoid:* the core-centric structure, unclear labels ("Load core", "overrides"), a quick menu buried inside the main menu and cluttered settings [29] (one thread); button mapping with no controller picture [30] (one thread). That the interface confuses newcomers is a repeated complaint across three forum threads [29][30][32]. A news report says XMB was hard for newcomers and Ozone became the default after a public vote [31] (single page).

Honourable mention, browser: **Afterplay.io** autosaves and syncs saves across devices, and a review calls it "very easy to use" [33] (single review). RetroAchievements has permanently banned it, for shipping a cheat tool to hardcore players and for working around a suspension [35]. **EmulatorJS** (GPL-3.0 [36]) is the common self-hosted web frontend for RetroArch cores [37].

## 1. Front ends: what people praise and complain about

| Front end | Praised for | Complained about |
| --- | --- | --- |
| RetroArch | Feature list, not praise: rewind, run-ahead, shaders, netplay, achievements [23][24]. Ozone, made the default because XMB was hard for newcomers [31] (single page) | Hard to learn: about 9 of 12 participants in one thread found it confusing [30] (one thread). Core-first structure, labels, clutter, a hidden quick menu [29] (one thread). Developers in that thread rank ease of use below portability and features [29] |
| OpenEmu | Drop-in library with box art [14][15] (project docs only), "just works" [15] (single page) | macOS only [18] |
| ES-DE | Cross-platform [18] (single review). Documented themes, favourites and collections [17] (project docs only) | Slower release pace in 2026 [18] (single review) |
| LaunchBox / Big Box | Deepest customisation, controller-first Big Box, strongest RetroAchievements view [18][38] | Big Box and customisation need the paid licence [18][38]. Windows and Android only [18] |
| Playnite | Free (MIT), one library for stores and emulators, fullscreen mode included [18][38] | Metadata and theme quality vary by plugin [18] (single review) |
| Delta | Ease of use and skins [9][13] ([13] review aggregator). In the App Store without sideloading [12] (single page) | Crashes and save loading, audio crackle [13] (review aggregator). Fixed button layout [13] (single review) |
| Provenance | More systems than Delta, with save states, cheats and cover-art scraping [39][40] | No interface review found |
| Lemuroid | Simpler than RetroArch, folder scan, automatic cores [19][20][21] ([21] seen through a search summary only) | Limited touch layout, no cheats or netplay [22] (single review) |
| Afterplay.io | Easy in-browser play, autosave and cross-device sync [33] (single review). Touch controls [34] (single review) | Paid tier for some systems [41]. Banned by RetroAchievements [35] |
| Internet Archive | One click to boot [42] (single post) | Timing problems in DOS titles, a doubled cursor outside fullscreen [43] (project docs only) |

**For retrowright:**
- **now:** take the shape of OpenEmu and Delta, a library first and the game one tap away, and keep RetroArch's features without its structure. retrowright is NES-only today, so there is no core picker to show at all.
- **not for us:** a RetroArch-style menu of every option, and a paid tier.

## 2. Game library and browser

**Praised:**
- Box art in a grid, sorted by system without any work: OpenEmu's own pitch [14][15] (project docs only), and the model one r/emulation thread holds up ([16], seen through a search summary only).
- Favourites and custom collections [17] (project docs only).
- List and grid blended ("Hybrid Views") in LaunchBox [18] (single review).
- A random-game button [17] (project docs only).
- Metadata filled in automatically [18][38].

**Complained about:**
- Scraping needs accounts, has quotas, and gets locked to registered users when the servers are busy [44][45].
- Metadata quality varies by source [18] (single review).

**Where art and metadata come from, and whether retrowright may use them** (details in the licence table):
- *libretro-thumbnails* has no licence file, and its README says the art "originates from the work of each respective game's developers and publishers" [46].
- *ScreenScraper* may only be built into fully free apps and needs developer credentials issued through its forum [47]. A static page would have to ship those credentials to every visitor.
- *IGDB* needs Twitch OAuth with a client secret (so a server), and its commercial terms are unclear [48].
- *TheGamesDB* needs an API key with a monthly allowance; no image licence was found [49][50].

**Recommendations:**
- **now:**
  - Grow Recent into a library of cards: the title (from the file name, editable), the last-played time, and a thumbnail captured from the player's own last frame or latest save state. The thumbnail is the player's own screenshot, so it raises no art licence question.
  - A "Continue" button on the newest game.
  - Favourites.
  - Search once there are more than about a dozen games.
- **later:**
  - Let players drop in their own cover image per game, stored locally.
  - Identify games by ROM hash against a No-Intro-style database. Check that database's licence first; it was not checked here.
- **not for us:**
  - Hotlinking or bundling libretro-thumbnails, ScreenScraper, IGDB or TheGamesDB art. The art is publishers' copyright and the APIs need secrets or credentials that a static public page cannot keep (see the table).

## 3. In-game experience

**Quick menu.**
- *Praised:* RetroArch's quick menu has every feature [24] (single page).
- *Complained about:* it is hidden inside the main menu and has outgrown its purpose; developers in the thread acknowledge this [29] (one thread).
- **now:** one overlay on Esc, a gamepad combination (Select+Start, or the Home button where the Gamepad API reports it) and, later, a touch button. It holds Resume, Save state, Load state, Reset, Controls, Display, Fullscreen and Quit to library, and pauses the game while open.

**Save states.**
- *Praised:* Afterplay's autosave and cloud sync [33] (single review).
- *Complained about:* save loading problems in Delta reviews [13] (review aggregator).
- **now:** show slots as thumbnails with timestamps in the quick menu instead of a hidden F5/F7 number, and auto-save a "resume" state when the tab hides or the page closes, so "Continue" works.
- **later:** export and import saves as a file, for moving between devices without a server.

**Rewind and fast-forward.** Rewind is a long-standing RetroArch feature [23][24]. Fast-forward was added to Afterplay as a feature worth announcing [41].
- **later:** fast-forward is cheap on a fixed-step pacer. Rewind needs a ring buffer of compact states; NES states are small enough.

**Run-ahead.** It cuts input lag but costs CPU [25].
- **later:** only after measuring lag in the browser.

**Shaders, aspect ratio and integer scaling.** Integer scaling keeps pixels even but may not fill the screen [51]. CRT shaders such as crt-royale and crt-guest-advanced are much shown off in a libretro forum thread [52] (one thread).
- **now:** integer scaling on or off, and pixel aspect (square pixels or the NES's 8:7).
- **later:** a simple scanline or CRT filter written for retrowright in WebGL.
- **not for us:** porting libretro slang shaders. Their licences are mixed per file (GPL, MIT and public domain) [53][54], and the GPL ones cannot go into an MIT repository.

**Controller mapping and auto-configuration.** Mapping without a controller picture confuses newcomers [30] (one thread).
- **now:** show a pad diagram while remapping.
- **later:** use the MIT-licensed retroarch-joypad-autoconfig data [26][27] to name and map non-standard pads that the browser does not report as `standard`. Attribution goes in `NOTICE`.

**Touch controls and skins.** A review and app-store reviews praise Delta's skins [9][13] ([13] review aggregator), though one app-store review finds changing them inconvenient [13] (single review), and its FAQ documents importing them [10]; an app-store review asks for free placement [13] (single review).
- **now:** built-in touch controls for portrait and landscape with large touch edges. Describe the layout as JSON data, modelled on the documented `.deltaskin` ideas [11]: button frames, extended edges, and a screen rectangle.
- **later:** importing user layouts.
- **not for us:** bundling community Delta skins. Each has its own terms [10].

**Achievements (RetroAchievements).** Integration uses the rcheevos library. The client owns the UI and the network [55].

Hardcore mode must:
- block loading states, rewind, slow motion, frame advance and cheats [35][56];
- show its status during play and offer the achievement list [35];
- queue offline unlocks and sync them later [35];
- have a findable privacy policy [35].

Emulators are listed after compliance review. RetroAchievements forbids paywalling sign-in [5] and bans clients that work around its rules [35]. The compliance page says nothing about browser emulators [35].

- **later:** a browser client signs in through RetroAchievements' web API. Check with RetroAchievements staff that a static web client can be approved before building.

**Screenshots.**
- **now:** a quick-menu item that downloads a PNG of the frame. The core already hashes the frame for movies.

## 4. First run and onboarding

**Praised:**
- ES-DE's no-games dialog that says where files go and offers an import [17] (project docs only).
- One-click boot at the Internet Archive [42] (single post).

**Complained about:**
- RetroArch has no first-run setup and never says it plays games [29] (one thread).
- Learning it takes hours [30] (one thread).

Legal ROM handling: freely licensed NES homebrew exists. Annalog is GPL-3.0 code built from source [57]. The NES Open DB project lists only homebrew with an explicit licence [58]. An older NESdev thread lists Zooming Secretary (CC-BY) and The 1007 Bolts (CC0) [59]. Lizard's source is CC-BY but its game content is excluded [60], so "open source" does not always mean the ROM can be redistributed.

- **now:** an empty state that says in two sentences what to do ("Load a `.nes` file from your computer; it stays in this browser"), a drop zone, and a link explaining where legal ROMs come from (your own cartridge dumps, homebrew).
- **later:** offer one homebrew game to try. Bundle it only after reading its licence file and recording it in `NOTICE`; otherwise link to its author's page.

## 5. Browser-specific

| Topic | What browsers impose | Recommendation |
| --- | --- | --- |
| Audio start | Sound needs a user gesture. retrowright already starts on the first click or key | **now:** keep it. Say "click to start sound" only while sound is blocked |
| Keyboard focus | RomM's docs advise "click the canvas once" [61] (single page), so input dies when focus leaves | **now:** take keys at the document level while a game runs, and show "Paused: click to resume" when the window loses focus |
| Gamepad | A pad is not reported until a button is pressed [61] | **now:** show "Press any button on your controller" in the Controls panel |
| Fullscreen | Safari on iOS supports the Fullscreen API only partly [62] | **now:** a fullscreen button on desktop and Android. On iPhone, offer installing to the Home Screen instead |
| Storage | Data can be evicted unless `navigator.storage.persist()` is granted [63][64]. Safari's ITP may clear site data after 7 days without use; Home Screen apps are reported exempt [65] (one thread) | **now:** request persistence after the first save, and show storage use. **later:** export and import of all saves |
| Offline and PWA | A service worker can cache the static app [64] | **later:** a web app manifest and service worker so the page installs and runs offline |
| Threads | EmulatorJS's threaded features need SharedArrayBuffer [61], which needs a cross-origin-isolated page [66], and GitHub Pages cannot set the required headers | **not for us** while on GitHub Pages: the NES core does not need threads. Revisit for SNES or GBA |
| File handling | Files come in through the picker or a drop | **later:** File Handling API for an installed PWA (Chromium only) |
| Mobile | A review praises Afterplay's touch controls [34] (single review) | **now:** touch controls (section 3) |

## 6. Accessibility

**Praised:** RetroArch's narrator mode lets blind users navigate menus through the OS screen reader, including Windows Narrator, macOS `say` and eSpeak [28] (project docs only). It is off by default and does not make games themselves accessible [28].

**Complained about:**
- Button mapping is hard without a picture [30] (one thread).
- ES-DE's documentation has no accessibility section; font size depends on the theme [17].

**Recommendations:**
- **now:**
  - Keep menus as HTML, not drawn on the canvas, so screen readers and keyboard navigation work without extra effort.
  - Visible focus rings.
  - Text contrast meeting WCAG AA.
  - Respect `prefers-reduced-motion` for any animated menus or skin effects.
  - Every action reachable by keyboard and by gamepad.
- **later:**
  - Per-game remapping.
  - Remapping one action to a held or toggled button.
  - Announce state changes ("Saved to slot 2") through an ARIA live region.

Achievements wait on the approval question in section 3.

## Licence and terms table

| Source | Kind | Licence or terms | Use in retrowright |
| --- | --- | --- | --- |
| libretro-thumbnails [46] | Box art, title and in-game screenshots | No licence file. The README says the art originates from each game's developers and publishers | **No.** Do not bundle or hotlink |
| ScreenScraper [47] | Metadata and media API | Only in fully free apps. Developer ID and password issued via its forum. Per-user quotas, and the app must enforce them. No media redistribution licence found | **No.** Credentials would be public in a static page |
| IGDB [48] | Metadata and cover API | Twitch Developer Service Agreement. Client-secret OAuth. Commercial use needs a partnership and attribution is expected (from third-party summaries of its docs, since its docs could not be read directly) | **No** without a server |
| TheGamesDB [49][50] | Metadata and art API | API key required, monthly allowance. No terms or image licence found on its public pages | **No** until terms are found |
| LaunchBox Games Database [18] | Metadata and art | Proprietary, according to one review [18] (single review). Terms not checked | **No** |
| libretro slang-shaders [53][54] | Shaders | Mixed per file: GPL, MIT and public domain. crt-royale and crt-guest-advanced licences not confirmed here | **No** for GPL files in an MIT repo. Write our own filter |
| Delta skins [10][11] | Touch-control skins | Format documented by the community. Each skin carries its own terms | Learn from the format. Bundle none |
| retroarch-joypad-autoconfig [26][27] | Controller profiles | MIT, copyright 2019 The RetroArch team | **Yes** with attribution in `NOTICE` |
| RetroAchievements and rcheevos [35][55] | Achievements | Hardcore compliance rules, no paywall [5], a privacy policy. rcheevos's licence not confirmed here | **Later**, after approval and licence checks |
| EmulatorJS [36] | Web frontend code | GPL-3.0 | **No** code copying into the MIT repo. Ideas only |
| Annalog [57] | NES homebrew | Code GPL-3.0. Asset licence not stated | Link, or build and bundle only after confirming the assets' licence |
| Zooming Secretary, The 1007 Bolts [59] | NES homebrew | CC-BY and CC0 according to an old NESdev thread | Candidates for a first game. Re-verify the current licence |

## Sources

Numbers 1 to 4 and 6 to 8 are unused; they are kept as placeholders so the list renders with the numbers the text cites.

1. (unused)
2. (unused)
3. (unused)
4. (unused)
5. RetroAchievements forum, "A Note on RA Process Updates and the Afterplay Emulator": https://retroachievements.org/forums/topic/31930
6. (unused)
7. (unused)
8. (unused)
9. Retro Dodo, Delta animated skins: https://retrododo.com/delta-ios-emulation-app-is-getting-animated-skins-screen-repositioning/
10. Delta FAQ, controller skins: https://faq.deltaemulator.com/using-delta/controller-skins
11. Delta skin format guide: https://noah978.gitbook.io/delta-docs/skins
12. Pocket Gamer, Delta: https://www.pocketgamer.com/delta-game-emulator/
13. Delta app-store review summaries: https://justuseapp.com/en/app/1048524688/delta-game-emulator/reviews and https://kimola.com/reports/unlock-delta-emulator-insights-a-comprehensive-feedback-report-app-store-us-146295
14. OpenEmu project page: https://openemu.org/
15. OpenEmu on SourceForge: https://sourceforge.net/mirror/openemu/
16. r/emulation thread "Frontend / launcher" (April 2025): https://www.reddit.com/r/emulation/comments/1k8otrr/
17. ES-DE user guide: https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md
18. Tech Insider, "LaunchBox vs Playnite vs ES-DE (2026)": https://tech-insider.org/launchbox-vs-playnite-vs-es-de-2026/
19. AlternativeTo, Lemuroid user comments: https://www.alternativeto.net/software/lemuroid/about/
20. itch.io comment recommending Lemuroid over RetroArch: https://itch.io/post/8564090
21. r/Roms thread "C'mon, become free already" (March 2024): https://www.reddit.com/r/Roms/comments/1b86mzv/
22. MyNextTablet, best GBA emulators for Android: https://mynexttablet.com/best-gba-emulators-android/
23. Wikipedia, libretro: https://en.wikipedia.org/wiki/Libretro
24. Wikipedia, RetroArch: https://en.wikipedia.org/wiki/RetroArch
25. GamingOnLinux, RetroArch run-ahead: https://www.gamingonlinux.com/2018/04/retroarch-to-gain-a-feature-to-improve-input-latency-in-the-next-release/
26. retroarch-joypad-autoconfig: https://github.com/libretro/retroarch-joypad-autoconfig
27. Its licence file: https://github.com/libretro/retroarch-joypad-autoconfig/blob/master/COPYING
28. libretro docs, accessibility: https://docs.libretro.com/guides/accessibility/
29. libretro forums, "The UX problems of retroarch, the program that uses cores" (July 2020 to July 2021): https://forums.libretro.com/t/the-ux-problems-of-retroarch-the-program-that-uses-cores/29421
30. libretro forums, "RetroArch Hard to Learn for Newbies?" (June to July 2019): https://forums.libretro.com/t/retroarch-hard-to-learn-for-newbies/22941
31. GamingOnLinux, RetroArch 1.8.5 makes Ozone the default: https://gamingonlinux.com/2020/03/retroarch-185-is-out-replacing-the-xmb-ui-with-ozone-plus-lots-of-bug-fixing
32. libretro forums, "Retroarch interface confusing?": https://forums.libretro.com/t/retroarch-interface-confusing/18148
33. Retro Dodo, Afterplay review: https://retrododo.com/afterplay-review/
34. Chrome Unboxed, Afterplay: https://chromeunboxed.com/afterplay-web-based-game-emulator
35. RetroAchievements, hardcore compliance requirements: https://docs.retroachievements.org/general/hardcore-compliance-requirements.html
36. EmulatorJS repository: https://github.com/EmulatorJS/EmulatorJS
37. Railway, EmulatorJS template: https://railway.com/deploy/emulatorjs
38. Emulation General Wiki, frontends: https://emulation.gametechwiki.com/index.php/Frontend
39. BGR, Provenance: https://bgr.com/tech/provenance-will-soon-bring-ps1-and-genesis-emulation-to-iphone/
40. Notebookcheck, Provenance: https://www.notebookcheck.net/Provenance-multi-system-emulator-coming-to-iOS-App-Store-soon.829352.0.html
41. ClutchPoints, Afterplay speed settings: https://clutchpoints.com/gaming/afterplay-io-new-features-including-speed-settings-for-emulators
42. waxy.org, "10 years of emulation at the Internet Archive": https://waxy.org/2023/09/10-years-of-emulation-at-the-internet-archive/
43. Internet Archive help, MS-DOS emulation: https://help.archive.org/help/ms-dos-emulation/
44. RetroPie forum, ScreenScraper closed to unregistered users: https://retropie.org.uk/forum/post/209374
45. RetroDECK wiki, scraping FAQ: https://repo.retrodeck.net/Xargon/Wiki/raw/commit/37a5e77e85e5460451dea7bd2e576f9934c7b2e9/wiki-rtd/docs/wiki_faq/faq-scraping.md
46. libretro-thumbnails: https://github.com/libretro-thumbnails/libretro-thumbnails
47. ScreenScraper API page: https://www.screenscraper.fr/webapi2.php
48. Twitch developer forum, "Commercial use of IGDB API": https://discuss.dev.twitch.com/t/commercial-use-of-igdb-api/23567
49. TheGamesDB: https://thegamesdb.net/
50. thegamesdb Ruby gem notes on the API key and allowance: https://www.rubydoc.info/gems/thegamesdb
51. RetroDECK, RetroArch display and scaling guide: https://retrodeck.readthedocs.io/en/latest/wiki_multi_emulator_guides/retroarch/retroarch-shaders-display/
52. libretro forums, "Please show off what CRT shaders can do": https://forums.libretro.com/t/please-show-off-what-crt-shaders-can-do/19193
53. FreshPorts, libretro-shaders-slang licences: https://freshports.org/games/libretro-shaders-slang
54. Arch Linux, libretro-shaders-slang: https://archlinux.org/packages/extra/any/libretro-shaders-slang
55. rcheevos README (as vendored in DuckStation): https://git.morozoff.pro/aiden/duckstation/raw/commit/46886d90af6b5b13b8cf43a18d72b1e7915efa86/dep/rcheevos/README.md
56. PPSSPP docs, RetroAchievements: https://www.ppsspp.org/docs/reference/retro-achievements
57. Annalog: https://github.com/mdsteele/annalog
58. NES Open DB: https://nes-open-db.github.io/ (did not load during this research; its publishing rule is quoted from search results)
59. NESdev forum, "Games that can be reproduced and sold": https://nesdev.nes.science/f22/t10404.xhtml
60. Lizard source release: https://www.patreon.com/posts/22147056
61. RomM docs, in-browser play troubleshooting (EmulatorJS): https://docs.romm.app/4.9.2/troubleshooting/in-browser-play/
62. Can I use, Fullscreen API: https://caniuse.com/fullscreen
63. MDN, storage quotas and eviction criteria: https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
64. web.dev, persistent storage: https://web.dev/articles/persistent-storage
65. Apple Developer Forums, "Safari iOS PWA data persistence beyond 7 days": https://developer.apple.com/forums/thread/710157
66. MDN, SharedArrayBuffer security requirements: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
