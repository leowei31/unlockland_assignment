import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXPORT_URL =
  'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-parcel-polygons/exports/geojson'
const MAX_RETRIES = 4
const RETRY_BASE_DELAY_MS = 600
const DOWNLOAD_PROGRESS_STEP_PERCENT = 5
const DOWNLOAD_PROGRESS_STEP_BYTES = 5 * 1024 * 1024
const NORMALIZE_PROGRESS_STEP = 10000

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  const digits = power === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[power]}`
}

async function readResponseTextWithProgress(response, label) {
  const totalBytes = Number(response.headers.get('content-length') ?? '')
  if (!response.body) {
    return await response.text()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let downloadedBytes = 0
  let nextPercentMilestone = DOWNLOAD_PROGRESS_STEP_PERCENT
  let nextByteMilestone = DOWNLOAD_PROGRESS_STEP_BYTES

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    downloadedBytes += value.byteLength
    chunks.push(decoder.decode(value, { stream: true }))

    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      const percent = Math.floor((downloadedBytes / totalBytes) * 100)
      if (percent >= nextPercentMilestone) {
        console.log(
          `[${label}] download ${percent}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`,
        )
        while (percent >= nextPercentMilestone) {
          nextPercentMilestone += DOWNLOAD_PROGRESS_STEP_PERCENT
        }
      }
    } else if (downloadedBytes >= nextByteMilestone) {
      console.log(`[${label}] downloaded ${formatBytes(downloadedBytes)}...`)
      nextByteMilestone += DOWNLOAD_PROGRESS_STEP_BYTES
    }
  }

  chunks.push(decoder.decode())

  if (Number.isFinite(totalBytes) && totalBytes > 0) {
    console.log(
      `[${label}] download 100% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`,
    )
  } else {
    console.log(`[${label}] downloaded ${formatBytes(downloadedBytes)} total.`)
  }

  return chunks.join('')
}

async function fetchJsonWithRetry(url, label) {
  let attempt = 0
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      const text = await readResponseTextWithProgress(response, label)
      console.log(`[${label}] parsing JSON...`)
      return JSON.parse(text)
    } catch (error) {
      attempt += 1
      if (attempt > MAX_RETRIES) {
        throw new Error(`${label} failed after ${MAX_RETRIES + 1} attempts: ${String(error)}`)
      }
      const delayMs = RETRY_BASE_DELAY_MS * attempt
      console.warn(`${label} failed (attempt ${attempt}/${MAX_RETRIES + 1}). Retrying in ${delayMs}ms...`)
      await sleep(delayMs)
    }
  }

  throw new Error(`Unexpected retry failure for ${label}.`)
}

function toFeature(rawFeature) {
  const geometry = rawFeature?.geometry
  const properties = rawFeature?.properties ?? {}

  if (!geometry || geometry.type !== 'Polygon') {
    return null
  }

  const lon = Number(properties?.geo_point_2d?.lon)
  const lat = Number(properties?.geo_point_2d?.lat)
  if (Number.isNaN(lon) || Number.isNaN(lat)) {
    return null
  }

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: String(properties.site_id ?? `${properties.tax_coord ?? ''}-${properties.civic_number ?? ''}`),
      siteId: String(properties.site_id ?? ''),
      taxCoord: String(properties.tax_coord ?? ''),
      civicNumber: String(properties.civic_number ?? ''),
      streetName: String(properties.streetname ?? ''),
      fullAddress: `${String(properties.civic_number ?? '').trim()} ${String(properties.streetname ?? '').trim()}`.trim(),
      lon,
      lat,
    },
  }
}

async function main() {
  const payload = await fetchJsonWithRetry(EXPORT_URL, 'full geojson export')
  const rawFeatures = Array.isArray(payload?.features) ? payload.features : []
  console.log(`Normalizing ${rawFeatures.length} records...`)

  const features = []
  let skippedCount = 0

  for (let index = 0; index < rawFeatures.length; index += 1) {
    const rawFeature = rawFeatures[index]
    const feature = toFeature(rawFeature)
    if (!feature || !feature.properties.id) {
      skippedCount += 1
    } else {
      features.push(feature)
    }

    const processed = index + 1
    if (processed % NORMALIZE_PROGRESS_STEP === 0 || processed === rawFeatures.length) {
      const percent = Math.floor((processed / Math.max(rawFeatures.length, 1)) * 100)
      console.log(`[normalization] ${percent}% (${processed}/${rawFeatures.length})`)
    }
  }

  features.sort((a, b) => a.properties.fullAddress.localeCompare(b.properties.fullAddress))

  const featureCollection = {
    type: 'FeatureCollection',
    features,
  }

  const searchIndex = features.map((feature) => ({
    id: feature.properties.id,
    address: feature.properties.fullAddress,
    lon: feature.properties.lon,
    lat: feature.properties.lat,
    streetName: feature.properties.streetName,
  }))

  const outputDir = resolve(process.cwd(), 'public', 'data')
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, 'parcels.geojson'), `${JSON.stringify(featureCollection)}\n`, 'utf8')
  await writeFile(resolve(outputDir, 'search-index.json'), `${JSON.stringify(searchIndex)}\n`, 'utf8')

  console.log(`Done. Downloaded ${rawFeatures.length} raw records.`)
  console.log(`Wrote ${features.length} normalized parcel polygons.`)
  console.log(`Skipped ${skippedCount} records due to missing/unsupported geometry or invalid coordinates.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
