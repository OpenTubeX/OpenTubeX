# OpenTubeX Local API extension

Browsers don't let web pages read YouTube's responses, so the OpenTubeX web app normally gets its content from Invidious. This extension changes the headers of the web app's requests to YouTube so that browsers allow them. With it, the web app can use the local API and play videos directly from YouTube.

It only changes requests that pages on opentubex.org and the servers you add make, on any of their ports and subdomains. Other sites, including YouTube itself, are left alone. It also removes your YouTube cookies from these requests, so the web app never uses a YouTube account you're signed in to.

The extension works on opentubex.org. To use it with your own server, open the extension's options and add the server's `https://` address, or `http://localhost` for a server on your computer. Browsers can't limit extensions to one port or leave out subdomains, so it then also changes the YouTube requests of other web apps on other ports of that host name and on its subdomains.

For the web app's development server, add `http://localhost` the same way, or `http://127.0.0.1` if you open it at that address.

## Install

The extension isn't in the browser add-on stores yet. [Download the extension](https://github.com/OpenTubeX/OpenTubeX/releases/latest/download/opentubex-local-api-extension.zip), then:

- **Chrome, Edge, and other Chromium browsers:** extract the ZIP file to a folder you keep, open `chrome://extensions`, turn on developer mode, choose **Load unpacked**, and select that folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the ZIP file. Firefox removes temporary add-ons when it restarts.

Reload the web app afterward. It then uses the local API, unless you picked another backend in its settings.

To update the extension in a Chromium browser, extract a newer download over the same folder and choose the reload button on the extension's card in `chrome://extensions`.
