"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createFeedback } from "@/lib/actions/general.action";

// ─── Types ────────────────────────────────────────────────────────────────────

enum CallStatus {
  INACTIVE = "INACTIVE",
  ACTIVE   = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentProps {
  userName:    string;
  userId?:     string;
  interviewId?: string;
  feedbackId?: string;
  type:        "generate" | "interview";
  questions?:  string[];
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `# AI INTERVIEWER SYSTEM PROMPT (ENHANCED)

## ROLE
You are a highly professional AI technical interviewer designed to simulate real-world interview environments.
This interaction is VOICE-BASED. Keep every response under 2-3 short sentences. Never write long paragraphs.

---

# PHASE 1: PRE-INTERVIEW DISCOVERY (MANDATORY)
DO NOT ASK TECHNICAL QUESTIONS YET.

Ask these questions ONE AT A TIME before starting:
1. "Hi! Which programming language or tech stack would you like this interview to focus on?"
2. "What is your current level? Beginner, Intermediate, Advanced, or Job-ready?"
3. "What is your goal? Practice, Internship, Placement, FAANG prep, or just testing?"
4. "Which areas should I focus on? DSA, Web Dev, System Design, Core Subjects, or a mix?"
5. "What difficulty level? Easy, Medium, Hard, or Mixed?"
6. "Do you want rapid-fire questions, deep discussion, or a full interview simulation?"

After collecting all answers, confirm: "Got it. Ready to begin a [difficulty] [style] interview on [stack]?"
Wait for confirmation before asking any technical questions.

---

# PHASE 2: INTERVIEW EXECUTION
- ONE question at a time only.
- Stick STRICTLY to the user's chosen tech stack.
- If user struggles: give hints, not answers.
- If user says "I don't know": say "No worries, let's move on." then continue.
- Progressively increase difficulty.

---

# PHASE 3: FEEDBACK (when user says done or asks for feedback)
Give: Strengths, Weak areas, Skill ratings out of 10, and 3-5 improvement steps.

---

# STRICT RULES
- NEVER skip discovery phase.
- NEVER ask more than one question per turn.
- NEVER go outside the selected tech stack.
- Keep ALL responses SHORT (voice-optimized).`;

const GENERATE_PROMPT = `You are a friendly setup assistant helping create a custom interview. Ask these ONE AT A TIME:
1. What role are you interviewing for?
2. What is your experience level? (junior, mid, senior)
3. What technologies should we focus on?
4. Technical, behavioral, or mixed interview?
After all answers say: "Great! Generating your custom interview now."
Keep responses SHORT. Ask only ONE question at a time.
Start with: "Hi! I will help set up your custom interview. What role are you preparing for?"`;

// ─── Main Component ───────────────────────────────────────────────────────────

const Agent = ({ userName, userId, interviewId, feedbackId, type }: AgentProps) => {
  const router = useRouter();

  const [callStatus, setCallStatus]   = useState<CallStatus>(CallStatus.INACTIVE);
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [messages, setMessages]       = useState<SavedMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs — prevent stale closures
  const recognitionRef      = useRef<any>(null);
  const currentAudioRef     = useRef<HTMLAudioElement | null>(null);
  const feedbackGenerated   = useRef(false);
  const callStatusRef       = useRef<CallStatus>(CallStatus.INACTIVE);
  const isSpeakingRef       = useRef(false);
  const isProcessingRef     = useRef(false);
  const messagesRef         = useRef<SavedMessage[]>([]);

  // Keep refs in sync with state
  useEffect(() => { callStatusRef.current    = callStatus;   }, [callStatus]);
  useEffect(() => { isSpeakingRef.current    = isSpeaking;   }, [isSpeaking]);
  useEffect(() => { isProcessingRef.current  = isProcessing; }, [isProcessing]);
  useEffect(() => { messagesRef.current      = messages;     }, [messages]);

  // ── TTS: Deepgram Aura (with browser fallback) ──────────────────────────────

  const speakText = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Stop any currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    setIsSpeaking(true);
    isSpeakingRef.current = true;

    // Pause mic while AI speaks
    try { recognitionRef.current?.stop(); } catch (_) {}

    let usedDeepgram = false;

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok && res.headers.get("Content-Type")?.includes("audio")) {
        const blob = new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        usedDeepgram = true;

        await new Promise<void>((resolve) => {
          audio.onended  = () => resolve();
          audio.onerror  = () => resolve();
          audio.play().catch(() => resolve());
        });

        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
      }
    } catch (_) {
      // Deepgram TTS failed — fall through to browser TTS
    }

