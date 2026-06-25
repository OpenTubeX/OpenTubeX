<p align="center">
 <img alt="" src="/_icons/logoColor.svg" width=500 align="center">
</p>

OpenTubeX is an open source desktop YouTube player built with privacy in mind.
Use YouTube without advertisements and prevent Google from tracking you with their cookies and JavaScript.
Available for Windows (10 and later), Mac (macOS 12 and later) & Linux thanks to Electron.

<br><p align="center"><a href="https://opentubex.org/downloads/">Download OpenTubeX</a></p>
<p align="center">
  <a href="https://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml">
    <img alt='Build status' src="https://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml/badge.svg?branch=development" />
  </a>
  <a href="https://weblate.d3sox.me/engage/opentubex/">
    <img src="https://weblate.d3sox.me/widgets/opentubex/-/svg-badge.svg" alt="Translation status" />
  </a>
</p>

<hr>
<p align="center"><a href="#screenshots">Screenshots</a> &bull; <a href="#how-does-it-work">How does it work?</a> &bull; <a href="#features">Features</a> &bull; <a href="#download-links">Download Links</a> &bull; <a href="#contributing">Contributing</a> &bull; <a href="#localization">Localization</a> &bull; <a href="#contact">Contact</a> &bull; <a href="#license">License</a></p>
<p align="center"><a href="https://opentubex.org/">Website</a> &bull; <a href="https://github.com/OpenTubeX/OpenTubeX/discussions">Discussions</a></p>
<hr>

> [!NOTE] 
> OpenTubeX is currently in Beta. While it should work well for most users, there are still bugs and missing features that need to be addressed.
>
> If you have an idea or if you found a bug, please submit a [GitHub issue](https://github.com/OpenTubeX/OpenTubeX/issues/new/choose) so that we can track it.  Please [search the existing issues](https://github.com/OpenTubeX/OpenTubeX/issues?q=is%3Aissue+sort%3Arelevance-desc) before submitting to prevent duplicates!

## Extra features compared to FreeTube

- Remember playback speed on a per-channel basis. You can enable it in settings. When enabled, you can either have speeds saved automatically whenever you change them via the player options or keep automatic saving off and use a dedicated button below the player to manually save the current speed for that channel.
 <img height="150" alt="image" src="https://github.com/user-attachments/assets/e8fe58f3-80f0-4280-946e-abf997f0eac3" />
 <img height="150" alt="image" src="https://github.com/user-attachments/assets/8fb28196-cf5a-4bb8-baa5-b911cb37262f" />
 <img height="75" alt="image" src="https://github.com/user-attachments/assets/560a55c0-f653-4c21-ae30-5cdeff6ac428" />

- Remember video quality on a per-channel basis. Works the same way as above

- Option if you want to multiply seek intervals by playback rate. By default, seek intervals (arrow keys and J/L) are not multiplied by playback rate. You can change this in Player Settings if you prefer the previous behavior.
 <img height="150" alt="image" src="https://github.com/user-attachments/assets/9195f70e-a881-4052-b199-bbdad043e39a" />

- Option for playback rate adjusted timestamps
<img height="150" alt="image" src="https://github.com/user-attachments/assets/d4d3cb45-b227-4521-a88b-2ff14051d0a6" />
<br><img height="150" alt="image" src="https://github.com/user-attachments/assets/982ef08a-7f53-4efb-9ebc-c49328e306b9" />

- Chapter tooltips on seekbar
<img height="150" alt="image" src="https://github.com/user-attachments/assets/c6bed647-e872-458d-a4d6-2be58f4c17a0" />

- Option to prevent title/description translations by YouTube
<img width="259" height="156" alt="image" src="https://github.com/user-attachments/assets/4713b8eb-9933-45cb-81ca-8db950ebec71" />

- Focus search bar when pressing <kbd>/</kbd> key in addition to <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>L</kbd>

- SponsorBlock auto-skip temporary toggle under video player
<img width="234" height="72" alt="image" src="https://github.com/user-attachments/assets/d5f300c7-8ba3-400d-ad21-1491638c348d" />

- Improved SponsorBlock tooltips with unskip/reskip/prompt to skip feature
<img width="330" height="86" alt="image" src="https://github.com/user-attachments/assets/299af609-e7f7-4b0d-802e-4062009fc77c" />
<img width="328" height="84" alt="image" src="https://github.com/user-attachments/assets/260874ac-1577-4f37-aa32-3b9a830e6d13" />
<img width="331" height="87" alt="image" src="https://github.com/user-attachments/assets/996c0816-b237-47b6-8b7a-88f39f8e104c" />

- Display SponsorBlock community contributed chapters
- Experimental SponsorBlock submission

- Tabs like in a web browser
<img height="250" alt="image" src="https://github.com/user-attachments/assets/2ddbedea-5997-4a3c-af9e-6a36d3a21d04" />

- Option to define a script to run when YouTube blocked your IP. It will automatically run it and reload the video after it has finished
<img width="500" alt="image" src="https://github.com/user-attachments/assets/2946401c-8e01-4048-9638-621289e31956" />

- Auto Picture-in-Picture: automatically enter PiP when switching tabs or scrolling away from a video
<img height="200" alt="image" src="https://github.com/user-attachments/assets/acb02ab5-2d9b-4e03-9c63-5f3988e2ddcb" />

- Loop & Copy link in player context menu
<img height="200" alt="image" src="https://github.com/user-attachments/assets/24f7716f-27de-421d-8740-f9a5e30ed1e6" />

- Optional Quick Playback Speed Bar in the player
<img width="488" height="44" alt="image" src="https://github.com/user-attachments/assets/cd055a73-d188-4633-aac6-61ab708a4cd6" />

- Return YouTube Dislike Support
<img height="57" alt="image" src="https://github.com/user-attachments/assets/8ed84d30-9e6f-4e2e-a09e-c3dbd74f8c32" />
<img width="140" height="57" alt="image" src="https://github.com/user-attachments/assets/45987612-64a1-48b6-8254-bd8966b3178a" />

- Remember Volume feature (on by default)
<img width="209" height="48" alt="image" src="https://github.com/user-attachments/assets/7b90cf31-5d90-41bb-b342-c15e2e7c33b6" />

- Player shortcut <kbd>G</kbd> to toggle between 1x and the last playback speed

## Screenshots
| The main OpenTubeX window                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube1.png)|

