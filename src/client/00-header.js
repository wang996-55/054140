/**
 * Client half of the AI 爆款图复刻 bundle (v2.0.0).
 *
 * Everything runs inside this page: the home form, the scene review, the local
 * cutout + mask editor, the background review, the Canvas workbench and the
 * export/accept gates. The Host owns storage, relay calls, schema checks and the
 * authoritative composite; this file never sees the API key.
 *
 * Built from src/client/*.js by scripts/build-client.mjs — edit the parts, not
 * the generated file.
 */
window.__ModuleLoader__.load({
  id: '@local/ai-replica',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const API = '/api/ai-replica'
    const LS_DRAFT = 'rep.draft.v2'
    const LS_LAST_TASK = 'rep.lastTask.v2'
    const LS_VIEW = 'rep.view.v2'
    const PRODUCT_EDGE = 1600
    const STAGES = ['created', 'analyzing', 'scene_review', 'mask_review', 'background_review', 'editing', 'exporting', 'done']
    const ACTIVE_STATES = ['analyzing', 'exporting']

    // One keyframe rule, injected once; the tokens handle every colour.
    try {
      if (!document.getElementById('ai-replica-style')) {
        const style = document.createElement('style')
        style.id = 'ai-replica-style'
        style.textContent = '@keyframes rep-spin{to{transform:rotate(360deg)}}'
        document.head.appendChild(style)
      }
    } catch {
      // head may be unavailable in a test harness
    }
