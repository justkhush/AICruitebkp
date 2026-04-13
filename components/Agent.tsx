"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Vapi from "@vapi-ai/web";

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

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();

  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<any>(null);
  const feedbackGenerated = useRef(false);
  // Always holds the latest messages — avoids stale closure in the FINISHED effect
  const messagesRef = useRef<SavedMessage[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN!);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setCallStatus(CallStatus.ACTIVE);
      setError(null);
    });

    vapi.on("speech-start", () => setIsSpeaking(true));
    vapi.on("speech-end", () => setIsSpeaking(false));

    vapi.on("message", (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const role: "user" | "assistant" =
          message.role === "user" ? "user" : "assistant";
        const newMsg: SavedMessage = { role, content: message.transcript };
        // Update both state (UI) and ref (for post-call effect to avoid stale closure)
        setMessages((prev) => {
          const updated = [...prev, newMsg];
          messagesRef.current = updated;
          return updated;
        });
      }
    });

    vapi.on("call-end", () => {
      setIsSpeaking(false);
      setCallStatus(CallStatus.FINISHED);
    });

    vapi.on("error", (err: any) => {
      console.error("Vapi error:", err);
      setError("Voice connection error. Please try again.");
      setCallStatus(CallStatus.INACTIVE);
    });

    return () => {
      vapi.stop();
      vapi.removeAllListeners();
    };
  }, []);

  const handleCall = () => {
    setCallStatus(CallStatus.CONNECTING);
    setError(null);

    const assistantId =
      type === "generate"
        ? process.env.NEXT_PUBLIC_VAPI_SETUP_ASSISTANT_ID!
        : process.env.NEXT_PUBLIC_VAPI_INTERVIEW_ASSISTANT_ID!;

    const assistantOverride: any =
      type === "interview" && questions
        ? { variableValues: { questions: questions.join(", ") } }
        : {};

    vapiRef.current?.start(assistantId, assistantOverride);
  };

  const handleDisconnect = () => {
    vapiRef.current?.stop();
    setCallStatus(CallStatus.FINISHED);
  };

  /* ---- Post-call: generate interview or feedback ---- */
  useEffect(() => {
    if (callStatus !== CallStatus.FINISHED) return;
    if (feedbackGenerated.current) return;
    feedbackGenerated.current = true;

    setIsProcessing(true);

    if (type === "generate") {
      /* 
        Use messagesRef (not messages state) so we always get the full transcript,
        even if React batched the last transcript updates with the call-end event.
      */
      const fullTranscript = messagesRef.current
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      console.log("Generate transcript:", fullTranscript);
      console.log("Message count:", messagesRef.current.length);

      const generateInterview = async () => {
        try {
          const res = await fetch("/api/vapi/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: fullTranscript,
              userid: userId,
            }),
          });
          const data = await res.json();
          if (data.success) {
            router.push(`/interview/${data.interviewId}`);
          } else {
            setError("Failed to generate interview. Redirecting…");
            setTimeout(() => router.push("/"), 2000);
          }
        } catch (err) {
          console.error("Interview generation error:", err);
          setError("Failed to generate interview. Redirecting…");
          setTimeout(() => router.push("/"), 2000);
        } finally {
          setIsProcessing(false);
        }
      };
      generateInterview();
    } else {
      const generateFeedback = async () => {
        try {
          if (!interviewId || !userId) {
            router.push("/");
            return;
          }

          const savedMessages = messagesRef.current.filter(
            (m) => m.role === "user" || m.role === "assistant"
          );

          if (savedMessages.length === 0) {
            console.warn("No messages found after interview — cannot generate feedback");
            router.push("/");
            return;
          }

          const { success, feedbackId: id } = await createFeedback({
            interviewId,
            userId,
            transcript: savedMessages,
            feedbackId,
          });

          if (success && id) {
            router.push(`/interview/${interviewId}/feedback`);
          } else {
            router.push("/");
          }
        } catch (err) {
          console.error("Feedback error:", err);
          setError("Failed to generate feedback. Redirecting…");
          setTimeout(() => router.push("/"), 2000);
        } finally {
          setIsProcessing(false);
        }
      };
      generateFeedback();
    }
  }, [callStatus, type, interviewId, userId, feedbackId, router]);

  const lastMessage = messages[messages.length - 1];

  const getStatusLabel = () => {
    if (callStatus === CallStatus.CONNECTING) return "Connecting…";
    if (callStatus === CallStatus.ACTIVE && isSpeaking) return "AI Speaking…";
    if (callStatus === CallStatus.ACTIVE) return "Listening…";
    if (callStatus === CallStatus.FINISHED && isProcessing)
      return type === "generate"
        ? "Generating your interview…"
        : "Generating feedback…";
    return "";
  };

  /* -------- Render -------- */
  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="w-16 h-16 border-4 border-primary-200 border-t-transparent rounded-full animate-spin" />
        <p className="text-lg font-medium text-primary-200">
          {type === "generate"
            ? "Generating your custom interview…"
            : "Analysing your interview and generating feedback…"}
        </p>
        <p className="text-sm text-gray-400">This may take a few seconds</p>
      </div>
    );
  }

  return (
    <>
      {/* Cards */}
      <div className="call-view">
        {/* AI Interviewer */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="AI Interviewer"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt={userName || "user not found"}
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {/* Status badge */}
      {getStatusLabel() && (
        <p className="text-center text-sm text-primary-200 animate-pulse mt-2">
          {getStatusLabel()}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-red-400 mt-2">{error}</p>
      )}

      {/* Live transcript */}
      <div className="transcript-border">
        <div className="transcript" key={lastMessage?.content}>
          <p className="animate-fadeIn opacity-100 transition-all duration-300">
            {lastMessage?.content ??
              (callStatus === CallStatus.ACTIVE ||
                callStatus === CallStatus.CONNECTING
                ? "Connecting to AI Interviewer…"
                : "")}
          </p>
        </div>
      </div>

      {/* Call Controls */}
      <div className="w-full flex flex-col items-center gap-4 mt-6">
        {callStatus === CallStatus.INACTIVE && (
          <button className="relative btn-call" onClick={handleCall}>
            <span className="relative z-10">Start Call</span>
          </button>
        )}

        {callStatus === CallStatus.CONNECTING && (
          <button className="relative btn-call opacity-60 cursor-not-allowed" disabled>
            Connecting…
          </button>
        )}

        {callStatus === CallStatus.ACTIVE && (
          <button className="btn-disconnect" onClick={handleDisconnect}>
            End Call
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;