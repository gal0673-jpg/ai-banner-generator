import { useCallback, useState } from 'react'
import { API_BASE_URL, toAbsoluteApiUrl } from '../api.js'
import { axiosErrorMessage } from './ugcHelpers.js'

async function postTempUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  const base = (API_BASE_URL || '').replace(/\/$/, '')
  const res = await fetch(`${base}/upload-temp-asset`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
  })
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const d = data?.detail
    if (typeof d === 'string') throw new Error(d)
    if (Array.isArray(d)) throw new Error(d.map((x) => x.msg || JSON.stringify(x)).join(' '))
    throw new Error(res.statusText || 'ההעלאה נכשלה')
  }
  const u = typeof data?.url === 'string' ? data.url.trim() : ''
  if (!u) throw new Error('לא התקבלה כתובת קובץ מהשרת')
  return toAbsoluteApiUrl(u)
}

/**
 * File uploader for Avatar Studio form.
 *
 * Returns:
 * - uploading states: logoUploading, productUploading, gallerySlotUploading
 * - uploadTempAsset(file, kind, gallerySlotIndex)
 */
export function useFileUploader({
  requiredGalleryImages,
  setSubmitError,
  setLogoUrl,
  setProductImageUrl,
  setCustomGalleryImages,
}) {
  const [logoUploading, setLogoUploading] = useState(false)
  const [productUploading, setProductUploading] = useState(false)
  const [gallerySlotUploading, setGallerySlotUploading] = useState(null)

  const uploadTempAsset = useCallback(
    async (file, kind, gallerySlotIndex) => {
      if (kind === 'gallery') {
        const slotIndex = gallerySlotIndex
        if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex >= requiredGalleryImages) return
        setSubmitError(null)
        setGallerySlotUploading(slotIndex)
        try {
          const url = await postTempUpload(file)
          setCustomGalleryImages((prev) => {
            const next = Array.from({ length: requiredGalleryImages }, (_, i) =>
              typeof prev[i] === 'string' ? prev[i] : '',
            )
            next[slotIndex] = url
            return next
          })
        } catch (err) {
          setSubmitError(axiosErrorMessage(err))
        } finally {
          setGallerySlotUploading(null)
        }
        return
      }

      const setBusy = kind === 'logo' ? setLogoUploading : setProductUploading
      const setUrl = kind === 'logo' ? setLogoUrl : setProductImageUrl
      setSubmitError(null)
      setBusy(true)
      try {
        const url = await postTempUpload(file)
        setUrl(url)
      } catch (err) {
        setSubmitError(axiosErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [
      requiredGalleryImages,
      setCustomGalleryImages,
      setLogoUrl,
      setProductImageUrl,
      setSubmitError,
    ],
  )

  return {
    logoUploading,
    productUploading,
    gallerySlotUploading,
    uploadTempAsset,
  }
}

