import { deflateSync } from 'node:zlib'

import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const FCROP = 'c-fcrop64=1,38000000c7ffffff'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

/** Solid RGB PNG of the requested size for aspect-ratio assertions. */
function solidPng(width, height, rgb = [40, 120, 200]) {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0]
    row[2 + x * 3] = rgb[1]
    row[3 + x * 3] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function imageUrl(id, size) {
  return `https://yt3.ggpht.com/e2e-post-${id}=s${size}-${FCROP}-rw-nd-v1`
}

function thumbnails(id, width, height) {
  return [
    { width, height, url: imageUrl(id, width) },
    { width: Math.round(width / 2), height: Math.round(height / 2), url: imageUrl(id, Math.round(width / 2)) }
  ]
}

function multiImagePost() {
  return {
    postId: 'multi-image-post',
    postText: 'Multi image community post',
    author: 'Channel B',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime: now - 30 * 60000,
    voteCount: 12,
    commentCount: 3,
    postContent: {
      type: 'multiImage',
      content: [
        thumbnails('square-a', 640, 640),
        thumbnails('square-b', 640, 640)
      ]
    },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function singleImagePost() {
  return {
    postId: 'single-image-post',
    postText: 'Single image community post',
    author: 'Channel B',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime: now - 20 * 60000,
    voteCount: 4,
    commentCount: 1,
    postContent: {
      type: 'image',
      content: thumbnails('wide', 800, 450)
    },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

async function stubPostImages(page) {
  await page.route(/yt3\.ggpht\.com\/e2e-post-/, async (route) => {
    const url = route.request().url()
    const sizeMatch = url.match(/=s(\d+)/)
    const size = Number.parseInt(sizeMatch?.[1] ?? '640', 10)
    const isWide = url.includes('e2e-post-wide')
    const width = size
    const height = isWide ? Math.round(size * 450 / 800) : size
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: solidPng(width, height)
    })
  })
}

test.describe('community post images', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        hideSubscriptionsCommunity: false,
        showNewSubscriptionFeed: true,
        useRssFeeds: false,
        listType: 'list',
        uiRoundness: 200
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel B', thumbnail: '' }]
      }],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        communityPosts: [multiImagePost(), singleImagePost()],
        communityPostsTimestamp: new Date(now - 3600000).toISOString()
      }]
    }
  })

  test('keeps carousel crops, shows full single images, and applies UI roundness', async ({ page }) => {
    await stubPostImages(page)

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const multiPost = page.locator('.ft-list-post').filter({ hasText: 'Multi image community post' })
    const singlePost = page.locator('.ft-list-post').filter({ hasText: 'Single image community post' })
    await expect(multiPost).toBeVisible()
    await expect(singlePost).toBeVisible()

    const multiImage = multiPost.locator('img.communityImage').first()
    const singleImage = singlePost.locator('img.communityImage').first()
    await expect(multiImage).toBeVisible()
    await expect(singleImage).toBeVisible()

    // Carousels keep YouTube's square CDN crop; single images drop it.
    await expect(multiImage).toHaveAttribute('src', new RegExp(FCROP))
    await expect(singleImage).not.toHaveAttribute('src', new RegExp(FCROP))

    await expect.poll(async () => multiImage.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
    await expect.poll(async () => singleImage.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)

    const multiMetrics = await multiImage.evaluate((img) => {
      const style = getComputedStyle(img)
      return {
        naturalRatio: img.naturalWidth / img.naturalHeight,
        displayRatio: img.clientWidth / img.clientHeight,
        borderRadius: style.borderRadius
      }
    })
    const singleMetrics = await singleImage.evaluate((img) => {
      return {
        naturalRatio: img.naturalWidth / img.naturalHeight,
        displayRatio: img.clientWidth / img.clientHeight
      }
    })

    // uiRoundness 200 → --ui-roundness: 2 → 8px * 2 = 16px
    expect(multiMetrics.borderRadius).toBe('16px')
    expect(multiMetrics.displayRatio).toBeCloseTo(multiMetrics.naturalRatio, 2)
    expect(multiMetrics.naturalRatio).toBeCloseTo(1, 2)
    expect(singleMetrics.displayRatio).toBeCloseTo(singleMetrics.naturalRatio, 2)
    expect(singleMetrics.naturalRatio).toBeCloseTo(800 / 450, 2)

    // Carousel chrome should sit on the image, not in a tall empty gap below it.
    const carouselLayout = await multiPost.locator('swiper-container.sliderContainer').evaluate((container) => {
      const image = container.querySelector('img.communityImage')
      const pagination = container.shadowRoot?.querySelector('.swiper-pagination')
      return {
        containerHeight: container.getBoundingClientRect().height,
        imageHeight: image.getBoundingClientRect().height,
        paginationBottom: pagination?.getBoundingClientRect().bottom ?? null,
        containerBottom: container.getBoundingClientRect().bottom
      }
    })

    expect(carouselLayout.containerHeight).toBeLessThan(carouselLayout.imageHeight * 1.35)
    if (carouselLayout.paginationBottom != null) {
      expect(carouselLayout.paginationBottom).toBeLessThanOrEqual(carouselLayout.containerBottom + 1)
    }
  })
})
