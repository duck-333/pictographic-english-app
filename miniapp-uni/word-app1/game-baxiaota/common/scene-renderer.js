import { clamp, smooth, radius, baseAngle } from './game-controller.js'
const lerp = (a, b, t) => a + (b - a) * t
const INK = '#123F60', ORANGE = '#ed8000'

// SVG endpoint arcs in the reference are circular and unrotated. Convert to
// Canvas center arcs rather than sampling the curve into a polygon.
export function tracePath(ctx, data) {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) || []
  let i = 0, command, x = 0, y = 0, sx = 0, sy = 0
  const number = () => Number(tokens[i++])
  ctx.beginPath()
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++]
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M': case 'L': {
        const nx = number() + (relative ? x : 0), ny = number() + (relative ? y : 0)
        if (command.toUpperCase() === 'M') { ctx.moveTo(nx, ny); sx = nx; sy = ny; command = relative ? 'l' : 'L' }
        else ctx.lineTo(nx, ny)
        x = nx; y = ny; break
      }
      case 'H': x = number() + (relative ? x : 0); ctx.lineTo(x, y); break
      case 'V': y = number() + (relative ? y : 0); ctx.lineTo(x, y); break
      case 'Q': {
        const bx = x, by = y, cx = number() + (relative ? bx : 0), cy = number() + (relative ? by : 0)
        x = number() + (relative ? bx : 0); y = number() + (relative ? by : 0)
        ctx.quadraticCurveTo(cx, cy, x, y); break
      }
      case 'A': {
        let r = number(); number(); number()
        const large = number(), sweep = number(), nx = number() + (relative ? x : 0), ny = number() + (relative ? y : 0)
        const dx = (x - nx) / 2, dy = (y - ny) / 2, distance = Math.hypot(dx, dy)
        if (distance < 1e-8) { x = nx; y = ny; break }
        r = Math.max(r, distance)
        const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, r * r / (distance * distance) - 1))
        const cx = (x + nx) / 2 + f * dy, cy = (y + ny) / 2 - f * dx
        ctx.arc(cx, cy, r, Math.atan2(y - cy, x - cx), Math.atan2(ny - cy, nx - cx), !sweep)
        x = nx; y = ny; break
      }
      case 'Z': ctx.closePath(); x = sx; y = sy; command = null; break
      default: throw new Error('Unsupported path command: ' + command)
    }
  }
}

