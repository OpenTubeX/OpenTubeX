<p align="center">
 <img alt="" src="/_icons/logoColor.svg" width=500 align="center">
</p>

OpenTubeX is an open-source, highly customizable, privacy-focused desktop YouTube client.
It is available for Windows 10 and later, macOS 12 and later, and Linux.

It originated as a fork of [FreeTube](https://github.com/FreeTubeApp/FreeTube)
and is independently developed and supported. It is not affiliated with,
endorsed by, maintained by, or supported by the FreeTube project.

<br><p align="center"><a href="https://opentubex.org/downloads/">⬇️ Download OpenTubeX</a></p>
<p align="center">
  <a href="https://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml">
    <img alt='Build status' src="https://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml/badge.svg?branch=development" />
  </a>
  <a href="https://weblate.d3sox.me/engage/opentubex/">
    <img src="https://weblate.d3sox.me/widgets/opentubex/-/svg-badge.svg" alt="Translation status" />
  </a>
  <a href="https://fluxer.opentubex.org">
    <img alt="Fluxer members" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.fluxer.app%2Finvites%2FPHdJoM1G&query=%24.member_count&label=Fluxer&suffix=%20members&color=4641D9&logo=fluxer&logoColor=white" />
  </a>
  <a href="https://matrix.opentubex.org">
    <img alt="Matrix" src="https://img.shields.io/badge/Matrix-%23opentubex-black?logo=matrix&logoColor=white" />
  </a>
</p>

<hr>
<p align="center"><a href="#features-added-by-opentubex">Added features</a> &bull; <a href="#screenshots">Screenshots</a> &bull; <a href="#how-does-it-work">How does it work?</a> &bull; <a href="#features">Features</a> &bull; <a href="#download-links">Download Links</a> &bull; <a href="#contributing">Contributing</a> &bull; <a href="#localization">Localization</a> &bull; <a href="#contact">Contact</a> &bull; <a href="#license">License</a></p>
<p align="center"><a href="https://opentubex.org/">Website</a> &bull; <a href="PRIVACY.md">Privacy</a> &bull; <a href="https://github.com/OpenTubeX/OpenTubeX/discussions">Discussions</a></p>
<hr>

<a id="why-opentubex"></a>
## ✨ Why OpenTubeX?

OpenTubeX is aimed at users who want extensive control over their viewing
experience. Some of its major areas of focus are:

- **More playback control**, including per-channel speed and quality preferences, customizable shortcuts, a quick speed bar and silence skipping.
- **A browser-style desktop workflow** with tabs, configurable session restoration, multiple windows, a scroll mini-player and a watch queue.
- **Deeper SponsorBlock integration** with a segment side panel, richer skip controls, channel whitelisting, submissions and full-video labels.
- **More ways to manage and understand your library** through watch-time statistics, configurable history retention, enhanced subscription refreshes and advanced search history.
- **Optional end-to-end encrypted sync** for subscriptions, playlists, history, profiles, tabs and settings, including saved channel settings.

> [!NOTE] 
> OpenTubeX is currently in Beta. While it should work well for most users, there are still bugs and missing features that need to be addressed.
>
> If you have an idea or if you found a bug, please submit a [GitHub issue](https://github.com/OpenTubeX/OpenTubeX/issues/new/choose) so that we can track it.  Please [search the existing issues](https://github.com/OpenTubeX/OpenTubeX/issues?q=is%3Aissue+sort%3Arelevance-desc) before submitting to prevent duplicates!

<a id="features-added-by-opentubex"></a>
## 🚀 Features added by OpenTubeX

[View the feature overview on the OpenTubeX website](https://opentubex.org/extra-features/), or expand the list below.

<details>
<summary>Show feature list</summary>

- Manage and automatically apply playback speed, video quality, subtitles and volume for individual channels. You can enable each option in settings. Playback speeds can be saved automatically whenever you change them through the player options, or you can leave automatic saving off and use the dedicated button below the player to save the current speed for that channel manually.
 <img height="300" alt="image" src="https://github.com/user-attachments/assets/c713c463-93c3-4f21-96a2-4a653c2c8399" />
 <br />
 <img height="75" alt="image" src="https://github.com/user-attachments/assets/560a55c0-f653-4c21-ae30-5cdeff6ac428" />
 <br />
 <img height="250" alt="image" src="https://github.com/user-attachments/assets/a802d400-0f41-4375-a252-9f5a157afb84" />

- Option if you want to multiply seek intervals by playback rate. By default, seek intervals (arrow keys and J/L) are not multiplied by playback rate. You can change this in Player Settings if you prefer the previous behavior.
 <img height="150" alt="image" src="https://github.com/user-attachments/assets/9195f70e-a881-4052-b199-bbdad043e39a" />

- Option for playback rate adjusted timestamps
<img height="150" alt="image" src="https://github.com/user-attachments/assets/d4d3cb45-b227-4521-a88b-2ff14051d0a6" />
<br><img height="150" alt="image" src="https://github.com/user-attachments/assets/982ef08a-7f53-4efb-9ebc-c49328e306b9" />

- Improved chapter tooltips on the seekbar and chapter display in the sidebar
<img height="150" alt="image" src="https://github.com/user-attachments/assets/c6bed647-e872-458d-a4d6-2be58f4c17a0" />
<img width="198" height="87" alt="image" src="https://github.com/user-attachments/assets/cc653a3c-84b1-4541-8225-067d2c16a68e" />
<br />
<img width="587" height="344" alt="image" src="https://github.com/user-attachments/assets/e4986fdc-97f8-406f-8e0d-33cf8bbd31a2" />

- Option to prevent title/description translations by YouTube
<img width="259" height="156" alt="image" src="https://github.com/user-attachments/assets/4713b8eb-9933-45cb-81ca-8db950ebec71" />

- Focus search bar when pressing <kbd>/</kbd> key in addition to <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>L</kbd>

- In-page search with <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>F</kbd>, including previous and next match navigation
<img width="742" height="181" alt="image" src="https://github.com/user-attachments/assets/b4f651f1-321f-4b83-a392-67367b677497" />

- SponsorBlock side panel with segment details, a temporary auto-skip toggle and channel whitelisting
<img height="350" alt="image" src="https://github.com/user-attachments/assets/c62bf50f-aeb7-47fb-9639-63547ac6538d" />

- Improved SponsorBlock tooltips with unskip/reskip/prompt to skip feature
<img width="330" height="86" alt="image" src="https://github.com/user-attachments/assets/299af609-e7f7-4b0d-802e-4062009fc77c" />
<img width="328" height="84" alt="image" src="https://github.com/user-attachments/assets/260874ac-1577-4f37-aa32-3b9a830e6d13" />
<img width="331" height="87" alt="image" src="https://github.com/user-attachments/assets/996c0816-b237-47b6-8b7a-88f39f8e104c" />

- Supports SponsorBlock community contributed chapters, Highlight and Hook/Greetings category
- SponsorBlock category labels when hovering over segments on the seekbar
<img width="556" height="221" alt="image" src="https://github.com/user-attachments/assets/177e216b-2eec-4f54-9aa9-ea98f5d89e18" />

- Experimental SponsorBlock submission

- Tabs like in a web browser, including horizontal and vertical layouts, pinning, colors, thumbnail previews, duplication, unloading, multi-selection, reordering, moving tabs between windows, bulk actions, copying YouTube links and configurable session restoration
<img height="250" alt="image" src="https://github.com/user-attachments/assets/2ddbedea-5997-4a3c-af9e-6a36d3a21d04" />
<br />
<img width="516" height="129" alt="image" src="https://github.com/user-attachments/assets/486f0119-ca74-40ec-835a-dd6f53cf1f56" />

- Option to define a script to run when YouTube blocked your IP. It will automatically run it and reload the video after it has finished
<img width="500" alt="image" src="https://github.com/user-attachments/assets/2946401c-8e01-4048-9638-621289e31956" />

- Auto Picture-in-Picture when switching tabs, minimizing or switching windows, plus a scroll mini-player option
<img width="436" height="157" alt="image" src="https://github.com/user-attachments/assets/4c1f1f7b-7614-41c8-abd3-5c5179d75cee" />
<br />
<img width="400" height="211" alt="617132918-af4e2dc6-2eb6-49c4-bf95-92656237627a" src="https://github.com/user-attachments/assets/74411434-6ec6-4394-801f-2676074a742e" />

- Loop & Copy link in player context menu
<img height="200" alt="image" src="https://github.com/user-attachments/assets/24f7716f-27de-421d-8740-f9a5e30ed1e6" />

- Optional, fully customizable Quick Playback Speed Bar in the player
<img width="488" height="44" alt="image" src="https://github.com/user-attachments/assets/cd055a73-d188-4633-aac6-61ab708a4cd6" />

- Return YouTube Dislike Support
<img height="57" alt="image" src="https://github.com/user-attachments/assets/8ed84d30-9e6f-4e2e-a09e-c3dbd74f8c32" />
<img width="140" height="57" alt="image" src="https://github.com/user-attachments/assets/45987612-64a1-48b6-8254-bd8966b3178a" />

- Remember Volume feature (on by default)
<img width="209" height="48" alt="image" src="https://github.com/user-attachments/assets/7b90cf31-5d90-41bb-b342-c15e2e7c33b6" />

- Player shortcut <kbd>G</kbd> to toggle between 1x and the last playback speed

- Persistent subscription auto-refresh timers, a visual refresh indicator and feed items that stay visible while refreshing
<img width="246" height="226" alt="image" src="https://github.com/user-attachments/assets/31dfc690-b8a3-4ffd-994e-a53e59d0e71f" />
<img width="252" height="32" alt="image" src="https://github.com/user-attachments/assets/8c0d1f81-870e-4572-b2dd-65f0f5b3a705" />

- Watch time statistics with daily and weekly charts
<img height="200" alt="image" src="https://github.com/user-attachments/assets/61942468-a351-4a8c-813e-a7504828121f" />

- Configurable extra thumbnail action button
<img width="261" height="175" alt="image" src="https://github.com/user-attachments/assets/2d7d7549-db79-4d9d-9063-77124d3a9750" />
<img width="94" height="43" alt="image" src="https://github.com/user-attachments/assets/1f74350c-11cc-4515-8e0e-9abedcebaa71" />

- Additional video metadata, including AI-generated content and paid-promotion labels, collaborators, categories, games, tags, relative publication dates and comment counts
<img height="250" alt="image" src="https://github.com/user-attachments/assets/90cfb4b3-1d26-438d-86de-c1be2e8858ce" />
<br />
<img width="488" height="142" alt="image" src="https://github.com/user-attachments/assets/ceaa25b3-2157-4904-80ad-619426862c1d" />
<br />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/0c147b10-c2de-4560-898d-ae80223418c0" />
<br />
<img alt="image" src="https://github.com/user-attachments/assets/7741014a-caa1-4bde-9fc2-6e2cdd5755c8" />

- Reorder or remove playlist items during playback and remember the reverse state of each playlist

- Nested comment reply threads, edited-comment indicators, comment reloading and direct YouTube links to comments
<img height="350" alt="image" src="https://github.com/user-attachments/assets/a3737645-e3c3-40e1-bc1b-a55e13ca44b1" />
<br />
<img width="597" height="132" alt="image" src="https://github.com/user-attachments/assets/81b94e05-e389-43c8-b01a-39f1d53f4932" />
<br />
<img width="129" height="22" alt="image" src="https://github.com/user-attachments/assets/a34dc28c-2103-454b-9e24-4e7f6df5b494" />

- Import subscriptions and watch history from [LibreTube](https://github.com/libre-tube/LibreTube)

- Optional confirmation before closing the app
<img height="200" alt="image" src="https://github.com/user-attachments/assets/a5e37f65-62ba-4fce-bc43-d408f7f17ce7" />

- Transcript panel
<img height="200" alt="image" src="https://github.com/user-attachments/assets/f69a2074-746d-4afe-bee5-9828040f048e" />

- Skip silence (needs to be enabled via Player settings)
<img width="264" height="59" alt="image" src="https://github.com/user-attachments/assets/7886468c-0f08-4ebb-9cfd-2ce07a4230f5" />

- Support for YouTube end-screen annotations
<img height="200" alt="image" src="https://github.com/user-attachments/assets/53bee38f-6221-4463-b474-d9e5f6781d2a" />

- Ambient Mode for the player
<img height="200" alt="image" src="https://github.com/user-attachments/assets/3d14f6a5-0ded-4247-9a89-ba71e005b2c3" />

- Configurable thumbnail sizes
<img height="250" alt="image" src="https://github.com/user-attachments/assets/47f102b3-5884-4219-85ce-552e631bf67c" />

- Sleep timer
<img width="242" height="48" alt="image" src="https://github.com/user-attachments/assets/54fcc8cf-4bc4-49f7-b803-0340c9c218c6" />
<br />
<img height="250" alt="image" src="https://github.com/user-attachments/assets/15440d77-f504-4982-a026-957ed13a07a9" />

- Automatic history retention cleanup and manual deletion of old entries
<img width="552" height="90" alt="image" src="https://github.com/user-attachments/assets/4e91ec53-38e3-43cd-9262-af6a3a1589e7" />
<br />
<img height="200" alt="image" src="https://github.com/user-attachments/assets/a7130fc6-d440-4857-a73e-f8d020c5c543" />

- Hold the left mouse button or <kbd>Space</kbd> to temporarily double the playback speed
<img width="292" height="35" alt="image" src="https://github.com/user-attachments/assets/1cebcba6-4337-4f3b-b98d-b44eba883544" />
<br />
<img width="183" height="97" alt="image" src="https://github.com/user-attachments/assets/d978403f-f61f-4768-9bb5-5669d898a72e" />

- Caption appearance controls and a preferred caption language setting
<img height="250" alt="image" src="https://github.com/user-attachments/assets/0098caa1-ccd6-40d5-bcb8-5daed8e0e15a" />

- Reliable video playback and advanced video, audio and playlist downloads with yt-dlp, stand-alone SRT, VTT, ASS and LRC subtitle downloads, and a page for managing active and completed downloads
<img height="256" alt="image" src="https://github.com/user-attachments/assets/1460f265-5b22-40b6-8958-73b4d3a89e83" />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/d42c04c5-eca4-477f-bcd7-3c8a3bd5a272" />

- Resizable and rearrangeable full-screen docks for video info, comments, playlists, chapters and live chat
<img height="350" alt="image" src="https://github.com/user-attachments/assets/1cb48073-f523-455d-9926-c96a95fdc959" />

- Customizable keyboard shortcuts
<img width="432" height="82" alt="image" src="https://github.com/user-attachments/assets/5e21ef42-245b-4ea1-93fb-ef9d7c542d66" />

- Experimental support for rewinding live streams and premieres

- Indicators for newly fetched subscription content and an optional separate new-content feed
<img width="287" height="85" alt="image" src="https://github.com/user-attachments/assets/ba61cf09-a515-4410-8597-095d5644d34b" />
<img width="294" height="109" alt="image" src="https://github.com/user-attachments/assets/84d221e2-c56e-44e9-ad70-af0a23323549" />
<br />
<img height="350" alt="image" src="https://github.com/user-attachments/assets/384bb44c-baf1-4b08-95cf-33af9b579ea4" />

- Autoplay preview with the next video and countdown displayed on the player
<img height="350" alt="image" src="https://github.com/user-attachments/assets/4765609c-aa89-4620-8918-1525cba44bd6" />

- UI animations with an option to force-enable or disable them independently of system settings
<img width="298" height="167" alt="image" src="https://github.com/user-attachments/assets/673693fb-0ec2-430b-acb8-2d0b7ea06473" />

- Premiere indicators in video lists and metadata
<img width="78" height="25" alt="image" src="https://github.com/user-attachments/assets/2724bb10-dea8-4162-8a7e-30521ce3b87b" />
<img width="277" height="27" alt="image" src="https://github.com/user-attachments/assets/5b8ce731-99b6-4940-8416-77e114fe976e" />

- Resizable playlist card while watching a video
<img height="350" alt="image" src="https://github.com/user-attachments/assets/3677e5cc-484c-46a8-bea7-63dea841d719" />

- Open a chatter's channel by clicking their handle in live chat

- Support for end-to-end encrypted synchronization of subscriptions, playlists, history, profiles, tabs and settings, including saved channel settings. LibreTube Sync Servers are also supported.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/15144ab2-0111-4e38-b011-c7a57417fcd0" />

- Simple watch queue. Videos can be queued from the three-dots menu and managed in a side panel on the watch page, including drag-and-drop reordering.
<img width="295" height="98" alt="image" src="https://github.com/user-attachments/assets/186215f1-f8de-4bfa-bcd8-188172448f69" />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/e4496c03-6fa7-441b-85fd-e93019d429a9" />

- Add-to-playlist inline popover that lets you select which playlists a video should be added to, plus custom icon, emoji and cropped-image options for the quick-bookmark playlist.
<img height="300" alt="Screencast_20260728_120456" src="https://github.com/user-attachments/assets/c3c6aead-f462-4386-8e82-399dbef2abd1" />
<br />
<img width="382" height="129" alt="image" src="https://github.com/user-attachments/assets/bd6dcd6e-346c-4849-9806-dae1a00f6457" />
<br />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/7147298f-38a2-4d5b-a99b-a6722e925049" />

- Search selected text using your chosen search engine.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/862fd213-8646-4f2e-a039-a9cf14c21600" />

- Full search history with restored filters when selecting a search suggestion, plus chips to filter channel search results.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/2932ddbf-6ac3-4cca-b381-914509fe6ef2" />

- Customizable watched-percentage threshold. Set it to 0% to restore the old behavior of marking videos as watched instantly.
<img width="405" height="82" alt="image" src="https://github.com/user-attachments/assets/91d298bd-8cda-4c7d-815d-3834cac977aa" />

- Option to highlight settings that differ from their defaults, with a reset button for them.
<img width="746" height="267" alt="image" src="https://github.com/user-attachments/assets/9ee3f994-e803-4679-80cf-454f294c9b0a" />

- Toast notifications with icons, optional timeout indicators and video thumbnails. Their position is customizable and they can be dismissed by swiping them away or pressing <kbd>Escape</kbd>.
<img width="417" height="126" alt="Screencast_20260729_091357" src="https://github.com/user-attachments/assets/c1b1e055-4f25-46f3-8a8d-eae2345c94b5" />
<img width="324" height="237" alt="image" src="https://github.com/user-attachments/assets/88db071c-4ae7-4a12-a449-69390edba248" />
<img width="254" height="34" alt="image" src="https://github.com/user-attachments/assets/2b762b06-f001-4541-8bba-005828176d16" />

- Option to adjust how rounded UI elements should be, with consistently applied rounding and overlay scrollbars that can remain visible instead of automatically hiding.
<img width="402" height="69" alt="image" src="https://github.com/user-attachments/assets/1a5d4b45-307e-480b-8dcc-75a1502f4625" />
<img width="281" height="39" alt="image" src="https://github.com/user-attachments/assets/2158bbc6-8893-42be-a12b-8b75034bcd56" />

- Option to use a YouTube-style Shorts display and player or the regular video grid and player.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/22b51708-12b1-4d85-b09b-da6c7065e086" />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/44333d49-4ba7-4035-86da-0a28d4b7064a" />

- Display and submission support for SponsorBlock full-video labels and mute segments.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/8a7a0a53-0b1f-478c-a615-9174c4508ddc" />
<img width="334" height="93" alt="image" src="https://github.com/user-attachments/assets/a8232e86-8d3b-42dc-9f81-e6718cfcea3c" />

- Subscription feed refreshes can be canceled and show new videos instantly while loading the rest.
<img height="300" alt="Screencast_20260728_124530" src="https://github.com/user-attachments/assets/b200bd06-0cde-49a5-8b13-2706a3c6cc8c" />

- Draggable, resizable settings window with integrated subpages and cross-category search
<img height="300" alt="image" src="https://github.com/user-attachments/assets/be196edf-e84f-4bae-ab59-89a31e507a6c" />

- Improved live streams and premieres with automatic premiere refreshes, comments, chat replay, optional chat timestamps and a choice between top chat and all messages
<img height="300" alt="image" src="https://github.com/user-attachments/assets/7605cabd-8b2d-428d-a04f-207f9f24cf55" />

- Quick-settings menu for profiles and common preferences, with customizable emoji or cropped-image profile icons
<img height="300" alt="image" src="https://github.com/user-attachments/assets/80cfe992-c400-4ecf-be56-f0685b1e9ecb" />
<img height="300" alt="image" src="https://github.com/user-attachments/assets/a8e50f1b-383b-4865-a2d5-83ef18510b64" />

- Synchronized voice-over translation for supported videos via the unofficial Yandex API, with separate translated and original volume controls

https://github.com/user-attachments/assets/0df65773-8f13-4c5e-90d6-2db9106dea98

- Zoom and pan videos from the player menu. Press <kbd>Z</kbd> to zoom in, <kbd>Shift</kbd> + <kbd>Z</kbd> to zoom out, or hold <kbd>Shift</kbd> and drag to pan.
<img height="300" alt="image" src="https://github.com/user-attachments/assets/d54f6c4d-d7b1-4117-a783-f109c07d94b7" />

- Operating-system notifications when scheduled live streams and premieres start
<img width="460" height="71" alt="image" src="https://github.com/user-attachments/assets/d8d0e9fc-517c-4136-a3a7-d4f165e99477" />

- Create, import, export and edit custom themes, with independent light and dark themes when following the system setting
<img height="300" alt="image" src="https://github.com/user-attachments/assets/55b85fc1-04de-44d6-9a0c-1a5081b5d39a" />

- Automatically translate captions into any language offered by YouTube
<img height="250" alt="image" src="https://github.com/user-attachments/assets/a706d1fa-a6b9-41a2-8ceb-9b42db1ca678" />

- Choose between Material Symbols and Remix Icon throughout the interface
<img width="470" alt="image" src="https://github.com/user-attachments/assets/2c5f32de-0aa8-4679-9888-b76b85795bab" />

</details>

<a id="screenshots"></a>
## 📸 Screenshots
| The main OpenTubeX window                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](docs/screenshots/OpenTubeX1.png)                                                            |

| Watching a video                                                                                 |
|--------------------------------------------------------------------------------------------------|
| ![](docs/screenshots/OpenTubeX2.png)                                                            |

| Settings                                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](docs/screenshots/OpenTubeX3.png)                                                            |

<a id="how-does-it-work"></a>
## ⚙️ How does it work?
OpenTubeX uses a built-in extractor to request data and videos directly from YouTube. The [Invidious API](https://github.com/iv-org/invidious) can be used instead; depending on the video proxy setting, media requests may still go directly to YouTube. OpenTubeX does not use YouTube's official API.

OpenTubeX does not load the standard YouTube website or its page JavaScript, which reduces the browser-based tracking surface. It does not hide network requests: YouTube, an Invidious operator, or an optional service may still observe request metadata, including your IP address unless a proxy is used. See [PRIVACY.md](PRIVACY.md) for the complete threat model.

By default, subscriptions, playlists, settings, history, profiles and other app data remain on your device. When synchronization is enabled, copies of the selected data categories are sent to the configured sync server. Enhanced-privacy sync encrypts those copies on your device before upload; legacy sync servers may receive them in plaintext.

> [!IMPORTANT]  
> Using a VPN or Tor is highly recommended to hide your IP while using OpenTubeX.

<a id="features"></a>
## 🎯 Features
* Watch videos without ads
* Use YouTube without Google tracking you using cookies and JavaScript
* Two extractor APIs to choose from (Built in or Invidious)
* Subscribe to channels without an account
* Connect to an externally setup proxy such as Tor
* View and search your local subscriptions, playlists and history
* Organize your subscriptions into "Profiles" to create a more focused feed
* Export & import subscriptions
* YouTube Trending
* YouTube Chapters
* Most popular videos page based on the set Invidious instance
* SponsorBlock
* DeArrow
* Open videos from your browser directly into OpenTubeX (with extension)
* Watch videos using an external player
* Full Theme support
* Make a screenshot of a video
* Multiple windows
* Mini Player (Picture-in-Picture)
* Keyboard shortcuts
* Option to show only family friendly content
* Show/hide functionality or elements within the app using the distraction free settings
* View channel posts

### Browser Extensions
The following extensions open YouTube links directly in OpenTubeX:

- ~~[LibRedirect](https://libredirect.manerakai.com/)~~ not yet, pending PR [#1139](https://github.com/libredirect/browser_extension/pull/1139)
- [RedirectTube](https://github.com/MStankiewiczOfficial/RedirectTube) since version 2.0.0 (26071)

LibRedirect automatically redirect YouTube links to OpenTubeX.
> [!IMPORTANT]
> To ensure proper functionality, select OpenTubeX as Frontend in the Services settings of the extension.

RedirectTube, doesn’t automatically open YouTube links in OpenTubeX (although this feature can be enabled in the settings). Instead, it adds buttons to the toolbar and context menu, which you can click to open videos in OpenTubeX manually.

- Download LibRedirect from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/libredirect/) (for Firefox based-browsers) or [developer's website](https://libredirect.manerakai.com/download_chromium.html) (for Chrome and Chromium-based browsers).

- Download RedirectTube from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/redirecttube/) (for Firefox based-browsers) or [Chrome Web Store](https://chromewebstore.google.com/detail/redirecttube/jpbaggklodpddjcadlebabhiopjkjfjh) (for Chrome and Chromium-based browsers).

> [!NOTE]
> These extensions do not work on Linux portable builds!
>
> If you have issues with the extension working with OpenTubeX, please create an issue in this repository instead of the extension repository.

<a id="download-links"></a>
## 📦 Download Links
### Official Downloads

> [!CAUTION]
> OpenTubeX is only supported on Windows 10 and later, macOS 12 and above, and various Linux distributions. Installing it on unsupported systems may result in unexpected issues.

* [GitHub Releases](https://github.com/OpenTubeX/OpenTubeX/releases)
* [OpenTubeX Website](https://opentubex.org/downloads/)
* Windows: [WinGet](https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenTubeX/OpenTubeX) (`winget install OpenTubeX.OpenTubeX`)
* Debian / Ubuntu: [APT repository](https://apt.opentubex.org/)
* Fedora / Enterprise Linux: [COPR repository](https://copr.fedorainfracloud.org/coprs/d3sox/opentubex/) or [RPM repository](https://rpm.opentubex.org/)
* openSUSE: [RPM repository](https://rpm.opentubex.org/)
* Flatpak: [OpenTubeX remote](https://flatpak.opentubex.org/), [Flatpark](https://flatpark.org/apps/org.opentubex.OpenTubeX/), and [source code](https://github.com/OpenTubeX/flatpak)
* Arch User Repository (AUR): [Download](https://aur.archlinux.org/packages/opentubex-bin/)

[![Packaging status](https://repology.org/badge/vertical-allrepos/opentubex.svg)](https://repology.org/project/opentubex/versions)
<br />
[![Copr build status](https://copr.fedorainfracloud.org/coprs/d3sox/opentubex/package/opentubex/status_image/last_build.png)](https://copr.fedorainfracloud.org/coprs/d3sox/opentubex/package/opentubex/)

#### Automated Builds (Nightly / Daily)
> [!WARNING]
> Use these builds at your own risk. These are pre-release versions and are only intended for people that want to test changes early and are willing to accept that things could break from one build to another. 

Builds are automatically created from changes to our development branch via [GitHub Actions](http://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml).

The first build with a green check mark is the latest build.

> [!IMPORTANT]
> You will need to have a GitHub account to download these builds.
> If you don't have a GitHub account, you can download the builds via [nightly.link](https://nightly.link/OpenTubeX/OpenTubeX/workflows/build/development).

* Debian / Ubuntu: [APT nightly repository](https://apt.opentubex.org/#nightly-builds)
* Fedora / Enterprise Linux: [RPM nightly repository](https://rpm.opentubex.org/#nightly-builds)
* openSUSE: [RPM nightly repository](https://rpm.opentubex.org/#nightly-builds)
* Flatpak: [Nightly branch](https://flatpak.opentubex.org/#nightly-builds) (`org.opentubex.OpenTubeX//nightly`)
* Arch User Repository (AUR): [Download](https://aur.archlinux.org/packages/opentubex-git/) (`opentubex-git`)

<a id="contributing"></a>
## 🤝 Contributing
Thank you very much to the people and projects that make OpenTubeX possible!

If you like to get your hands dirty and want to contribute, we would love to
have your help.  Send a pull request and someone will review your code. 

> [!IMPORTANT]
> Please follow the [Contribution Guidelines](https://github.com/OpenTubeX/OpenTubeX/blob/development/CONTRIBUTING.md) before sending your pull request.

<a id="localization"></a>
## 🌍 Localization
<a href="https://weblate.d3sox.me/engage/opentubex/">
<img src="https://weblate.d3sox.me/widgets/opentubex/-/287x66-grey.png" alt="Translation status" />
<img src="https://weblate.d3sox.me/widget/opentubex/application/matrix-auto.svg" alt="Translation matrix" />
</a>

We are actively looking for translations! We use [Weblate](https://weblate.d3sox.me/engage/opentubex/) to make it easy for translators to get involved. Click on one of the graphics above to learn how to get involved.

For the Linux Flatpak, the desktop entry comment string can be translated at our [Flatpak repository](https://github.com/OpenTubeX/flatpak/blob/main/org.opentubex.OpenTubeX.desktop).

<a id="contact"></a>
## 💬 Contact
If you ever have any questions, feel free to ask on our [Discussions](https://github.com/OpenTubeX/OpenTubeX/discussions) page, join our [Fluxer](https://fluxer.opentubex.org) server, or our [Matrix](https://matrix.opentubex.org) space (`#opentubex:matrix.org`).

<a id="ai-assisted-development"></a>
## 🤖 AI-assisted development

OpenTubeX is developed extensively with AI-assisted tools. This allows our small
maintainer team to develop features, fix bugs, and iterate much more rapidly.
The source code remains open for anyone to inspect, review, modify, or fork.

This disclosure refers to how OpenTubeX is developed. It does not mean the app
sends your viewing data to an AI service. If AI-assisted development does not
align with your preferences, OpenTubeX may simply not be the right project for
you.

<a id="license"></a>
## 📄 License
[![GNU AGPLv3 Image](https://www.gnu.org/graphics/agplv3-155x51.png)](https://www.gnu.org/licenses/agpl-3.0.html)  

OpenTubeX is Free Software: You can use, study share and improve it at your
will. Specifically you can redistribute and/or modify it under the terms of the
[GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.  
