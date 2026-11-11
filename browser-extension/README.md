# OpenTubeX Local API extension

Browsers don't let web pages read YouTube's responses, so the OpenTubeX web app normally gets its content from Invidious. This extension changes the headers of the web app's requests to YouTube so that browsers allow them. With it, the web app can use the local API and play videos directly from YouTube.

It only changes requests that OpenTubeX pages make. Other sites, including YouTube itself, are left alone. It also removes your YouTube cookies from these requests, so the web app never uses a YouTube account you're signed in to.

The extension works on opentubex.org and on `localhost`. To use it with your own server, open the extension's options and add the server's `https://` address. Browsers can't limit extensions to one port, so it then works on every port of that host name.

## Install

The extension isn't in the browser add-on stores yet. Download or clone this repository, then:

- **Chrome, Edge, and other Chromium browsers:** open `chrome://extensions`, turn on developer mode, choose **Load unpacked**, and select this folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` in this folder. Firefox removes temporary add-ons when it restarts.

Reload the web app afterward. It then uses the local API, unless you picked another backend in its settings.