export function sceneGeometry(state) {
  const { phase, tilt, arc, lift, reveal, zoom } = state
  const shapes = []
  const shape = (d, color, width, opacity = 1, fill = false) => shapes.push({ d, color, width, opacity, fill })
  let cx = 195, r = radius, ang = baseAngle + arc * (Math.PI - baseAngle)
  let x = cx + r * Math.cos(ang), y = 230 - r * Math.sin(ang), hx = x, hy = y, handle = 1
  let curve = '', legs = '', structure = '', sector = '', curveAlpha = 1
  if (phase === 0) {
    const turn = smooth(clamp(tilt / .38)), shift = smooth(clamp((tilt - .42) / .2))
    const blue = smooth(clamp((tilt - .66) / .16)), fade = smooth(clamp((tilt - .84) / .16))
    const theta = -(Math.PI / 2 + Math.atan2(48, 121)) * turn
    const full = -(Math.PI / 2 + Math.atan2(48, 121))
    const dx = -68 * Math.sin(full) * shift, dy = (74 + 68 * Math.cos(full)) * shift
    const rot = (px, py) => ({ x: 195 + (px - 195) * Math.cos(theta) - (py - 156) * Math.sin(theta) + dx,
      y: 156 + (px - 195) * Math.sin(theta) + (py - 156) * Math.cos(theta) + dy })
    const a = rot(195, 88), b = rot(147, 209), c = rot(243, 209), l = rot(164, 166.15), rr = rot(226, 166.15)
    const p = v => `${v.x} ${v.y}`
    shape(`M${p(b)} L${p(a)} L${p(c)} M${p(l)} L${p(rr)}`, INK, 3, 1 - fade)
    structure = `M${p(b)} L${p(a)} L${p(c)}`
    sector = `M${p(a)} L${p(b)} A${r} ${r} 0 0 0 ${p(c)} Z`
    curve = `M${p(b)} A${r} ${r} 0 0 0 ${p(c)}`
    shape(sector, '#66d5ef', 0, .18 * blue, true)
    shape(`M${p(a)} h52 A52 52 0 0 0 ${a.x + 52 * Math.cos(baseAngle)} ${a.y - 52 * Math.sin(baseAngle)} Z`, '#38aeca', 1.5, .3 * blue, true)
    shape(structure, INK, 2.5, fade)
    curveAlpha = blue; hx = fade < .5 ? a.x : c.x; hy = fade < .5 ? a.y : c.y
    handle = fade < .5 ? 1 - fade * 2 : (fade - .5) * 2
  } else if (phase === 1) {
    curve = `M${195 + r} 230 A${r} ${r} 0 0 0 ${x} ${y}`
    structure = `M195 230 L${195 + r} 230 M195 230 L${x} ${y}`
    sector = `M195 230 L${195 + r} 230 A${r} ${r} 0 0 0 ${x} ${y} Z`
    shape(sector, '#66d5ef', 0, .18 * (1 - smooth(clamp((arc - .85) / .15))), true)
    shape(structure, INK, 2.5)
    shape(`M195 230 h52 A52 52 0 0 0 ${195 + 52 * Math.cos(ang)} ${230 - 52 * Math.sin(ang)} Z`, '#38aeca', 1.5, .3 * (1 - smooth(clamp((arc - .75) / .25))), true)
  } else {
    const blend = smooth(reveal)
    cx = lerp(195, 191, blend); r = lerp(radius, 54, blend)
    const top = lerp(100 - 50 * lift, 119, blend), bottom = lerp(230, 264, blend), shoulder = top + r
    curve = `M${cx - r} ${shoulder} A${r} ${r} 0 0 1 ${cx + r} ${shoulder}`
    legs = `M${cx - r} ${bottom} L${cx - r} ${shoulder} M${cx + r} ${shoulder} L${cx + r} ${bottom}`
    hx = cx; hy = top
    shape(`M${cx - r} ${bottom} H${cx + r}`, INK, 2.5, 1 - blend)
  }
  const blueT = state.blue
  const rgb = [237, 128, 0].map((v, i) => Math.round(lerp(v, [18, 63, 96][i], blueT)))
  curveAlpha *= 1 - smooth(clamp(zoom / .65))
  shape(curve, `rgb(${rgb.join(',')})`, 4.5, curveAlpha)
  if (legs) shape(legs, ORANGE, 4.5, curveAlpha)
  return { shapes, hx, hy, handle: handle * (1 - smooth(clamp((reveal - .65) / .35))), ang,
    gateOpacity: smooth(clamp((reveal - .3) / .7)), farOpacity: smooth(clamp((zoom - .3) / .7)),
    compositionScale: 1 + .2 * smooth(zoom), travel: smooth(zoom) }
}