| Watching a video                                                                                 |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube2.png)|

| Settings                                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube3.png)|

## How does it work?
OpenTubeX uses a built in extractor to grab and serve data / videos. The [Invidious API](https://github.com/iv-org/invidious) can also optionally be used. OpenTubeX does not use any official APIs to obtain data. While YouTube can still see your video requests, it can no
longer track you using cookies or JavaScript. Your subscriptions, playlists and history are stored locally on your computer and never sent out.

> [!IMPORTANT]  
> Using a VPN or Tor is highly recommended to hide your IP while using OpenTubeX.

## Features
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

- [LibRedirect](https://libredirect.github.io/)
- [RedirectTube](https://github.com/MStankiewiczOfficial/RedirectTube)

LibRedirect automatically redirect YouTube links to OpenTubeX.
> [!IMPORTANT]
> To ensure proper functionality, select FreeTube as Frontend in the Services settings of the extension.

RedirectTube, doesn’t automatically open YouTube links in OpenTubeX (although this feature can be enabled in the settings). Instead, it adds buttons to the toolbar and context menu, which you can click to open videos in OpenTubeX manually.

- Download LibRedirect from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/libredirect/) (for Firefox based-browsers) or [developer's website](https://libredirect.github.io/download_chromium.html) (for Chrome and Chromium-based browsers).

- Download RedirectTube from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/redirecttube/) (for Firefox based-browsers) or [Chrome Web Store](https://chromewebstore.google.com/detail/redirecttube/jpbaggklodpddjcadlebabhiopjkjfjh) (for Chrome and Chromium-based browsers).

> [!NOTE]
> These extensions do not work on Linux portable builds!
>
> If you have issues with the extension working with OpenTubeX, please create an issue in this repository instead of the extension repository.

## Download Links
### Official Downloads

> [!CAUTION]
> OpenTubeX is only supported on Windows 10 and later, macOS 12 and above, and various Linux distributions. Installing it on unsupported systems may result in unexpected issues.

* [GitHub Releases](https://github.com/OpenTubeX/OpenTubeX/releases)
* [OpenTubeX Website](https://opentubex.org/downloads/)
* Arch User Repository (AUR): [Download](https://aur.archlinux.org/packages/opentubex-bin/)

[![Packaging status](https://repology.org/badge/vertical-allrepos/opentubex.svg)](https://repology.org/project/opentubex/versions)

#### Automated Builds (Nightly / Weekly)
> [!WARNING]
> Use these builds at your own risk. These are pre-release versions and are only intended for people that want to test changes early and are willing to accept that things could break from one build to another. 

Builds are automatically created from changes to our development branch via [GitHub Actions](http://github.com/OpenTubeX/OpenTubeX/actions/workflows/build.yml).

The first build with a green check mark is the latest build.

> [!IMPORTANT]
> You will need to have a GitHub account to download these builds.
> If you don't have a GitHub account, you can download the builds via [nightly.link](https://nightly.link/OpenTubeX/OpenTubeX/workflows/build/development).

* Arch User Repository (AUR): [Download](https://aur.archlinux.org/packages/opentubex-git/)

## Contributing
Thank you very much to the people and projects that make OpenTubeX possible!

If you like to get your hands dirty and want to contribute, we would love to
have your help.  Send a pull request and someone will review your code. 

> [!IMPORTANT]
> Please follow the [Contribution Guidelines](https://github.com/OpenTubeX/OpenTubeX/blob/development/CONTRIBUTING.md) before sending your pull request.

## Localization
<a href="https://weblate.d3sox.me/engage/opentubex/">
<img src="https://weblate.d3sox.me/widgets/opentubex/-/287x66-grey.png" alt="Translation status" />
</a>

We are actively looking for translations! We use [Weblate](https://weblate.d3sox.me/engage/opentubex/) to make it easy for translators to get involved. Click on the badge above to learn how to get involved.

## Contact
If you ever have any questions, feel free to ask it on our [Discussions](https://github.com/OpenTubeX/OpenTubeX/discussions) page.

## License
[![GNU AGPLv3 Image](https://www.gnu.org/graphics/agplv3-155x51.png)](https://www.gnu.org/licenses/agpl-3.0.html)  

OpenTubeX is Free Software: You can use, study share and improve it at your
will. Specifically you can redistribute and/or modify it under the terms of the
[GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.  
