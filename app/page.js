'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

const STYLES = [
  { id: 'warm',     label: 'Warm',     emoji: '🌙', desc: 'Smooth & velvety',   detune: -80,  sat: 0.04, eq: [[280,5],[1200,3],[7000,-3]], comp: [-22,4,0.06,0.4],  rev: [1.8, 0.22] },
  { id: 'bright',   label: 'Bright',   emoji: '⚡', desc: 'Forward & punchy',   detune: 120,  sat: 0.18, eq: [[120,0],[3000,6],[12000,5]], comp: [-14,8,0.002,0.15], rev: [0.6, 0.10] },
  { id: 'airy',     label: 'Airy',     emoji: '🕊', desc: 'Ethereal & light',   detune: 250,  sat: 0.02, eq: [[220,0],[4500,5],[9000,6]],  comp: [-28,2,0.04,0.5],   rev: [3.0, 0.38] },
  { id: 'gritty',   label: 'Gritty',   emoji: '🔥', desc: 'Raw & soulful',      detune: -40,  sat: 0.55, eq: [[90,0],[900,5],[2800,3]],   comp: [-18,6,0.008,0.25], rev: [1.2, 0.18] },
  { id: 'robotic',  label: 'Robotic',  emoji: '🤖', desc: 'Clinical & precise', detune: 0,    sat: 0.08, eq: [[160,0],[2000,4],[5000,6]],  comp: [-8,20,0.001,0.08], rev: [0.3, 0.06] },
  { id: 'man',      label: 'Man',      emoji: '👨', desc: 'Deep & full-bodied',  detune: -400, sat: 0.12, eq: [[80,6],[300,4],[3000,-2]],  comp: [-20,5,0.01,0.3],   rev: [1.0, 0.14] },
  { id: 'woman',    label: 'Woman',    emoji: '👩', desc: 'Bright & expressive', detune: 250,  sat: 0.06, eq: [[200,0],[2500,4],[8000,5]],  comp: [-24,3,0.03,0.4],   rev: [1.4, 0.20] },
  { id: 'child',    label: 'Child',    emoji: '🧒', desc: 'High & light',        detune: 600,  sat: 0.01, eq: [[300,0],[4000,5],[10000,7]], comp: [-28,2,0.05,0.5],   rev: [0.8, 0.16] },
]