export function renderScene(ctx, canvas, state, images) {
  const g = sceneGeometry(state)
  ctx.setTransform(canvas.width / 390, 0, 0, canvas.height / 310, 0, 0)
  ctx.clearRect(0, 0, 390, 310)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.save(); ctx.translate(195, 180); ctx.scale(g.compositionScale, g.compositionScale); ctx.translate(-195, -180)
  ctx.save(); ctx.translate(75.7614 * g.travel, 77 * g.travel)
  const z = lerp(1, 77 / 285, g.travel); ctx.scale(z, z)
  if (images.gate) { ctx.globalAlpha = g.gateOpacity; ctx.drawImage(images.gate, 49, 0, 285, 301) }
  for (const s of g.shapes) {
    if (!s.d || s.opacity <= 0) continue
    ctx.globalAlpha = s.opacity; tracePath(ctx, s.d); ctx.fillStyle = s.color; ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    if (s.fill) ctx.fill()
    if (s.width) ctx.stroke()
  }
  const handle = (x, y, alpha) => {
    ctx.globalAlpha = alpha * .09; ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = alpha; ctx.fillStyle = '#fff'; ctx.strokeStyle = ORANGE; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  handle(g.hx, g.hy, g.handle)
  if (state.phase === 1 && state.topReady) {
    const elapsed=state.topHint*3250
    const pulse=elapsed<650 || elapsed>=3250 ? 1 : 1-.75*Math.sin(Math.PI*((elapsed-650)%1300)/1300)**2
    handle(195,100,Math.min(1,elapsed/650)*pulse)
  }
  ctx.restore()
  // Exact vector reference (342x274) offset by (24,13), clipped like the SVG.
  ctx.save(); ctx.translate(24, 13); ctx.beginPath(); ctx.rect(0, 0, 342, 274); ctx.clip(); ctx.globalAlpha = g.farOpacity
  ctx.fillStyle = '#FFC07C'; ctx.beginPath(); ctx.ellipse(105, 148.5, 22, 5.5, 0, 0, 2 * Math.PI); ctx.fill()
  ctx.fillStyle = '#FF8500'; ctx.beginPath(); ctx.ellipse(105, 148, 7, 3, 0, 0, 2 * Math.PI); ctx.fill()
  tracePath(ctx, 'M105 147V122L121 127L105 132'); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#FF8500'; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(125.814, 157.387); ctx.bezierCurveTo(161.375,176.878,176.048,176.479,163.314,211.294)
  ctx.bezierCurveTo(150.581,246.109,180.227,253.034,214.314,272.293); ctx.bezierCurveTo(248.402,291.552,278.359,300.759,268.313,368.293)
  ctx.moveTo(113.581,157.387); ctx.bezierCurveTo(167.221,197.794,120.995,188.096,119.314,231.294)
  ctx.bezierCurveTo(117.634,274.492,119.314,292.294,173.814,315.294); ctx.strokeStyle = '#DCE9F0'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore()
  ctx.globalAlpha = 1; ctx.font = '22px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = ORANGE
  const label = (text, x, y, opacity = 1) => { ctx.globalAlpha = opacity; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeText(text, x, y); ctx.fillText(text, x, y) }
  if (state.phase === 1 && state.arc > .005 && state.arc < 1) {
    label('a',205,214); label('r',195+76*Math.cos(g.ang)+14*Math.sin(g.ang),230-76*Math.sin(g.ang)+14*Math.cos(g.ang))
    const a = Math.min(g.ang*.6,Math.PI*.36); label('c',195+(radius+20)*Math.cos(a),230-(radius+20)*Math.sin(a))
  }
  if (state.phase === 2 && state.lift > .005 && state.lift < 1) { label('h',46,236-25*state.lift); label('h',344,236-25*state.lift) }
  if (state.phase >= 4) label('a',171,159,smooth(clamp((state.zoom-.3)/.5)))
  ctx.restore()
  const opacity = state.phase === 0 ? 1-smooth(clamp(state.tilt/.2)) :
    state.phase === 2 && state.lift === 1 ? 1 : (state.phase === 3 || state.phase === 4) && state.reveal === 1 ? 1-smooth(clamp(state.zoom/.18)) : 0
  ctx.globalAlpha = opacity; ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5; ctx.setLineDash([4,6])
  tracePath(ctx,state.phase>=3?'M191 157 V265':state.phase===2?'M195 200 V77':'M281 179 Q292 109 250 78'); ctx.stroke()
  ctx.setLineDash([]); ctx.fillStyle = ORANGE
  tracePath(ctx,state.phase>=3?'M191 265 L186 258 L196 258 Z':state.phase===2?'M195 77 L190 84 L200 84 Z':'M250 78 L252 89 L261 80 Z'); ctx.fill()
  ctx.globalAlpha = 1
}