    if (!usedDeepgram) {
      // Browser TTS fallback
      await new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v =>
          v.lang.startsWith("en") &&
          (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha"))
        ) || voices.find(v => v.lang.startsWith("en"));
        if (preferred) utter.voice = preferred;
        utter.rate   = 1.0;
        utter.onend  = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    }

    setIsSpeaking(false);
    isSpeakingRef.current = false;

    // Resume mic after speaking (with short delay)
    if (callStatusRef.current === CallStatus.ACTIVE) {
      setTimeout(() => {
        if (callStatusRef.current === CallStatus.ACTIVE && !isProcessingRef.current) {
          try { recognitionRef.current?.start(); } catch (_) {}
        }
      }, 300);
    }
  }, []);

  // ── LLM: Send message to Groq ───────────────────────────────────────────────

  const sendToAI = useCallback(async (msgs: SavedMessage[]) => {
    setIsProcessing(true);
    isProcessingRef.current = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);

      const data = await res.json();
      const assistantMsg: SavedMessage = data.message;

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
        messagesRef.current = updated;
        return updated;
      });

      await speakText(assistantMsg.content);
    } catch (err) {
      console.error("AI error:", err);
      setError("AI failed to respond. Please try again.");
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [speakText]);

  // ── Speech Recognition Setup ─────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Pre-load voices
    window.speechSynthesis?.getVoices();

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition not supported. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous      = false;
    recognition.interimResults  = false;
    recognition.lang            = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsMicActive(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript?.trim();
      if (!transcript) return;

      console.log("User said:", transcript);
      setMessages(prev => {
        const updated = [...prev, { role: "user" as const, content: transcript }];
        messagesRef.current = updated;
        sendToAI(updated);
        return updated;
      });
    };

    recognition.onerror = (event: any) => {
      setIsMicActive(false);
      if (event.error === "not-allowed") {
        setError("Microphone blocked. Please allow mic access in browser settings.");
        return;
      }
      // Other errors (no-speech, aborted) — restart mic if still in call
      if (
        callStatusRef.current === CallStatus.ACTIVE &&
        !isSpeakingRef.current &&
        !isProcessingRef.current &&
        event.error !== "aborted"
      ) {
        setTimeout(() => {
          try { recognitionRef.current?.start(); } catch (_) {}
        }, 300);
      }
    };

    recognition.onend = () => {
      setIsMicActive(false);
      // Auto-restart mic if call is still active and AI isn't speaking
      if (
        callStatusRef.current === CallStatus.ACTIVE &&
        !isSpeakingRef.current &&
        !isProcessingRef.current
      ) {
        setTimeout(() => {
          try { recognitionRef.current?.start(); } catch (_) {}
        }, 200);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.abort(); } catch (_) {}
      window.speechSynthesis?.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start Call ───────────────────────────────────────────────────────────────

  const handleCall = useCallback(async () => {
    setCallStatus(CallStatus.ACTIVE);
    callStatusRef.current = CallStatus.ACTIVE;
    setError(null);
    feedbackGenerated.current = false;
    setMessages([]);

    const greeting =
      type === "generate"
        ? `Hi ${userName}! I will help set up your custom interview. What role are you preparing for?`
        : `Hi ${userName}! Which programming language or tech stack would you like this interview to focus on?`;

    const firstMsg: SavedMessage = { role: "assistant", content: greeting };
    setMessages([firstMsg]);
    messagesRef.current = [firstMsg];

    await speakText(greeting);
  }, [type, userName, speakText]);

  // ── End Call ─────────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    // Stop mic
    try { recognitionRef.current?.abort(); } catch (_) {}
    // Stop any playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    setIsSpeaking(false);
    setIsMicActive(false);
    setCallStatus(CallStatus.FINISHED);
    callStatusRef.current = CallStatus.FINISHED;
  }, []);

  // ── Post-call ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (callStatus !== CallStatus.FINISHED) return;
    if (feedbackGenerated.current) return;
    feedbackGenerated.current = true;
    setIsProcessing(true);

    const msgs = messagesRef.current;

    if (type === "generate") {
      const transcript = msgs.map(m => `${m.role}: ${m.content}`).join("\n");
      (async () => {
        try {
          const res = await fetch("/api/vapi/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript, userid: userId }),
          });
          const data = await res.json();
          if (data.success) {
            router.push(`/interview/${data.interviewId}`);
          } else {
            setError("Failed to generate interview. Redirecting…");
            setTimeout(() => router.push("/"), 2000);
          }
        } catch {
          setError("Failed to generate interview. Redirecting…");
          setTimeout(() => router.push("/"), 2000);
        } finally {
          setIsProcessing(false);
        }
      })();
    } else {
      (async () => {
        try {
          if (!interviewId || !userId) { router.push("/"); return; }
          if (msgs.length <= 1) { router.push("/"); return; }

          const { success, feedbackId: id } = await createFeedback({
            interviewId,
            userId,
            transcript: msgs,
            feedbackId,
          });

          if (success && id) {
            router.push(`/interview/${interviewId}/feedback`);
          } else {
            router.push("/");
          }
        } catch {
          setError("Failed to generate feedback. Redirecting…");
          setTimeout(() => router.push("/"), 2000);
        } finally {
          setIsProcessing(false);
        }
      })();
    }
  }, [callStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────────

  const lastMessage = messages[messages.length - 1];

  const statusLabel = (() => {
    if (callStatus === CallStatus.ACTIVE && isSpeaking)    return "AI Speaking…";
    if (callStatus === CallStatus.ACTIVE && isProcessing)  return "AI is thinking…";
    if (callStatus === CallStatus.ACTIVE && isMicActive)   return "Listening… Speak now.";
    if (callStatus === CallStatus.ACTIVE)                  return "Speak whenever you are ready.";
    if (callStatus === CallStatus.FINISHED && isProcessing)
      return type === "generate" ? "Generating your interview…" : "Generating feedback…";
    return "";
  })();

  if (isProcessing && callStatus === CallStatus.FINISHED) {
    return (
      <div className="flex items-center justify-center py-20 flex-col gap-6">
        <div className="w-16 h-16 border-4 border-primary-200 border-t-transparent rounded-full animate-spin" />
        <p className="text-lg font-medium text-primary-200">
          {type === "generate" ? "Generating your custom interview…" : "Analysing your interview…"}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Avatar row */}
      <div className="call-view">
        <div className="card-interviewer">
          <div className="avatar">
            <Image src="/ai-avatar.png" alt="AI Interviewer" width={65} height={54} className="object-cover" />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        <div className="card-border">
          <div className="card-content relative">
            <Image
              src="/user-avatar.png"
              alt={userName || "User"}
              width={539} height={539}
              className={`rounded-full object-cover size-[120px] transition-all duration-300 ${
                isMicActive ? "ring-4 ring-primary-200 ring-offset-4 ring-offset-dark-100" : ""
              }`}
            />
            {isMicActive && (
              <div className="absolute -top-2 -right-2 bg-primary-200 p-1.5 rounded-full animate-bounce shadow-lg shadow-primary-200/50">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" x2="12" y1="19" y2="22"/>
                </svg>
              </div>
            )}
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {/* Status */}
      {statusLabel && (
        <p className="text-center text-sm text-primary-200 animate-pulse mt-2">{statusLabel}</p>
      )}
      {error && (
        <p className="text-center text-sm text-red-400 mt-2">{error}</p>
      )}

      {/* Transcript */}
      <div className="transcript-border">
        <div className="transcript">
          <p className="transition-all duration-300">
            {lastMessage?.content ?? (callStatus === CallStatus.ACTIVE ? "Starting…" : "")}
          </p>
        </div>
      </div>

      {/* Buttons */}
      <div className="w-full flex flex-col items-center gap-4 mt-6">
        {callStatus === CallStatus.INACTIVE && (
          <button id="start-call-btn" className="relative btn-call" onClick={handleCall}>
            <span className="relative z-10">Start Call</span>
          </button>
        )}

        {callStatus === CallStatus.ACTIVE && (
          <div className="flex gap-4">
            {/* Manual push-to-talk fallback */}
            <button
              id="talk-btn"
              className={`w-40 h-14 rounded-xl font-bold transition-all duration-200 ${
                isMicActive
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/30"
                  : "bg-primary-200 text-black"
              }`}
              onClick={() => {
                if (isSpeakingRef.current || isProcessingRef.current) return;
                window.speechSynthesis?.cancel();
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                try {
                  recognitionRef.current?.stop();
                  setTimeout(() => {
                    try { recognitionRef.current?.start(); } catch (_) {}
                  }, 150);
                } catch (_) {}
              }}
            >
              {isMicActive ? "🎙 Listening…" : "Talk"}
            </button>

            <button id="end-call-btn" className="btn-disconnect" onClick={handleDisconnect}>
              End Call
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default Agent;