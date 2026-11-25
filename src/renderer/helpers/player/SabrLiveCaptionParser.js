import shaka from 'shaka-player'

/** The WebVTT caption format of live streams; their other caption formats use YouTube's own XML */
export const SABR_LIVE_CAPTION_ITAG = 387

/** YouTube's MIME type for the caption formats, with no codecs that would tell them apart */
export const SABR_LIVE_CAPTION_MIME_TYPE = 'text/mp4'

/**
 * Parses the live caption segments of SABR. They are fragmented MP4 like the
 * media segments, and each sample is a complete WebVTT document whose
 * X-TIMESTAMP-MAP places its cues on the media timeline, as in HLS.
 * @implements {shaka.extern.TextParser}
 */
export class SabrLiveCaptionParser {
  constructor() {
    /** @private */
    this._vttParser = new shaka.text.VttTextParser()
    // The WebVTT parser only applies X-TIMESTAMP-MAP to HLS
    this._vttParser.setManifestType('HLS')
  }

  /**
   * Each segment initializes itself, and the cues need nothing from its sample description.
   * @param {Uint8Array} _data
   */
  parseInit(_data) {
  }

  /**
   * @param {string} _manifestType
   */
  setManifestType(_manifestType) {
  }

  /**
   * @param {Uint8Array} data
   * @param {shaka.extern.TextParser.TimeContext} time
   * @param {?string} uri
   * @param {Array<string>} images
   * @returns {shaka.text.Cue[]}
   */
  parseMedia(data, time, uri, images) {
    /** @type {Uint8Array[]} */
    const documents = []

    new shaka.util.Mp4Parser()
      .box('mdat', shaka.util.Mp4Parser.allData(document => documents.push(document)))
      .parse(data, /* partialOkay= */ false)

    return documents
      // Segments without captions have an empty sample
      .filter(document => document.length > 0)
      .flatMap(document => this._vttParser.parseMedia(document, time, uri, images))
  }
}

if (process.env.SUPPORTS_LOCAL_API) {
  shaka.text.TextEngine.registerParser(SABR_LIVE_CAPTION_MIME_TYPE, () => new SabrLiveCaptionParser())
}
