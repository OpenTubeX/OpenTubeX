# Privacy and threat model

OpenTubeX reduces the browser-based tracking surface by providing a local interface instead of loading the standard YouTube website and its page JavaScript. It does not provide anonymity: the services that answer a request can observe it, and network intermediaries can observe connection metadata.

This document describes the data exposed by OpenTubeX itself. It assumes that your device is trusted, HTTPS is not compromised, and any enhanced-privacy sync passphrase remains secret. It does not protect against malware on your device, traffic-correlation attacks, or information you deliberately share through submissions, exports, external players, or custom download arguments.

## Data stored by OpenTubeX

By default, subscriptions, playlists, settings, history, profiles, open tabs and channel playback speeds remain on your device. Enabling synchronization sends copies of the selected categories to the configured sync server:

- Enhanced-privacy sync encrypts the selected data on your device before upload. The server still receives account and traffic metadata.
- A legacy sync server does not support this encryption. Synced data is visible to that server's operator.

## Network exposure

Rows for optional services apply only when the feature is enabled. An IP address in the table means your direct address unless the request is routed through a correctly configured proxy, VPN, or Tor.

| Mode or feature | Who receives requests | What they can observe |
| --- | --- | --- |
| Local extractor | YouTube/Google | IP address, requested API, media and image resources, video or channel identifiers, searches, and timing |
| Invidious | Configured Invidious operator; YouTube receives the instance's upstream requests and may receive direct media requests when video proxying is disabled | The operator can see your IP address, requested content, searches, and timing. YouTube normally sees the instance's IP for proxied requests, but sees your IP for direct media requests |
| VPN or Tor | VPN or Tor infrastructure and the destination service | The intermediary can observe connection metadata depending on the setup. The destination sees the VPN or Tor exit address, requested resources, and timing instead of your direct IP address |
| SponsorBlock | Configured SponsorBlock operator | IP address, timing, lookup hash prefixes and requested categories; submissions and votes additionally reveal video identifiers, segment data, and a SponsorBlock user identifier |
| DeArrow | Configured SponsorBlock/DeArrow and thumbnail-service operators | IP address, timing, video-ID hash prefixes for branding lookups, and full video identifiers and timestamps for generated-thumbnail requests |
| Return YouTube Dislike | Configured Return YouTube Dislike operator | IP address, video identifiers, and timing |
| Enhanced-privacy sync | Configured sync operator | IP address, account identifier, authentication data, encrypted payloads, collection names, payload sizes, revisions, and timing; not the decrypted selected data |
| Legacy sync | Configured sync operator | IP address, account identifier, authentication data, selected synced data, and timing |
| `yt-dlp` playback and downloads | YouTube and the configured proxy, if any | IP address, requested page and media resources, video identifier, formats, and timing. OpenTubeX's proxy setting is passed to `yt-dlp`, and is also used for downloading the managed `yt-dlp` and FFmpeg binaries |

HTTPS encrypts request paths and payloads in transit, but DNS providers and network operators may still learn destination hostnames and traffic patterns. A VPN or Tor changes which parties see your direct IP address; it does not prevent the destination service from seeing the request itself.

## Choosing a setup

- To keep app data local, leave synchronization disabled.
- To prevent a sync operator from reading synced data, use a server that supports enhanced-privacy sync and use a separate, strong privacy passphrase.
- To avoid sending requests to optional services, leave SponsorBlock, DeArrow, Return YouTube Dislike, and synchronization disabled.
- To hide your direct IP address from YouTube or optional services, route the relevant requests through a trusted VPN or Tor and verify the proxy configuration. This includes `yt-dlp` when it is used for playback or downloads, unless custom `yt-dlp` arguments override the proxy.