const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function Home() {
  const [step, setStep] = useState('idle') // idle | recording | recorded | processing | done
  const [style, setStyle] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(null) // null | 'original' | 'processed'

  const audioCtx = useRef(null)
  const mediaRecorder = useRef(null)
  const chunks = useRef([])
  const originalBuf = useRef(null)
  const processedBuf = useRef(null)
  const playNode = useRef(null)
  const analyser = useRef(null)
  const timerRef = useRef(null)
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const waveRef = useRef([])

  const getCtx = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume()
    return audioCtx.current
  }

  const drawBars = useCallback((data) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    if (!data || data.length === 0) {
      ctx.fillStyle = '#222'
      ctx.fillRect(0, h/2 - 1, w, 2)
      return
    }
    const bw = w / data.length
    data.forEach((v, i) => {
      const bh = Math.max(2, v * h * 0.9)
      ctx.fillStyle = `rgba(255,255,255,${0.3 + v * 0.7})`
      ctx.fillRect(i * bw, h/2 - bh/2, Math.max(1, bw - 1), bh)
    })
  }, [])

  const stopPlay = () => {
    if (playNode.current) { try { playNode.current.stop() } catch(e){} playNode.current = null }
    cancelAnimationFrame(animRef.current)
    setPlaying(null)
    drawBars(processedBuf.current ? downsample(processedBuf.current) : waveRef.current)
  }

  const downsample = (buf) => {
    const data = buf.getChannelData(0)
    const pts = 120
    const step = Math.floor(data.length / pts)
    return Array.from({length: pts}, (_, i) => {
      let max = 0
      for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i*step+j]||0))
      return max
    })
  }

  const startPlay = async (which) => {
    if (playing) { stopPlay(); return }
    const ctx = getCtx()
    const buf = which === 'processed' ? processedBuf.current : originalBuf.current
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const an = ctx.createAnalyser()
    an.fftSize = 256
    src.connect(an)
    an.connect(ctx.destination)
    analyser.current = an
    playNode.current = src
    setPlaying(which)
    src.start(0)
    src.onended = () => { setPlaying(null); drawBars(downsample(buf)) }

    const tick = () => {
      const d = new Uint8Array(an.frequencyBinCount)
      an.getByteTimeDomainData(d)
      const pts = Array.from({length: 60}, (_, i) => {
        const idx = Math.floor(i * d.length / 60)
        return Math.abs((d[idx] - 128) / 128)
      })
      drawBars(pts)
      animRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const startRecording = async () => {
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }) }
    catch(e) { alert('Microphone access required'); return }

    const ctx = getCtx()
    chunks.current = []
    waveRef.current = []

    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser()
    an.fftSize = 256
    src.connect(an)
    analyser.current = an

    setStep('recording')
    setElapsed(0)
    const t0 = Date.now()
    timerRef.current = setInterval(() => {
      const s = (Date.now() - t0) / 1000
      setElapsed(s)
      if (s >= 60) stopRecording()
    }, 100)

    const tickWave = () => {
      if (step === 'done') return
      const d = new Uint8Array(an.frequencyBinCount)
      an.getByteTimeDomainData(d)
      const rms = Math.sqrt(d.reduce((a,v) => a + ((v-128)/128)**2, 0) / d.length)
      waveRef.current.push(rms)
      drawBars(waveRef.current.slice(-120))
      animRef.current = requestAnimationFrame(tickWave)
    }
    tickWave()

    mediaRecorder.current = new MediaRecorder(stream)
    mediaRecorder.current.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
    mediaRecorder.current.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      src.disconnect()
      cancelAnimationFrame(animRef.current)
      const blob = new Blob(chunks.current, { type: 'audio/webm' })
      const arr = await blob.arrayBuffer()
      originalBuf.current = await getCtx().decodeAudioData(arr)
      drawBars(downsample(originalBuf.current))
      setStep('recorded')
    }
    mediaRecorder.current.start(100)
  }

  const stopRecording = () => {
    clearInterval(timerRef.current)
    cancelAnimationFrame(animRef.current)
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop()
  }

  const process = async () => {
    if (!originalBuf.current || !style) return
    if (playing) stopPlay()
    setStep('processing')
    await new Promise(r => setTimeout(r, 30))

    const s = style
    const orig = originalBuf.current
    const rate = orig.sampleRate
    const off = new OfflineAudioContext(1, Math.ceil(rate * (orig.duration + 2.5)), rate)

    const src = off.createBufferSource()
    src.buffer = orig
    src.detune.value = s.detune

    let last = src
    s.eq.forEach(([freq, gain], i) => {
      const f = off.createBiquadFilter()
      f.type = i === 0 ? 'highpass' : 'peaking'
      f.frequency.value = freq
      f.gain.value = gain || 0
      f.Q.value = 1.2
      last.connect(f)
      last = f
    })

    const shaper = off.createWaveShaper()
    const k = s.sat * 200
    const curve = new Float32Array(256)
    for (let i = 0; i < 256; i++) { const x = (i*2)/256-1; curve[i] = k > 0 ? ((3+k)*x*20*(Math.PI/180))/(Math.PI+k*Math.abs(x)) : x }
    shaper.curve = curve
    shaper.oversample = '4x'
    last.connect(shaper)

    const [thresh, ratio, attack, release] = s.comp
    const comp = off.createDynamicsCompressor()
    comp.threshold.value = thresh
    comp.ratio.value = ratio
    comp.attack.value = attack
    comp.release.value = release
    shaper.connect(comp)

    const [revDur, revMix] = s.rev
    const convolver = off.createConvolver()
    const irLen = Math.floor(rate * revDur)
    const ir = off.createBuffer(1, irLen, rate)
    const irData = ir.getChannelData(0)
    for (let i = 0; i < irLen; i++) irData[i] = (Math.random()*2-1) * Math.pow(1 - i/irLen, 2.5)
    convolver.buffer = ir
    comp.connect(convolver)

    const dry = off.createGain(); dry.gain.value = 1 - revMix * 0.5
    const wet = off.createGain(); wet.gain.value = revMix
    const master = off.createGain(); master.gain.value = 0.85
    comp.connect(dry); convolver.connect(wet)
    dry.connect(master); wet.connect(master); master.connect(off.destination)
    src.start(0)

    processedBuf.current = await off.startRendering()
    drawBars(downsample(processedBuf.current))
    setStep('done')
  }

  const download = () => {
    if (!processedBuf.current) return
    const buf = processedBuf.current
    const len = buf.length
    const ab = new ArrayBuffer(44 + len * 2)
    const dv = new DataView(ab)
    const ws = (o, s) => { for (let i=0;i<s.length;i++) dv.setUint8(o+i, s.charCodeAt(i)) }
    ws(0,'RIFF'); dv.setUint32(4, 36+len*2, true); ws(8,'WAVE'); ws(12,'fmt ')
    dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true)
    dv.setUint32(24,buf.sampleRate,true); dv.setUint32(28,buf.sampleRate*2,true)
    dv.setUint16(32,2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,len*2,true)
    const ch = buf.getChannelData(0)
    for (let i=0;i<len;i++) { const s=Math.max(-1,Math.min(1,ch[i])); dv.setInt16(44+i*2, s<0?s*32768:s*32767, true) }
    const blob = new Blob([ab], {type:'audio/wav'})
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {href:url, download:`vocalshift_${style.id}.wav`}).click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
      drawBars(waveRef.current.slice(-120))
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [drawBars])

  const canRecord = step === 'idle' || step === 'recorded' || step === 'done'
  const canProcess = (step === 'recorded' || step === 'done') && style
  const canPlay = step === 'done' || (step === 'recorded' && originalBuf.current)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.15em', color: '#555', textTransform: 'uppercase', marginBottom: 6 }}>Voice Processing</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', margin: 0 }}>
            Vocal<span style={{ color: '#888' }}>Shift</span>
          </h1>
        </div>

        {/* Record */}
        <Section label="Record">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={step === 'recording' ? stopRecording : startRecording}
              style={{
                width: 56, height: 56, borderRadius: '50%',
                border: `2px solid ${step === 'recording' ? '#f55' : '#333'}`,
                background: step === 'recording' ? 'rgba(255,80,80,0.15)' : '#111',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.2s',
              }}
            >
              <div style={{
                width: step === 'recording' ? 14 : 18,
                height: step === 'recording' ? 14 : 18,
                borderRadius: step === 'recording' ? 3 : '50%',
                background: step === 'recording' ? '#f55' : '#f55',
                transition: 'all 0.2s',
              }} />
            </button>
            <div>
              <p style={{ margin: 0, fontSize: 14, color: step === 'recording' ? '#f55' : '#fff' }}>
                {step === 'recording' ? fmt(elapsed) : step === 'idle' ? 'Click to record' : '✓ Recording saved'}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#555' }}>
                {step === 'recording' ? 'Click to stop · max 60s' : step === 'idle' ? 'Up to 60 seconds' : 'Record again to replace'}
              </p>
            </div>
          </div>
          <canvas ref={canvasRef} style={{ marginTop: 16, width: '100%', height: 52, borderRadius: 8, background: '#111', display: 'block' }} />
        </Section>

        {/* Style */}
        <Section label="Style">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {STYLES.map(s => (
              <button key={s.id} onClick={() => setStyle(s)} style={{
                padding: '10px 4px', borderRadius: 10,
                border: `1px solid ${style?.id === s.id ? '#fff' : '#222'}`,
                background: style?.id === s.id ? '#1a1a1a' : '#111',
                cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.emoji}</div>
                <div style={{ fontSize: 11, color: style?.id === s.id ? '#fff' : '#666', fontWeight: 500 }}>{s.label}</div>
              </button>
            ))}
          </div>
          {style && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#555' }}>
              {style.emoji} {style.label} — {style.desc}
            </p>
          )}
        </Section>

        {/* Actions */}
        <Section label="Output">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn
              onClick={process}
              disabled={!canProcess || step === 'processing'}
              primary
            >
              {step === 'processing' ? 'Processing…' : 'Process'}
            </Btn>
            {canPlay && (
              <>
                <Btn onClick={() => startPlay('original')} disabled={playing === 'processed'}>
                  {playing === 'original' ? '◼ Stop' : '▶ Original'}
                </Btn>
                {processedBuf.current && (
                  <Btn onClick={() => startPlay('processed')} disabled={playing === 'original'}>
                    {playing === 'processed' ? '◼ Stop' : '▶ Processed'}
                  </Btn>
                )}
              </>
            )}
            {step === 'done' && (
              <Btn onClick={download}>↓ WAV</Btn>
            )}
          </div>
        </Section>

      </div>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</p>
      <div style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 12, padding: '1rem' }}>
        {children}
      </div>
    </div>
  )
}

function Btn({ onClick, disabled, primary, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
      border: `1px solid ${primary ? '#fff' : '#2a2a2a'}`,
      background: primary ? '#fff' : '#161616',
      color: primary ? '#000' : '#ccc',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'all 0.15s',
    }}>
      {children}
    </button>
  )
}
