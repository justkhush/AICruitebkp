import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";

import { db } from "@/firebase/admin";
import { getRandomInterviewCover } from "@/lib/utils";

export async function POST(request: Request) {
  console.log("POST /api/vapi/generate triggered");

  try {
    const body = await request.json();
    const { transcript, userid } = body;

    // Guard: userid is required — Firestore will throw on undefined fields
    if (!userid) {
      return Response.json(
        { success: false, error: "Missing userId" },
        { status: 400 }
      );
    }

    const transcriptStr = typeof transcript === "string" ? transcript.trim() : "";
    const hasTranscript = transcriptStr.length > 20;

    console.log("Incoming transcript length:", transcriptStr.length);

    // ── Step 1: Extract interview parameters ──
    // Start with safe defaults in case transcript is empty or Groq fails
    let roleStr = "software engineer";
    let levelStr = "junior";
    let techstackStr = "javascript";
    let typeStr = "technical";
    const amountNum = 5;

    if (hasTranscript) {
      try {
        const { text: extractionText } = await generateText({
          model: groq("llama-3.3-70b-versatile"),
          prompt: `
You are a data extraction assistant.
A user just finished a voice conversation with an AI setup assistant collecting information to create a custom job interview.
Extract the following from the transcript below.

Transcript:
${transcriptStr}

Return ONLY valid JSON (no markdown, no explanation):
{
  "role": "the job role (e.g. frontend developer, backend engineer)",
  "level": "one of: junior, mid, senior, lead",
  "techstack": "comma-separated technologies (e.g. react,nodejs,typescript)",
  "type": "one of: technical, behavioral, mixed"
}

Use sensible defaults if not mentioned:
- role: "software engineer"
- level: "junior"
- techstack: "javascript"
- type: "technical"
`,
        });

        console.log("Groq extraction output:", extractionText);

        const cleaned = extractionText.replace(/```json/g, "").replace(/```/g, "").trim();
        const extracted = JSON.parse(cleaned);

        if (typeof extracted.role === "string" && extracted.role.trim()) roleStr = extracted.role.trim();
        if (typeof extracted.level === "string" && extracted.level.trim()) levelStr = extracted.level.trim();
        if (typeof extracted.techstack === "string" && extracted.techstack.trim()) techstackStr = extracted.techstack.trim();
        if (typeof extracted.type === "string" && extracted.type.trim()) typeStr = extracted.type.trim();
      } catch (extractErr) {
        console.error("Extraction failed, using defaults:", extractErr);
        // Defaults already set above — continue safely
      }
    }

    console.log("Using params:", { roleStr, levelStr, techstackStr, typeStr, amountNum });

    // ── Step 2: Generate interview questions ──
    const { text: questionsText } = await generateText({
      model: groq("llama-3.3-70b-versatile"),
      prompt: `
Prepare questions for a job interview.

Role: ${roleStr}
Experience level: ${levelStr}
Tech stack: ${techstackStr}
Focus type: ${typeStr}
Number of questions: ${amountNum}

Return ONLY a JSON array like:
["Question 1","Question 2","Question 3"]

Do not include extra text.
Avoid special characters like / * etc.
`,
    });

    console.log("Groq questions raw:", questionsText);

    let parsedQuestions: string[];
    try {
      const cleanedQ = questionsText.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedQuestions = JSON.parse(cleanedQ);
      if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
        throw new Error("Empty or invalid questions array");
      }
    } catch {
      console.error("JSON Parse Failed for questions, using fallbacks");
      parsedQuestions = [
        `Tell me about your experience as a ${roleStr}.`,
        `What technologies have you worked with in your ${levelStr} role?`,
        `Describe a challenging problem you solved recently.`,
        "How do you stay up to date with new developments in your field?",
        "Where do you see yourself in the next 2-3 years?",
      ];
    }

    // Build the Firestore document — every field must be defined
    const interview = {
      role: roleStr,
      type: typeStr,
      level: levelStr,
      techstack: techstackStr.split(",").map((t: string) => t.trim()).filter(Boolean),
      questions: parsedQuestions,
      userId: userid,         // already guarded above
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    console.log("Saving interview to Firestore...");
    const docRef = await db.collection("interviews").add(interview);
    console.log("Interview created:", docRef.id);

    return Response.json({ success: true, interviewId: docRef.id });
  } catch (error) {
    console.error("API ERROR:", error);
    return Response.json(
      { success: false, error: "Failed to create interview" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({ success: true, message: "Interview API working" }, { status: 200 });
}