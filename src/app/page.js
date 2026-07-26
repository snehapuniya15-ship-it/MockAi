'use client';
import React, { useState, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

/** Four hairline corner brackets — the recurring "console" motif.
 *  Inset generously from the edge (clear of both the card's rounded
 *  radius and any inner content) and layered above siblings so nearby
 *  shadows/content never make them look clipped or misaligned. */
function CornerBrackets({ tone = 'border-indigo-400/40' }) {
  return (
    <>
      <span className={`pointer-events-none absolute z-20 top-4 left-4 w-3 h-3 border-t border-l ${tone}`} />
      <span className={`pointer-events-none absolute z-20 top-4 right-4 w-3 h-3 border-t border-r ${tone}`} />
      <span className={`pointer-events-none absolute z-20 bottom-4 left-4 w-3 h-3 border-b border-l ${tone}`} />
      <span className={`pointer-events-none absolute z-20 bottom-4 right-4 w-3 h-3 border-b border-r ${tone}`} />
    </>
  );
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------

export default function MockInterviewDashboard() {
  const [role, setRole] = useState('Frontend Engineer');
  const [step, setStep] = useState('landing'); // 'landing' | 'interview' | 'result'
  const [history, setHistory] = useState([]);
  const [aiText, setAiText] = useState('');

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(false);

  // Visual-only state additions
  const [elapsed, setElapsed] = useState(0);
  const [gaugeReady, setGaugeReady] = useState(false);

  const recognitionRef = useRef(null);
  const scrollRef = useRef(null);
  const chatEndRef = useRef(null);
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const rafRef = useRef(null);
  const isListeningRef = useRef(false);

  // Auto-scroll chat — deferred to the next frame so it runs after the
  // new message/transcript text has actually painted and affected layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => cancelAnimationFrame(id);
  }, [history, transcript, loading]);

  // Session clock
  useEffect(() => {
    if (step !== 'interview') return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  // Trigger the score gauge draw-in once the result screen mounts
  useEffect(() => {
    if (step === 'result') {
      setGaugeReady(false);
      const t = setTimeout(() => setGaugeReady(true), 120);
      return () => clearTimeout(t);
    }
  }, [step]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (event) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
        };

        rec.onerror = (err) => {
          console.error(err);
          setIsListening(false);
        };

        rec.onend = () => setIsListening(false);
        recognitionRef.current = rec;
      }
    }
  }, []);

  const speakAloud = (text) => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- Live waveform ---------------------------------------------------
  // A single perpetual draw loop runs for as long as the interview screen
  // is mounted: it renders a gentle ambient ripple at rest, and switches to
  // real microphone frequency data whenever recording is active. This keeps
  // the console feeling "alive" instead of dead when idle.
  const barCount = 32;

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const stopVisualizer = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  };

  const startVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      // Mic access for the visualizer is best-effort only — speech
      // recognition itself has its own independent permission flow.
      console.error('Waveform visualizer unavailable:', err);
    }
  };

  useEffect(() => {
    if (isListening) startVisualizer();
    else stopVisualizer();
    return () => stopVisualizer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  // Perpetual draw loop — mounted once for the lifetime of the interview screen.
  useEffect(() => {
    if (step !== 'interview') return undefined;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let start = performance.now();

    const draw = (now) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx2d = canvas.getContext('2d');
      const { width, height } = canvas;
      ctx2d.clearRect(0, 0, width, height);
      const barWidth = width / barCount;
      const analyser = analyserRef.current;
      const dataArray = dataArrayRef.current;

      const gradient = ctx2d.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.9)'); // indigo-500
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0.9)'); // emerald-500

      if (isListeningRef.current && analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const step = Math.max(1, Math.floor(dataArray.length / barCount));
        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step] || 0;
          const barHeight = Math.max(4, (value / 255) * height);
          const x = i * barWidth;
          const y = (height - barHeight) / 2;
          ctx2d.fillStyle = gradient;
          ctx2d.shadowColor = 'rgba(16, 185, 129, 0.35)';
          ctx2d.shadowBlur = 6;
          ctx2d.fillRect(x + barWidth * 0.26, y, barWidth * 0.48, barHeight);
        }
      } else {
        // Ambient idle ripple — subtle, slow, respects reduced-motion.
        const t = reduceMotion ? 0 : (now - start) / 1000;
        for (let i = 0; i < barCount; i++) {
          const phase = t * 1.2 + i * 0.35;
          const amplitude = reduceMotion ? 0 : 3.5 + Math.sin(i * 0.6) * 1.5;
          const barHeight = 5 + Math.max(0, Math.sin(phase)) * amplitude;
          const x = i * barWidth;
          const y = (height - barHeight) / 2;
          ctx2d.fillStyle = 'rgba(148, 163, 184, 0.35)'; // slate-400 @ low opacity
          ctx2d.shadowBlur = 0;
          ctx2d.fillRect(x + barWidth * 0.26, y, barWidth * 0.48, barHeight);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [step]);

  const toggleListening = () => {
    if (recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
        return;
      }
      setTranscript('');
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  const handleNextTurn = async (forcedFinal = false) => {
    if (forcedFinal) {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (isListening && recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    }

    const inputMessage = forcedFinal ? "Please finalize my evaluation." : transcript;
    if (!inputMessage.trim() && !forcedFinal) return;

    setLoading(true);
    const updatedHistory = [...history, { role: 'user', text: inputMessage }];
    setHistory(updatedHistory);
    setTranscript('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: history,
          userMessage: inputMessage,
          isFinalQuery: forcedFinal
        })
      });

      const data = await res.json();
      setAiText(data.aiReply);
      if (!forcedFinal) speakAloud(data.aiReply);
      setHistory(prev => [...prev, { role: 'ai', text: data.aiReply }]);

      if (data.isEnded || data.evaluation) {
        setEvaluation(data.evaluation);
        setStep('result');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const initInterview = async () => {
    if (!role.trim()) return;
    setStep('interview');
    setElapsed(0);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: [],
          userMessage: `Hello, I am ready to interview for the role of ${role}. Please ask me my first question.`,
          isFinalQuery: false
        })
      });
      const data = await res.json();
      setAiText(data.aiReply);
      speakAloud(data.aiReply);
      setHistory([{ role: 'ai', text: data.aiReply }]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetInterview = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setStep('landing');
    setEvaluation(null);
    setHistory([]);
    setTranscript('');
    setAiText('');
    setLoading(false);
    setElapsed(0);
    setGaugeReady(false);
  };

  // Score gauge geometry
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const score = evaluation?.score ?? 0;
  const gaugeOffset = gaugeReady
    ? circumference - (Math.min(Math.max(score, 0), 100) / 100) * circumference
    : circumference;

  return (
    <div className="relative min-h-screen bg-slate-50 text-slate-900 [font-family:var(--font-body)] antialiased flex flex-col selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden">

      {/* Ambient depth: soft color blobs + a faint grid, all fixed behind content */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="blob absolute -top-24 -left-16 w-[26rem] h-[26rem] rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="blob blob-alt absolute top-1/3 -right-24 w-[24rem] h-[24rem] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="blob blob-slow absolute bottom-[-8rem] left-1/4 w-[22rem] h-[22rem] rounded-full bg-indigo-100/50 blur-3xl" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(100,116,139,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.09) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 20%, black 0%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 20%, black 0%, transparent 75%)',
          }}
        />
      </div>

      <style jsx>{`
        @keyframes floatSlow {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -24px, 0) scale(1.06); }
        }
        @keyframes floatSlowAlt {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-18px, 18px, 0) scale(1.04); }
        }
        .blob { animation: floatSlow 11s ease-in-out infinite; }
        .blob-alt { animation: floatSlowAlt 13s ease-in-out infinite; }
        .blob-slow { animation: floatSlow 16s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .blob, .blob-alt, .blob-slow { animation: none; }
        }
      `}</style>

      {/* ================= 1. LANDING SCREEN ================= */}
      {step === 'landing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-3 text-center animate-in fade-in duration-700" style={{ animationDelay: '80ms' }}>
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur-md border border-slate-200/80 text-[11px] text-slate-500 mb-2 [font-family:var(--font-mono)] tracking-widest uppercase shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                <span>Session setup</span>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-900 [font-family:var(--font-display)]">
                Mock.AI
              </h1>
              <p className="text-sm text-slate-500 max-w-xs mx-auto">
                Choose the role you're preparing for. Your interviewer tunes every question to it.
              </p>
            </div>

            <div
              className="relative bg-white/70 backdrop-blur-md border border-slate-200/80 p-6 pb-7 rounded-2xl space-y-5 shadow-xl shadow-slate-200/50 animate-in fade-in slide-in-from-bottom-2 duration-700"
              style={{ animationDelay: '160ms' }}
            >
              <CornerBrackets />

              <div>
                <label
                  htmlFor="role-input"
                  className="text-[11px] font-medium text-slate-500 uppercase tracking-widest block mb-2 [font-family:var(--font-mono)]"
                >
                  Channel // Target role
                </label>
                <input
                  id="role-input"
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Full Stack Engineer"
                  className="w-full bg-white/60 backdrop-blur-sm border border-slate-200/80 rounded-lg px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus:border-indigo-400 focus:bg-white transition-colors"
                />
              </div>

              <button
                onClick={initInterview}
                disabled={!role.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg text-sm transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center space-x-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                <span>Begin session</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </button>
            </div>

            <p className="text-center text-[11px] text-slate-400 [font-family:var(--font-mono)] tracking-wide">
              Mic access is requested when you start speaking, not before.
            </p>
          </div>

          <div
            className="absolute bottom-6 inset-x-0 flex justify-center animate-in fade-in duration-700"
            style={{ animationDelay: '320ms' }}
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 backdrop-blur-md border border-slate-200/70 text-[11px] text-slate-400 [font-family:var(--font-mono)] tracking-wide shadow-sm">
              <span className="text-rose-400" aria-hidden="true">♥</span>
              Crafted with care by Sneha
            </span>
          </div>
        </div>
      )}

      {/* ================= 2. ACTIVE INTERVIEW SCREEN ================= */}
      {step === 'interview' && (
        <div className="flex flex-col h-[100dvh] max-w-4xl mx-auto w-full p-6 relative z-10 animate-in fade-in duration-700 ease-out">

          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 shrink-0">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest [font-family:var(--font-mono)]">
                  Live
                </span>
              </div>
              <span className="text-xs text-slate-300">/</span>
              <span className="text-xs font-medium text-slate-700">{role}</span>
            </div>
            <span className="text-xs text-slate-400 [font-family:var(--font-mono)] tabular-nums">
              {formatTime(elapsed)}
            </span>
          </div>

          {/* Chat Stream Window */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-6 py-8 px-1">
            {history.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-500 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] [font-family:var(--font-mono)] uppercase tracking-wider text-slate-400 mb-1">
                  {msg.role === 'ai' ? 'Interviewer' : 'You'}
                </span>
                <div className={`p-4 rounded-xl text-sm leading-relaxed max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm shadow-md shadow-indigo-600/20'
                    : 'bg-white/70 backdrop-blur-md border border-slate-200/80 text-slate-700 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {loading && !transcript && (
              <div className="flex flex-col items-start">
                <span className="text-[10px] [font-family:var(--font-mono)] uppercase tracking-wider text-slate-400 mb-1">Interviewer</span>
                <div className="p-4 rounded-xl bg-white/70 backdrop-blur-md border border-slate-200/80 shadow-sm flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full motion-safe:animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full motion-safe:animate-bounce [animation-delay:100ms]" />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full motion-safe:animate-bounce [animation-delay:200ms]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Live console: waveform + mic + transcript + end session — always in view */}
          <div className="border-t border-slate-200/80 pt-6 space-y-4 shrink-0">

            <div className="relative bg-white/70 backdrop-blur-md border border-slate-200/80 rounded-xl px-4 py-3 shadow-sm">
              <CornerBrackets tone={isListening ? 'border-emerald-500/60' : 'border-slate-300/80'} />
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] [font-family:var(--font-mono)] uppercase tracking-widest text-slate-400">
                  Input signal
                </span>
                <span className={`text-[10px] [font-family:var(--font-mono)] uppercase tracking-widest ${isListening ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {isListening ? 'Recording' : 'Standby'}
                </span>
              </div>
              <canvas ref={canvasRef} width={640} height={48} className="w-full h-12" />
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={toggleListening}
                disabled={loading}
                aria-pressed={isListening}
                className={`relative px-5 py-3 rounded-xl font-medium text-xs tracking-wider uppercase transition-all flex items-center space-x-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 ${
                  isListening
                    ? 'bg-red-50/80 backdrop-blur-md border border-red-200 text-red-600'
                    : 'bg-white/70 backdrop-blur-md border border-slate-200/80 text-slate-700 hover:bg-white hover:border-slate-300 shadow-sm'
                }`}
              >
                {isListening && (
                  <span className="absolute inset-0 rounded-xl border border-red-400/50 motion-safe:animate-ping" />
                )}
                <span className="relative">{isListening ? 'Stop' : 'Speak answer'}</span>
              </button>

              <div className="flex-1 bg-white/70 backdrop-blur-md border border-slate-200/80 rounded-xl px-4 py-3 text-sm text-slate-700 min-h-[46px] flex items-center shadow-sm">
                {transcript ? (
                  <span className="text-slate-900">{transcript}</span>
                ) : (
                  <span className="text-slate-400 text-xs [font-family:var(--font-mono)]">
                    Your spoken answer streams here in real time…
                  </span>
                )}
              </div>

              {transcript && (
                <button
                  onClick={() => handleNextTurn(false)}
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3 rounded-xl text-xs font-medium uppercase tracking-wider transition-colors shrink-0 shadow-lg shadow-indigo-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                >
                  Send
                </button>
              )}

              <button
                onClick={() => handleNextTurn(true)}
                disabled={loading}
                className="px-4 py-3 rounded-xl text-xs font-medium uppercase tracking-wider transition-all shrink-0 bg-white/70 backdrop-blur-md border border-slate-200/80 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50/70 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                title="End the session and see your results"
              >
                End
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 3. RESULT / EVALUATION SCREEN ================= */}
      {step === 'result' && evaluation && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
          <div className="w-full max-w-2xl space-y-8">
            <div className="text-center space-y-2 animate-in fade-in duration-700" style={{ animationDelay: '80ms' }}>
              <span className="text-[11px] [font-family:var(--font-mono)] uppercase tracking-widest text-emerald-600">
                Session complete
              </span>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 [font-family:var(--font-display)]">
                Performance readout
              </h2>
            </div>

            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-700"
              style={{ animationDelay: '160ms' }}
            >

              {/* Score Gauge Tile */}
              <div className="relative bg-white/70 backdrop-blur-md border border-slate-200/80 rounded-2xl p-6 flex flex-col items-center justify-center space-y-3 shadow-xl shadow-slate-200/50">
                <CornerBrackets />
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-widest [font-family:var(--font-mono)]">
                  Final score
                </span>
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <defs>
                      <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#10b981" />
                      </linearGradient>
                    </defs>
                    <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200" />
                    <circle
                      cx="60"
                      cy="60"
                      r={radius}
                      fill="none"
                      stroke="url(#scoreGradient)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={gaugeOffset}
                      className="transition-[stroke-dashoffset] duration-1000 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold tracking-tight text-slate-900 [font-family:var(--font-display)] tabular-nums">
                      {score}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 [font-family:var(--font-mono)]">out of 100</span>
              </div>

              {/* Diagnostic Log Tile */}
              <div className="relative md:col-span-2 bg-white/70 backdrop-blur-md border border-slate-200/80 rounded-2xl p-6 space-y-6 shadow-xl shadow-slate-200/50">
                <CornerBrackets />
                <div>
                  <h3 className="text-[11px] font-medium text-emerald-600 uppercase tracking-widest mb-2 [font-family:var(--font-mono)]">
                    Strengths
                  </h3>
                  <ul className="space-y-1.5">
                    {evaluation.strengths?.map((s, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start">
                        <span className="text-emerald-600/80 mr-2 [font-family:var(--font-mono)] text-[11px] mt-0.5 shrink-0">
                          S{String(i + 1).padStart(2, '0')}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-[11px] font-medium text-amber-600 uppercase tracking-widest mb-2 [font-family:var(--font-mono)]">
                    Areas to improve
                  </h3>
                  <ul className="space-y-1.5">
                    {evaluation.improvements?.map((im, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start">
                        <span className="text-amber-600/80 mr-2 [font-family:var(--font-mono)] text-[11px] mt-0.5 shrink-0">
                          I{String(i + 1).padStart(2, '0')}
                        </span>
                        {im}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-center pt-4 animate-in fade-in duration-700" style={{ animationDelay: '240ms' }}>
              <button
                onClick={resetInterview}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-8 py-3 rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/25 tracking-wider uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                Start new session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}