import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import api, { API_BASE_URL, toAbsoluteApiUrl } from '../api.js'
import {
  ALLOWED_RERENDER_ANIM,
  ALLOWED_RERENDER_FONT,
  ALLOWED_RERENDER_POS,
  UGC_RERENDER_SPEEDS,
  VIDEO_LAYOUTS,
  VIDEO_LAYOUT_FALLBACK_ID,
  VIDEO_LAYOUT_IDS_EXCLUDED_WHEN_SPOKEN_ONLY,
} from './ugcConstants.js'
import { axiosErrorMessage, extractCatalogArray } from './ugcHelpers.js'

export function useUgcFormState({ taskId, statusPayload, isPolling }) {
  const [avatars, setAvatars] = useState([])
  const [voices, setVoices] = useState([])
  const [selectedAvatarDbId, setSelectedAvatarDbId] = useState('')
  const [selectedVoiceDbId, setSelectedVoiceDbId] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)

  const [scriptSource, setScriptSource] = useState('from_brief_ai')
  const [creativeBrief, setCreativeBrief] = useState('')
  const [directorNotes, setDirectorNotes] = useState('')
  const [spokenScript, setSpokenScript] = useState('')
  const [videoLength, setVideoLength] = useState('15s')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const [selectedLayout, setSelectedLayout] = useState(VIDEO_LAYOUTS[0].id)
  const logoFileRef = useRef(null)
  const productFileRef = useRef(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [productUploading, setProductUploading] = useState(false)

  const hydratedScriptKeyRef = useRef('')
  const [rerenderSpeed, setRerenderSpeed] = useState(1.15)
  const [rerenderAnimation, setRerenderAnimation] = useState('pop')
  const [rerenderPosition, setRerenderPosition] = useState('bottom')
  const [rerenderFont, setRerenderFont] = useState('heebo')
  const [draftBrandColor, setDraftBrandColor] = useState('')
  const [rerenderSubmitting, setRerenderSubmitting] = useState(false)
  const [rerenderError, setRerenderError] = useState(null)
  const [pendingAspectRatio, setPendingAspectRatio] = useState(null)
  const [activePreviewAspect, setActivePreviewAspect] = useState(null)

  const [submitError, setSubmitError] = useState(null)
  const [isPosting, setIsPosting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCatalogLoading(true)
    Promise.all([api.get('/catalog/avatars/active'), api.get('/catalog/voices/active')])
      .then(([avRes, voRes]) => {
        if (cancelled) return
        const avList = extractCatalogArray(avRes?.data)
        const voList = extractCatalogArray(voRes?.data)
        // eslint-disable-next-line no-console -- intentional debug for catalog wiring
        console.log('[AvatarStudio] catalog fetch OK', {
          endpoints: ['/catalog/avatars/active', '/catalog/voices/active'],
          avatarsRaw: avRes?.data,
          voicesRaw: voRes?.data,
          avatarsCount: avList.length,
          voicesCount: voList.length,
        })
        setAvatars(avList)
        setVoices(voList)
        if (avList.length > 0) setSelectedAvatarDbId(avList[0].id)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console -- intentional debug for catalog wiring
        console.error('[AvatarStudio] catalog fetch failed', {
          message: err?.message,
          status: err?.response?.status,
          data: err?.response?.data,
        })
        if (!cancelled) {
          setAvatars([])
          setVoices([])
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedAvatarDbId || !Array.isArray(avatars) || avatars.length === 0) return
    const avatar = avatars.find((a) => a.id === selectedAvatarDbId)
    if (!avatar) return
    if (avatar.aspect_ratio) setAspectRatio(avatar.aspect_ratio)
    const safeVoices = Array.isArray(voices) ? voices : []
    const filtered = safeVoices.filter((v) => v.gender === avatar.gender)
    const recommended = filtered.find((v) => v.external_id === avatar.recommended_voice_id)
    if (recommended) setSelectedVoiceDbId(recommended.id)
    else if (filtered.length > 0) setSelectedVoiceDbId(filtered[0].id)
    else setSelectedVoiceDbId(safeVoices[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAvatarDbId, avatars, voices])

  useEffect(() => {
    if (scriptSource !== 'spoken_only') return
    if (!VIDEO_LAYOUT_IDS_EXCLUDED_WHEN_SPOKEN_ONLY.has(selectedLayout)) return
    setSelectedLayout(VIDEO_LAYOUT_FALLBACK_ID)
  }, [scriptSource, selectedLayout])

  useEffect(() => {
    hydratedScriptKeyRef.current = ''
    setDraftBrandColor('')
    setRerenderSpeed(1.15)
    setRerenderAnimation('pop')
    setRerenderPosition('bottom')
    setRerenderFont('heebo')
    setRerenderError(null)
    setActivePreviewAspect(null)
  }, [taskId])

  useEffect(() => {
    if (statusPayload?.ugc_status === 'completed' || statusPayload?.ugc_status === 'failed') {
      setPendingAspectRatio(null)
    }
  }, [statusPayload?.ugc_status])

  useLayoutEffect(() => {
    if (statusPayload?.ugc_status !== 'completed' || !taskId) return
    const key = `${taskId}|${String(statusPayload?.ugc_final_video_url || '')}|${String(statusPayload?.ugc_composited_video_url || '')}|${String(statusPayload?.ugc_raw_video_url || '')}`
    if (hydratedScriptKeyRef.current === key) return
    hydratedScriptKeyRef.current = key
    const st = statusPayload?.ugc_script?.style
    const anim = typeof st?.animation === 'string' && ALLOWED_RERENDER_ANIM.has(st.animation) ? st.animation : 'pop'
    const pos = typeof st?.position === 'string' && ALLOWED_RERENDER_POS.has(st.position) ? st.position : 'bottom'
    const font = typeof st?.font === 'string' && ALLOWED_RERENDER_FONT.has(st.font) ? st.font : 'heebo'
    setRerenderAnimation(anim)
    setRerenderPosition(pos)
    setRerenderFont(font)
    const rawSf = Number(statusPayload?.ugc_speed_factor)
    const nearest = UGC_RERENDER_SPEEDS.map((x) => x.value).reduce(
      (best, v) => (Math.abs(v - rawSf) < Math.abs(best - rawSf) ? v : best),
      1.15,
    )
    setRerenderSpeed(nearest)
    setDraftBrandColor(typeof statusPayload?.brand_color === 'string' ? statusPayload.brand_color.trim() : '')
  }, [
    taskId,
    statusPayload?.ugc_status,
    statusPayload?.ugc_script,
    statusPayload?.ugc_final_video_url,
    statusPayload?.ugc_composited_video_url,
    statusPayload?.ugc_raw_video_url,
    statusPayload?.ugc_speed_factor,
    statusPayload?.brand_color,
  ])

  const selectedAvatar = useMemo(
    () => (Array.isArray(avatars) ? avatars : []).find((a) => a.id === selectedAvatarDbId) ?? null,
    [avatars, selectedAvatarDbId],
  )
  const filteredVoices = useMemo(() => {
    const safeVoices = Array.isArray(voices) ? voices : []
    if (!selectedAvatar) return safeVoices
    return safeVoices.filter((v) => v.gender === selectedAvatar.gender)
  }, [voices, selectedAvatar])
  const selectedVoice = useMemo(
    () => (Array.isArray(filteredVoices) ? filteredVoices : []).find((v) => v.id === selectedVoiceDbId) ?? null,
    [filteredVoices, selectedVoiceDbId],
  )

  const handleUgcRerender = async (ar) => {
    const targetAspect = ar ?? activePreviewAspect ?? aspectRatio ?? '9:16'
    if (!taskId) return
    setRerenderError(null)
    setRerenderSubmitting(true)
    setPendingAspectRatio(targetAspect)
    try {
      const body = {
        speed_factor: rerenderSpeed,
        caption_animation: rerenderAnimation,
        caption_position: rerenderPosition,
        caption_font: rerenderFont,
        aspect_ratio: targetAspect,
      }
      const lu = logoUrl.trim()
      if (lu) body.logo_url = lu
      const pu = productImageUrl.trim()
      if (pu) body.product_image_url = pu
      const bc = draftBrandColor.trim()
      if (bc) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(bc)) {
          throw new Error('צבע מותג חייב להיות בפורמט #RRGGBB (שש ספרות הקסדצימליות)')
        }
        body.brand_color = bc.toUpperCase()
      }
      await api.post(`/tasks/${taskId}/ugc/re-render`, body)
    } catch (err) {
      setRerenderError(axiosErrorMessage(err))
      setPendingAspectRatio(null)
    } finally {
      setRerenderSubmitting(false)
    }
  }

  const uploadTempAsset = async (file, kind) => {
    const setBusy = kind === 'logo' ? setLogoUploading : setProductUploading
    const setUrl = kind === 'logo' ? setLogoUrl : setProductImageUrl
    setSubmitError(null)
    setBusy(true)
    try {
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
      if (u) setUrl(toAbsoluteApiUrl(u))
    } catch (err) {
      setSubmitError(axiosErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedAvatar) {
      setSubmitError('נא לבחור אווטאר לפני שליחה.')
      return
    }
    if (scriptSource === 'from_brief_ai' && !creativeBrief.trim()) {
      setSubmitError('נא למלא בריף קריאייטיבי (או לעבור ל״רק טקסט דיבור״ ולמלא את תיבת הדיבור).')
      return
    }
    if (scriptSource === 'spoken_only' && !spokenScript.trim()) {
      setSubmitError('נא למלא את ״טקסט לדיבור בלבד״ — רק מה שהאווטאר יאמר בעברית.')
      return
    }
    setSubmitError(null)
    setIsPosting(true)
    try {
      const body = {
        script_source: scriptSource,
        provider: selectedAvatar.provider,
        avatar_id: selectedAvatar.external_id,
        video_length: videoLength,
        aspect_ratio: aspectRatio,
      }
      if (selectedVoice) body.voice_id = selectedVoice.external_id
      if (selectedAvatar.provider === 'heygen_elevenlabs' && selectedAvatar.heygen_character_type) {
        body.heygen_character_type = selectedAvatar.heygen_character_type
      }
      const layoutInstruction = `LAYOUT_MODE: ${selectedLayout}`
      if (scriptSource === 'from_brief_ai') {
        body.creative_brief = creativeBrief.trim()
        const dn = directorNotes.trim()
        body.director_notes = dn ? `${dn}\n${layoutInstruction}` : layoutInstruction
      } else {
        body.spoken_script = spokenScript.trim()
        body.director_notes = layoutInstruction
      }
      const wu = websiteUrl.trim()
      if (wu) body.website_url = wu
      const lu = logoUrl.trim()
      if (lu) body.logo_url = lu
      body.product_image_url = productImageUrl.trim() || undefined
      const { data } = await api.post('/avatar-studio/generate', body)
      const id = data?.task_id
      if (!id) throw new Error('לא התקבל מזהה משימה')
      return id
    } catch (err) {
      setSubmitError(axiosErrorMessage(err))
      return null
    } finally {
      setIsPosting(false)
    }
  }

  const formLocked = isPosting || isPolling

  const ugcFinal9_16 =
    typeof statusPayload?.ugc_final_video_url === 'string' ? statusPayload.ugc_final_video_url.trim() : ''
  const ugcFinal1_1 =
    typeof statusPayload?.ugc_final_video_url_1_1 === 'string' ? statusPayload.ugc_final_video_url_1_1.trim() : ''
  const ugcFinal16_9 =
    typeof statusPayload?.ugc_final_video_url_16_9 === 'string' ? statusPayload.ugc_final_video_url_16_9.trim() : ''
  const ugcPipelineBusy = ['processing_video', 'rendering_captions'].includes(statusPayload?.ugc_status)

  const currentVideoUrl = useMemo(() => {
    const c =
      typeof statusPayload?.ugc_composited_video_url === 'string' ? statusPayload.ugc_composited_video_url.trim() : ''
    const r = typeof statusPayload?.ugc_raw_video_url === 'string' ? statusPayload.ugc_raw_video_url.trim() : ''
    if (activePreviewAspect === '16:9') return ugcFinal16_9 || ''
    if (activePreviewAspect === '1:1') return ugcFinal1_1 || ''
    if (activePreviewAspect === '9:16') return ugcFinal9_16 || c || r || ''
    return ugcFinal9_16 || ugcFinal16_9 || ugcFinal1_1 || c || r || ''
  }, [
    activePreviewAspect,
    statusPayload?.ugc_composited_video_url,
    statusPayload?.ugc_raw_video_url,
    ugcFinal9_16,
    ugcFinal1_1,
    ugcFinal16_9,
  ])

  const effectivePreviewAspect =
    activePreviewAspect ?? (ugcFinal9_16 ? '9:16' : ugcFinal16_9 ? '16:9' : ugcFinal1_1 ? '1:1' : null)

  const formatAspectLoading = (ar) =>
    pendingAspectRatio === ar &&
    (rerenderSubmitting ||
      statusPayload?.ugc_status === 'processing_video' ||
      statusPayload?.ugc_status === 'rendering_captions')

  return {
    isPolling,
    avatars,
    voices,
    selectedAvatarDbId,
    setSelectedAvatarDbId,
    selectedVoiceDbId,
    setSelectedVoiceDbId,
    catalogLoading,
    scriptSource,
    setScriptSource,
    creativeBrief,
    setCreativeBrief,
    directorNotes,
    setDirectorNotes,
    spokenScript,
    setSpokenScript,
    videoLength,
    setVideoLength,
    aspectRatio,
    websiteUrl,
    setWebsiteUrl,
    logoUrl,
    setLogoUrl,
    productImageUrl,
    setProductImageUrl,
    selectedLayout,
    setSelectedLayout,
    logoFileRef,
    productFileRef,
    logoUploading,
    productUploading,
    uploadTempAsset,
    selectedAvatar,
    filteredVoices,
    selectedVoice,
    handleSubmit,
    submitError,
    isPosting,
    formLocked,
    rerenderSpeed,
    setRerenderSpeed,
    rerenderAnimation,
    setRerenderAnimation,
    rerenderPosition,
    setRerenderPosition,
    rerenderFont,
    setRerenderFont,
    draftBrandColor,
    setDraftBrandColor,
    rerenderSubmitting,
    rerenderError,
    pendingAspectRatio,
    activePreviewAspect,
    setActivePreviewAspect,
    handleUgcRerender,
    ugcFinal9_16,
    ugcFinal1_1,
    ugcFinal16_9,
    ugcPipelineBusy,
    currentVideoUrl,
    effectivePreviewAspect,
    formatAspectLoading,
  }
}
