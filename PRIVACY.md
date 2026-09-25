# Privacy and threat model

Last updated: September 25, 2026

This document covers the OpenTubeX desktop and Android apps where the described feature is available. Android stores the library in application storage and uses Android's storage picker for downloaded media; desktop profile paths and executable settings do not apply there.

OpenTubeX reduces the browser-based tracking surface by providing a local interface instead of loading the standard YouTube website and its page JavaScript. It does not provide anonymity: the services that answer a request can observe it, and network intermediaries can observe connection metadata.

This document describes the data exposed by OpenTubeX itself. It assumes that your device is trusted, HTTPS is not compromised, and any enhanced-privacy sync passphrase remains secret. It does not protect against malware on your device, traffic-correlation attacks, or information you deliberately share through submissions, exports, external players, or custom download arguments.

## Data stored by OpenTubeX

By default, subscriptions, playlists, settings (including saved channel settings), history, watch statistics, profiles and open tabs remain on your device. Enabling synchronization sends copies of the selected categories to the configured sync server:

- Enhanced-privacy sync encrypts the selected data on your device before upload. This mode requires a server with live-sync support. The server still receives account and traffic metadata.
- A legacy sync server does not support this encryption. Synced data is visible to that server's operator.

With a compatible enhanced-privacy server, watch statistics are included in sync by default; turn off **Watch stats** in **Settings → Sync** to exclude them. See [sync setup](https://opentubex.org/docs/sync/) for privacy modes and category selection.

The public OpenTubeX sync service has a [separate privacy policy](https://github.com/OpenTubeX/sync-server/blob/main/PRIVACY.md). Other sync-server operators are responsible for their own notices and practices.

On compatible servers, enhanced-privacy sync also uploads encrypted account activity, including changed setting keys and scalar values, while excluding watch history and frequent playback changes. Object values and strings longer than 128 bytes are omitted from activity. Opening a video on another device sends an encrypted request containing its video ID, title, and playback position. The OpenTubeX sync server retains up to 100 activity batches per account for 30 days and up to 100 pending device requests per account for 24 hours; acknowledged requests are deleted, and expired records are normally removed within one hour.

## Network exposure

Rows for optional services apply only when the feature is enabled. An IP address in the table means your direct address unless the request is routed through a correctly configured proxy, VPN, or Tor.

| Mode or feature | Who receives requests | What they can observe |
| --- | --- | --- |
| Local extractor | YouTube/Google | IP address, requested API, media and image resources, video or channel identifiers, searches, and timing |
| Invidious | Configured Invidious operator; YouTube receives the instance's upstream requests and may receive direct media requests when video proxying is disabled | The operator can see your IP address, requested content, searches, and timing. YouTube normally sees the instance's IP for proxied requests, but sees your IP for direct media requests |
| VPN or Tor | VPN or Tor infrastructure and the destination service | The intermediary can observe connection metadata depending on the setup. The destination sees the VPN or Tor exit address, requested resources, and timing instead of your direct IP address |
| Internet connectivity checks (enabled by default) | GrapheneOS-hosted connectivity check server | IP address, request timing, and standard request metadata such as the User-Agent. The `HEAD` request to `connectivitycheck.grapheneos.network/generate_204` sends no cookies, referrer, or request body |
| SponsorBlock | Configured SponsorBlock operator | IP address, timing, lookup hash prefixes and requested categories; contribution-stat lookups reveal a stable hash of a SponsorBlock user identifier; submissions and votes additionally reveal video identifiers, segment data, and a SponsorBlock user identifier |
| DeArrow | Configured SponsorBlock/DeArrow and thumbnail-service operators | IP address, timing, video-ID hash prefixes for branding lookups, and full video identifiers and timestamps for generated-thumbnail requests |
| Return YouTube Dislike | Configured Return YouTube Dislike operator | IP address, video identifiers, and timing |
| Voice-over translation | Unofficial Yandex voice-over translation service | IP address, YouTube video identifier and URL, video duration, requested output language, and timing |
| Enhanced-privacy sync | Configured sync operator | IP address, OpenTubeX application version from Electron desktop builds, account identifier, authentication data, encrypted payloads, collection names, payload sizes, revisions, event IDs, recipient device IDs, creation and expiry times, and request timing; not the decrypted selected data, activity details, or video requests |
| Legacy sync | Configured sync operator | IP address, OpenTubeX application version from Electron desktop builds, account identifier, authentication data, selected synced data, and timing |
| `yt-dlp` playback and downloads | YouTube or the media site you open, its media hosts, and the configured proxy, if any | IP address, requested page and media resources, media identifiers, formats, and timing. Media hosts also receive the request headers and cookies needed for extracted streams. Configured authentication cookies may identify your account to the relevant site. OpenTubeX's proxy setting is passed to `yt-dlp`. |

Opening an external media link can contact the selected site and its media services directly; selecting Invidious for YouTube metadata does not proxy these other sites. See [external media playback](https://opentubex.org/docs/playback/#play-a-link-from-another-site).

Connectivity checks may run at startup, when returning to the app, after connection changes, or during network recovery. Failed checks are retried while the system reports an internet connection. You can turn them off under Settings > Privacy > Internet connectivity checks.

Voice-over translation is disabled by default. When it is enabled, no translation-service request is made until you request a translation. The separate background-preparation option is also disabled by default; enabling it requests a translation whenever a supported non-live video loads. These requests omit browser credentials and cookies.

HTTPS encrypts request paths and payloads in transit, but DNS providers and network operators may still learn destination hostnames and traffic patterns. A VPN or Tor changes which parties see your direct IP address; it does not prevent the destination service from seeing the request itself.

## Choosing a setup

- To keep app data local, leave synchronization disabled.
- To prevent a sync operator from reading synced data, use a server that supports enhanced-privacy sync and use a separate, strong privacy passphrase.
- To avoid sending requests to optional services, disable internet connectivity checks, SponsorBlock, DeArrow, Return YouTube Dislike, voice-over translation, and synchronization.
- To hide your direct IP address from YouTube or optional services, route the relevant requests through a trusted VPN or Tor and verify the proxy configuration.
