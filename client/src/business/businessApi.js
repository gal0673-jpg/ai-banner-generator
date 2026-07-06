import api from '../api.js'

/**
 * Thin client for the business-profile + banner-generation endpoints used by
 * the unified "create asset" flow. Cookie auth is handled by the shared axios
 * instance (withCredentials).
 */

export async function listProfiles() {
  const { data } = await api.get('/business/profiles')
  return data
}

export async function getProfile(id) {
  const { data } = await api.get(`/business/profiles/${id}`)
  return data
}

export async function createProfile(payload) {
  const { data } = await api.post('/business/profiles', payload)
  return data
}

export async function updateProfile(id, patch) {
  const { data } = await api.put(`/business/profiles/${id}`, patch)
  return data
}

export async function deleteProfile(id) {
  await api.delete(`/business/profiles/${id}`)
}

/**
 * Kick off a one-time website scan. Returns the profile with scan_status
 * 'scanning'; poll getProfile(id) until it becomes 'ready' or 'failed'.
 */
export async function scanProfile({ websiteUrl, profileId = null, name = null }) {
  const { data } = await api.post('/business/profiles/scan', {
    website_url: websiteUrl,
    profile_id: profileId,
    name,
  })
  return data
}

/** Poll a profile until scan_status leaves 'scanning' (or a timeout elapses). */
export async function pollProfileUntilScanned(id, { intervalMs = 2500, timeoutMs = 180000 } = {}) {
  const deadline = Date.now() + timeoutMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const profile = await getProfile(id)
    if (profile.scan_status !== 'scanning') return profile
    if (Date.now() > deadline) return profile
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** Generate a banner from a saved profile (backend skips the crawl). */
export async function generateBannerFromProfile({ profileId, brief = null }) {
  const { data } = await api.post('/generate', {
    business_profile_id: profileId,
    brief: brief || null,
  })
  return data.task_id
}

/** Generate instant marketing copy from a saved profile (no render). */
export async function generateCopyFromProfile({ profileId, goal = null }) {
  const { data } = await api.post('/business/copy', {
    business_profile_id: profileId,
    goal: goal || null,
  })
  return data
}

/** Generate a marketing video from a saved profile (smart defaults on the server). */
export async function generateVideoFromProfile({ profileId, goal = null, videoLength = '30s' }) {
  const { data } = await api.post('/business/video', {
    business_profile_id: profileId,
    goal: goal || null,
    video_length: videoLength,
  })
  return data.task_id
}

export async function getTaskStatus(taskId) {
  const { data } = await api.get(`/status/${taskId}`)
  return data
}

/** Poll a generation task until it completes or fails. */
export async function pollTaskUntilDone(taskId, { intervalMs = 2000, timeoutMs = 300000, onUpdate } = {}) {
  const deadline = Date.now() + timeoutMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await getTaskStatus(taskId)
    if (onUpdate) onUpdate(status)
    if (status.status === 'completed' || status.status === 'failed') return status
    if (Date.now() > deadline) return status
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/**
 * Poll a video (avatar-studio) task. Progress is tracked on ``ugc_status`` — the
 * top-level ``status`` stays 'pending' for this pipeline. Video renders can take
 * minutes, so the timeout is generous.
 */
export async function pollVideoUntilDone(taskId, { intervalMs = 3000, timeoutMs = 1200000, onUpdate } = {}) {
  const deadline = Date.now() + timeoutMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await getTaskStatus(taskId)
    if (onUpdate) onUpdate(status)
    const s = status.ugc_status
    if (s === 'completed' || s === 'failed' || status.status === 'failed') return status
    if (Date.now() > deadline) return status
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
