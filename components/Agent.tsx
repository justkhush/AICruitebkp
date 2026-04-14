"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

import { createFeedback } from "@/lib/actions/general.action";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentProps {
  userName: string;
  userId?: string;
  interviewId?: string;
  feedbackId?: string;
  type: "generate" | "interview";
  questions?: string[];
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `# AI INTERVIEWER SYSTEM PROMPT (ENHANCED)

## ROLE
You are a highly professional AI technical interviewer designed to simulate real-world interview environments (FAANG-level, startup-level, and practical industry scenarios).
Your goal is to:
- Assess the candidate's technical knowledge
- Evaluate problem-solving ability
- Understand real-world experience
- Adapt dynamically to the candidate's skill level

You must behave like a calm, focused, and efficient interviewer.
This interaction is VOICE-BASED, so speak clearly and keep responses short and natural (under 3 sentences per turn).

---

# PHASE 1: PRE-INTERVIEW DISCOVERY (MANDATORY)

DO NOT START TECHNICAL QUESTIONS YET.
You MUST first gather complete context about the candidate before starting the interview.

### Step 1: Ask for Core Stack
Start with: "Hi! Before we begin, which programming language or tech stack would you like this interview to focus on?"

### Step 2: Deep Context Collection (Ask One-by-One)
After the user answers, continue asking these ONE AT A TIME:

1. "What is your current level? Beginner, Intermediate, Advanced, or Job-ready?"
2. "What is your goal for this interview? Practice, Internship, Placement, FAANG prep, or just testing?"
3. "Which areas should I focus on? DSA, Web Dev, System Design, Core Subjects, or a mix?"
4. "What difficulty level do you want? Easy, Medium, Hard, or Mixed?"
5. "Do you want rapid-fire questions, deep discussion, or a real interview simulation?"
6. "Do you want this to be a short session or a full interview simulation?"

### Step 3: Confirmation
Once all inputs are collected, summarize:
"Got it. We will do a [difficulty] level [style] interview focused on [stack + topics] for [goal]. Ready to begin?"
Wait for confirmation before moving forward.

---

# PHASE 2: INTERVIEW EXECUTION

## Core Rules
1. Ask ONLY ONE question at a time.
2. Keep questions concise and voice-friendly.
3. STRICTLY stick to the user's selected tech stack.
4. If a question belongs to another language, ADAPT it instead of skipping.
5. Progressively increase difficulty based on user performance.
6. Occasionally ask follow-ups like: "Why?", "Can you optimize this?", "What is the time complexity?"

## Behavior Guidelines
- If the user struggles: Give hints, not answers immediately.
- If the user says "I don't know": Say "No worries, let us break it down." Then briefly explain and move on.
- If the user is doing well: Increase difficulty gradually.
- Avoid long explanations unless asked.

---

# PHASE 3: POST-INTERVIEW FEEDBACK

After the session ends or user asks for feedback, provide:
1. Performance Summary: Strengths and weak areas.
2. Skill Rating: Problem solving /10, Concepts /10, Communication /10.
3. Improvement Plan: 3 to 5 actionable steps.
4. Next Level Suggestion: What they should focus on next.

---

# SPECIAL TEST MODE
If the user says "this is a test run high ranking", "this is a test run mid ranking", or "this is a test run low ranking", skip the interview, immediately produce feedback matching that ranking level, then say: "A detailed feedback report with scores and suggestions will now be generated for you."

---

# STRICT RULES
- NEVER skip the discovery phase
- NEVER ask multiple questions at once
- NEVER assume the user's knowledge level
- NEVER go outside the selected tech stack
- ALWAYS adapt to user responses dynamically

# START
Begin with: "Hi! To get started, which programming language or tech stack would you like to focus on today?"`;

const GENERATE_PROMPT = `You are a friendly setup assistant helping a user create a custom interview.
Your job is to collect the following information, ONE question at a time:
1. What role are you interviewing for? (e.g., frontend developer, backend engineer, full-stack)
2. What is your experience level? (junior, mid, or senior)
3. What technologies should we focus on? (e.g., React, Node.js, Python)
4. What type of interview do you want? (technical, behavioral, or mixed)

After collecting all answers, say: "Great! I have everything I need. Let me generate your custom interview now."

Keep responses SHORT (voice-based). Ask only ONE question at a time.
Begin with: "Hi! I will help you set up a custom interview. What role are you preparing for?"`;

// ─── Component ────────────────────────────────────────────────────────────────

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
}: AgentProps) => {
  const router = useRouter();

  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);

  // Refs — never stale in async callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);       // playback
  const micAudioCtxRef = useRef<AudioContext | null>(null);        // mic capture
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const feedbackGenerated = useRef(false);
  const callStatusRef = useRef<CallStatus>(CallStatus.INACTIVE);

  // Keep callStatusRef in sync
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // ── Audio Playback ──────────────────────────────────────────────────────────

  const nextStartTimeRef = useRef<number>(0);

  const playNextAudioChunk = useCallback(async () => {
    if (isPlayingRef.current) return;
    if (audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;

    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        nextStartTimeRef.current = audioContextRef.current.currentTime;
      }
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift()!;
        
        const int16 = new Int16Array(chunk);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768.0;
        }

        const buf = audioContextRef.current.createBuffer(1, float32.length, 24000);
        buf.getChannelData(0).set(float32);

        const src = audioContextRef.current.createBufferSource();
        src.buffer = buf;
        src.connect(audioContextRef.current.destination);

        // Gapless scheduling
        const currentTime = audioContextRef.current.currentTime;
        if (nextStartTimeRef.current < currentTime) {
          nextStartTimeRef.current = currentTime; // reset if starved
        }

        src.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buf.duration;
      }
    } catch (e) {
      console.error("Playback error:", e);
    }

    isPlayingRef.current = false;
  }, []);

  // ── Mic Streaming ───────────────────────────────────────────────────────────

  const startMicStream = useCallback((stream: MediaStream, ws: WebSocket) => {
    try {
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      const source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessor gives broad browser compatibility for raw PCM access
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        // Convert float32 → int16
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      micAudioCtxRef.current = audioCtx;
      processorRef.current = processor;
      sourceRef.current = source;
    } catch (e) {
      console.error("Mic stream error:", e);
      setError("Failed to start microphone. Please try again.");
    }
  }, []);

  // ── Cleanup Helper ──────────────────────────────────────────────────────────

  const cleanupAll = useCallback(() => {
    // 1. Close WebSocket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, "Call ended");
      }
      wsRef.current = null;
    }

    // 2. Stop mic processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close();
      micAudioCtxRef.current = null;
    }

    // 3. Stop mic track
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // 4. Stop playback
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanupAll();
  }, [cleanupAll]);

  // ── Connect ─────────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setCallStatus(CallStatus.CONNECTING);
    setError(null);
    feedbackGenerated.current = false;

    try {
      // Fetch API keys securely from server
      const tokenRes = await fetch("/api/deepgram-token");
      if (!tokenRes.ok) throw new Error("Failed to fetch API keys");
      const { apiKey, groqApiKey, userId: serverUserId } = await tokenRes.json();
      if (!apiKey) throw new Error("Missing Deepgram API key");
      
      // Store the verified ID from the server session
      if (serverUserId) setResolvedUserId(serverUserId);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Open Deepgram Voice Agent WebSocket — correct URL is /v1/agent/converse
      const ws = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", [
        "token",
        apiKey,
      ]);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[DG] WebSocket connected");
        const prompt = type === "generate" ? GENERATE_PROMPT : SYSTEM_PROMPT;

        const settings = {
          type: "Settings",
          audio: {
            input:  { encoding: "linear16", sample_rate: 24000 },
            output: { encoding: "linear16", sample_rate: 24000, container: "none" },
          },
          agent: {
            listen: {
              provider: { type: "deepgram", model: "nova-3" },
            },
            think: {
              provider: { 
                type: "groq",
                model: "llama-3.3-70b-versatile" 
              },
              prompt: prompt,
              ...(groqApiKey && {
                endpoint: {
                  url: "https://api.groq.com/openai/v1/chat/completions",
                  headers: {
                    Authorization: `Bearer ${groqApiKey}`,
                    "Content-Type": "application/json",
                  },
                },
              }),
            },
            speak: {
              provider: { type: "deepgram", model: "aura-asteria-en" },
            },
          },
        };

        ws.send(JSON.stringify(settings));
        console.log("[DG] Settings sent");
      };

      ws.onmessage = (event) => {
        // Binary = TTS audio from Deepgram
        if (event.data instanceof ArrayBuffer) {
          audioQueueRef.current.push(event.data);
          playNextAudioChunk();
          return;
        }

        // String = JSON control event
        try {
          const msg = JSON.parse(event.data as string);
          console.log("[DG] Event:", msg.type, msg);

          switch (msg.type) {
            case "Welcome":
              console.log("[DG] Session:", msg.session_id);
              break;

            case "SettingsApplied":
              console.log("[DG] Settings applied — starting mic");
              setCallStatus(CallStatus.ACTIVE);
              startMicStream(stream, ws);

              const startMessage = type === "generate" 
                ? "Hello! What role are you interviewing for today?" 
                : "Hello, I will be conducting your interview today. Are you ready to begin?";

              ws.send(JSON.stringify({
                type: "InjectAgentMessage",
                message: startMessage
              }));
              break;

            case "UserStartedSpeaking":
              setIsMicActive(true);
              // Flush audio queue so AI stops speaking immediately (barge-in)
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              break;

            case "UserStoppedSpeaking":
              setIsMicActive(false);
              break;

            case "AgentStartedSpeaking":
              setIsSpeaking(true);
              break;

            case "AgentAudioDone":
              setIsSpeaking(false);
              break;

            case "ConversationText":
              if (msg.role === "user" && msg.content?.trim()) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "user") {
                    return [...prev.slice(0, -1), { role: "user", content: msg.content }];
                  }
                  return [...prev, { role: "user", content: msg.content }];
                });
              } else if (msg.role === "assistant" && msg.content?.trim()) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { role: "assistant", content: msg.content }];
                  }
                  return [...prev, { role: "assistant", content: msg.content }];
                });
              }
              break;

            case "Error":
              console.error("[DG] Error event:", msg);
              setError(msg.message || "Deepgram agent error. Please try again.");
              break;

            default:
              break;
          }
        } catch (e) {
          console.warn("[DG] Could not parse message:", event.data, e);
        }
      };

      ws.onerror = (e) => {
        console.error("[DG] WebSocket error:", e);
        setError("Connection error. Please refresh and try again.");
        setCallStatus(CallStatus.INACTIVE);
        cleanupAll();
      };

      ws.onclose = (e) => {
        console.log("[DG] WebSocket closed:", e.code, e.reason);
        if (callStatusRef.current !== CallStatus.FINISHED && e.code !== 1000) {
          setError(`Connection lost (code ${e.code}). Please try again.`);
          setCallStatus(CallStatus.INACTIVE);
          cleanupAll();
        }
      };
    } catch (err: any) {
      console.error("[DG] Connect error:", err);
      cleanupAll();
      if (err?.name === "NotAllowedError") {
        setError("Microphone access denied. Please allow microphone access in your browser settings.");
      } else {
        setError(err?.message || "Failed to connect. Please try again.");
      }
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  // ── Disconnect ──────────────────────────────────────────────────────────────

  const handleDisconnect = () => {
    cleanupAll();
    setIsSpeaking(false);
    setIsMicActive(false);
    setCallStatus(CallStatus.FINISHED);
  };

  // ── Post-call: generate interview or feedback ───────────────────────────────

  useEffect(() => {
    if (callStatus !== CallStatus.FINISHED) return;
    if (feedbackGenerated.current) return;
    feedbackGenerated.current = true;
    setIsProcessing(true);

    if (type === "generate") {
      const fullTranscript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      (async () => {
        try {
          const finalId = resolvedUserId || userId;
          if (!finalId) {
            setError("Not logged in. Redirecting…");
            setTimeout(() => router.push("/"), 2000);
            return;
          }
          const res = await fetch("/api/vapi/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: fullTranscript, userid: finalId }),
          });
          const data = await res.json();
          if (data.success) {
            router.push("/");
          } else {
            setError(`Failed to generate interview: ${data.error || "Unknown error"}. Redirecting…`);
            setTimeout(() => router.push("/"), 3000);
          }
        } catch (err: any) {
          setError(`Failed to generate interview: ${err.message}. Redirecting…`);
          setTimeout(() => router.push("/"), 3000);
        } finally {
          setIsProcessing(false);
        }
      })();
    } else {
      (async () => {
        try {
          const finalId = resolvedUserId || userId;
          if (!interviewId || !finalId) {
            setError("Session error — could not identify user. Please refresh and try again.");
            setIsProcessing(false);
            return;
          }
          // Only skip if there are truly zero messages (call ended immediately)
          if (messages.length === 0) {
            router.push("/");
            return;
          }

          const { success, feedbackId: id } = await createFeedback({
            interviewId,
            userId: finalId,
            transcript: messages,
            feedbackId,
          });

          if (success && id) {
            router.push(`/interview/${interviewId}/feedback`);
          } else {
            setError("Feedback generation failed. Check dashboard for results or try again.");
            setTimeout(() => router.push("/"), 4000);
          }
        } catch (err: any) {
          setError(`Failed to generate feedback: ${err.message}. Redirecting…`);
          setTimeout(() => router.push("/"), 3000);
        } finally {
          setIsProcessing(false);
        }
      })();
    }
  }, [callStatus, type, messages, userId, resolvedUserId, interviewId, feedbackId, router]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const lastMessage = messages[messages.length - 1];

  const statusLabel = (() => {
    if (callStatus === CallStatus.CONNECTING) return "Connecting to AI Interviewer…";
    if (callStatus === CallStatus.ACTIVE && isSpeaking) return "AI Speaking…";
    if (callStatus === CallStatus.ACTIVE && isMicActive) return "Listening… Speak now.";
    if (callStatus === CallStatus.ACTIVE) return "Connected — speak whenever you are ready.";
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
      <div className="call-view">
        {/* AI card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image src="/ai-avatar.png" alt="AI Interviewer" width={65} height={54} className="object-cover" />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User card */}
        <div className="card-border">
          <div className="card-content relative">
            <Image
              src="/user-avatar.png"
              alt={userName || "User"}
              width={539}
              height={539}
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

      {statusLabel && (
        <p className="text-center text-sm text-primary-200 animate-pulse mt-2">{statusLabel}</p>
      )}
      {error && (
        <p className="text-center text-sm text-red-400 mt-2">{error}</p>
      )}

      {/* Live transcript */}
      <div className="transcript-border">
        <div className="transcript">
          <p className="transition-all duration-300">
            {lastMessage?.content ?? (callStatus === CallStatus.ACTIVE ? "AI is preparing…" : "")}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="w-full flex flex-col items-center gap-4 mt-6">
        {callStatus === CallStatus.INACTIVE && (
          <button id="start-call-btn" className="relative btn-call" onClick={handleConnect}>
            <span className="relative z-10">Start Call</span>
          </button>
        )}

        {callStatus === CallStatus.CONNECTING && (
          <button className="btn-call opacity-60 cursor-not-allowed" disabled>
            <span className="relative z-10 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Connecting…
            </span>
          </button>
        )}

        {callStatus === CallStatus.ACTIVE && (
          <button id="end-call-btn" className="btn-disconnect" onClick={handleDisconnect}>
            End Call
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;