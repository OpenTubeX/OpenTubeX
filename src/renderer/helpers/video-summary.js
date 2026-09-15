import { YTNodes } from 'youtubei.js'

/** Extract YouTube's summary of the current video, excluding recommendations. */
export function parseLocalVideoSummary(videoInfo) {
  const next = videoInfo.page?.[1]
  const contents = next?.contents
  const node = contents?.is_node ? contents.item() : null
  const watch = node?.is(YTNodes.TwoColumnWatchNextResults) ? node : null
  const description = next?.engagement_panels?.find(panel =>
    panel.panel_identifier === 'engagement-panel-structured-description'
  )?.content
  const items = [...(watch?.results ?? []), ...(description?.items ?? [])]
  const summary = items.find(item =>
    item.type === 'ExpandableMetadata' && item.expanded_content?.type === 'VideoSummaryContentView'
  )?.expanded_content

  return summary?.paragraphs.map(paragraph => paragraph.text?.text?.trim())
    .filter(text => typeof text === 'string' && text.length > 0) ?? []
}
