export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const smooth = t => t * t * (3 - 2 * t)
export const ease = t => 1 - Math.pow(1 - t, 3)
// CSS ease-in-out used by the reference's 2s arc colour transition.
export function colorEase(t) {
  let lo=0,hi=1,u=t
  for(let i=0;i<18;i++){u=(lo+hi)/2;const x=3*(1-u)*(1-u)*u*.42+3*(1-u)*u*u*.58+u*u*u;if(x<t)lo=u;else hi=u}
  return 3*(1-u)*u*u+u*u*u
}
export const radius = Math.hypot(48, 121)
export const baseAngle = 2 * Math.atan2(48, 121)
export function mapPoint(point, rect) {
  return { x: (point.clientX - rect.left) * 390 / rect.width,
    y: (point.clientY - rect.top) * 310 / rect.height }
}

// One frame loop owns animation, waits and UI delays. Pausing preserves original
// endpoints and elapsed time; cancellation never leaves a pending Promise loop.
export function createGameController({ now = () => Date.now(), request = fn => setTimeout(fn, 16),
  cancel = id => clearTimeout(id), onChange = () => {} } = {}) {
  const state = { phase: 0, tilt: 0, arc: 0, lift: 0, reveal: 0, zoom: 0,
    topReady: false, topHint: 0, blue: 0, paused: false, demo: false, reading: false, review: false,
    copyKey: 0, lessonKey: 'angle', wordVisible: false, textLeaving: false, lessonLeaving: false }
  let jobs = new Map(), frame = null, previous = 0, generation = 0, disposed = false, drag = null, ticking = false
  let wantedCopy = 0, wantedLesson = 'angle', wantedBlue = 0
  function emit() { onChange({ ...state }) }
  function schedule(name, ms, finish, key, to) {
    jobs.set(name, { ms, elapsed: 0, finish, key, from: key ? state[key] : 0, to })
    startLoop()
  }
  function startLoop() {
    if (disposed || state.paused || ticking || frame !== null || !jobs.size) return
    previous = now()
    const ticket = generation
    frame = request(() => tick(ticket))
  }
  function tick(ticket) {
    if (ticket !== generation || disposed || state.paused) return
    frame = null
    ticking = true
    const time = now(), dt = Math.max(0, time - previous)
    previous = time
    // Snapshot: a completion may replace another task; never run that new task
    // with the old frame's delta or invoke a removed callback.
    for (const [name, job] of [...jobs]) {
      if (jobs.get(name) !== job) continue
      job.elapsed = Math.min(job.ms, job.elapsed + dt)
      const t = clamp(job.elapsed / job.ms)
      if (job.key) state[job.key] = job.from + (job.to - job.from) *
        (job.key === 'tilt' || job.key === 'topHint' ? t : job.key === 'blue' ? colorEase(t) : ease(t))
      if (t === 1) { jobs.delete(name); job.finish() }
    }
    updateText(); emit()
    ticking = false
    if (!state.paused && jobs.size) frame = request(() => tick(ticket))
  }
  function updateText() {
    const blue=(state.phase===1 && state.arc===1 && (jobs.has('hint') || state.topReady)) || state.phase===2 || (state.phase===3 && state.reveal<.3) ? 1 : 0
    if(blue!==wantedBlue){wantedBlue=blue;schedule('blue',2000,()=>{},'blue',blue)}
    const k = state.phase === 1 && state.arc === 1 ? (state.topReady ? 7 : 6) :
      state.phase === 2 && state.lift === 1 ? 8 : state.phase
    const lesson = state.phase === 0 ? 'angle' : state.phase === 1 ? 'arc' : state.phase === 2 ? 'arch' : 'archa'
    if (k !== wantedCopy) {
      wantedCopy = k; state.textLeaving = true
      schedule('copy', 190, () => { state.copyKey = k; state.textLeaving = false })
    }
    if (lesson !== wantedLesson) {
      wantedLesson = lesson; state.lessonLeaving = true; state.wordVisible = false; jobs.delete('word')
      schedule('lesson', 200, () => { state.lessonKey = lesson; state.lessonLeaving = false })
      schedule('word', 650, () => { state.wordVisible = true })
    }
  }
  function changed() { updateText(); emit(); startLoop() }
  function clearHint() { jobs.delete('hint'); jobs.delete('topPulse'); state.topReady = false; state.topHint=0 }
  function offerNext() {
    if (state.topReady || jobs.has('hint')) return
    schedule('hint', 2000, () => {
      if (state.phase === 1 && state.arc === 1 && !drag) {
        state.topReady = true
        schedule('topPulse',3250,()=>{},'topHint',1)
      }
    })
  }
  function tween(key, to, ms, finish) { schedule('main', ms, finish, key, to) }
  function afterStep() {
    if (state.demo && state.phase < 5) schedule('main', state.phase === 2 ? 1800 : 900, advance)
    if (state.phase === 5) state.demo = false
    changed()
  }
  function advance() {
    switch (state.phase) {
      case 0: tween('tilt', 1, 2800, () => { state.phase = 1; afterStep() }); break
      case 1:
        if (state.arc < 1) tween('arc', 1, 1300, () => {
          offerNext()
          if (state.demo) schedule('main', 4700 + 900, advance)
          changed()
        })
        else if (state.topReady) {
          clearHint(); state.phase = 2
          tween('lift', 1, 1100, afterStep); changed()
        } else schedule('main', 100, advance)
        break
      case 2:
        if (state.lift < 1) tween('lift', 1, 1100, afterStep)
        else { state.phase = 3; tween('reveal', 1, 1700, afterStep); changed() }
        break
      case 3:
        if (state.reveal < 1) tween('reveal', 1, 1000, () => { state.phase = 4; afterStep() })
        else { state.phase = 4; afterStep() }
        break
      case 4: tween('zoom', 1, 1600, () => { state.phase = 5; afterStep() }); break
      default: state.demo = false
    }
  }
  function pause() {
    generation++
    state.paused = true; drag = null
    if (frame !== null) cancel(frame)
    frame = null; emit()
  }
  function resume() {
    if (disposed || state.reading || state.review) return
    state.paused = false; emit(); startLoop()
  }
  function toggleDemo() {
    if (state.reading || state.review || disposed) return
    if (!state.paused && state.demo) { pause(); return }
    if (state.paused) {
      // Resume an interrupted automatic transition even when it was started
      // manually (A tap / second pull), before scheduling any new demo step.
      resume()
      return
    }
    if (state.phase === 5) reset()
    state.demo = true; state.paused = false
    if (!jobs.has('main')) advance()
    changed()
  }
  function takeOver() {
    jobs.delete('main'); state.demo = false; state.paused = false
  }
  function touchStart(p, id = 0) {
    if (disposed || state.reading || state.review || drag) return false
    const { phase } = state
    if (phase === 0) {
      if (jobs.has('main') || state.paused) return false
      advance(); return true
    }
    // Never manually cancel the rotation or building reveal transition.
    if (phase === 3 && state.reveal < 1) return false
    if (phase === 1) {
      const a = baseAngle + state.arc * (Math.PI - baseAngle)
      if (state.topReady && Math.hypot(p.x - 195, p.y - (230 - radius)) < 32) {
        takeOver(); clearHint(); state.phase = 2
      } else {
        if (Math.hypot(p.x - (195 + radius * Math.cos(a)), p.y - (230 - radius * Math.sin(a))) > 36) return false
        takeOver(); clearHint()
      }
    } else if (phase === 2) {
      if (state.lift === 1 && Math.hypot(p.x - 195, p.y - 50) > 36) return false
      takeOver()
    } else if (phase === 3 || phase === 4) {
      takeOver(); state.phase = 4
    } else return false
    drag = { id, y: p.y, lift: state.lift, zoom: state.zoom, again: state.phase === 2 && state.lift === 1 }
    changed(); return true
  }
  function touchMove(p, id = 0) {
    if (!drag || drag.id !== id) return
    if (drag.again) {
      if (drag.y - p.y > 18) {
        drag = null; state.phase = 3
        tween('reveal', 1, 1700, afterStep); changed()
      }
      return
    }
    if (state.phase === 1) {
      let a = Math.atan2(230 - p.y, p.x - 195)
      if (a < 0) a = p.x < 195 ? Math.PI : 0
      state.arc = clamp((a - baseAngle) / (Math.PI - baseAngle))
    } else if (state.phase === 2) state.lift = clamp(drag.lift + (drag.y - p.y) / 85)
    else if (state.phase === 4) state.zoom = clamp(drag.zoom + (p.y - drag.y) / 135)
    changed()
  }
  function touchEnd(id = 0) {
    if (!drag || drag.id !== id) return
    drag = null
    if (state.phase === 1 && state.arc > .98) { state.arc = 1; offerNext() }
    else if (state.phase === 2 && state.lift > .93) state.lift = 1
    else if (state.phase === 2 && state.lift === 0) { state.phase = 1; state.arc = 1; offerNext() }
    else if (state.phase === 4 && state.zoom > .94) { state.zoom = 1; state.phase = 5 }
    changed()
  }
  function cancelTouch() { drag = null; if (state.phase === 1 && state.arc === 1) offerNext(); changed() }
  function setReading(open) { if (open) pause(); state.reading = open; emit() }
  function setReview(open) {
    if (open && state.phase !== 5) return
    pause(); state.review = open; state.reading = false; emit()
  }
  function reset() {
    generation++; if (frame !== null) cancel(frame); frame = null; jobs.clear(); drag = null
    Object.assign(state, { phase: 0, tilt: 0, arc: 0, lift: 0, reveal: 0, zoom: 0,
      topReady: false, topHint: 0, blue: 0, paused: false, demo: false, reading: false, review: false,
      copyKey: 0, lessonKey: 'angle', wordVisible: false, textLeaving: false, lessonLeaving: false })
    wantedCopy = 0; wantedLesson = 'angle'; wantedBlue=0; emit()
  }
  function destroy() { pause(); disposed = true; generation++; jobs.clear() }
  return { state, pause, resume, toggleDemo, touchStart, touchMove, touchEnd, cancelTouch,
    setReading, setReview, reset, destroy,
    snapshot: () => ({ ...state }), task: () => jobs.get('main') && { ...jobs.get('main'), finish: undefined } }
}
