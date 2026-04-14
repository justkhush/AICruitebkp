"use server";

import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { revalidatePath } from "next/cache";


import { db } from "@/firebase/admin";

/* -----------------------------
   CREATE FEEDBACK
------------------------------*/
export async function createFeedback(params: CreateFeedbackParams) {
  console.log("createFeedback called with:", params);

  const { interviewId, userId, transcript, feedbackId } = params;

  try {
    if (!interviewId || !userId) {
      console.error("Missing interviewId or userId");
      return { success: false };
    }

    const filteredTranscript = transcript.filter(
      (msg) => msg.role === "user" || msg.role === "assistant"
    );

    const formattedTranscript = filteredTranscript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    let text = "";
    try {
      const response = await generateText({
        model: groq("llama-3.3-70b-versatile"),
        prompt: `
You are an AI interviewer evaluating a candidate.

Transcript:
${formattedTranscript}

Return ONLY valid JSON:

{
  "totalScore": number,
  "categoryScores": {
    "communication": number,
    "technical": number,
    "problemSolving": number,
    "cultureFit": number,
    "confidence": number
  },
  "strengths": string[],
  "areasForImprovement": string[],
  "finalAssessment": string
}
`,
      });
      text = response.text;
    } catch (err) {
      console.error("Groq generation failed. Using fallback.", err);
    }

    let parsed;

    if (text) {
      try {
        console.log("AI Feedback Raw Output:", text);
        const cleanedText = text
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
        
        try {
          parsed = JSON.parse(cleanedText);
        } catch {
          const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("No JSON found");
          }
        }
      } catch (err) {
        console.error("AI JSON parse failed. Using fallback.", err);
      }
    }

    // HARD FALLBACK: If parsed is still undefined because Groq failed OR Parse failed
    if (!parsed) {
      parsed = {
        totalScore: 0,
        categoryScores: {
          communication: 0,
          technical: 0,
          problemSolving: 0,
          cultureFit: 0,
          confidence: 0,
        },
        strengths: ["None (Not enough data)"],
        areasForImprovement: ["Speak more during the interview so the AI has data to evaluate."],
        finalAssessment: "The interview was too short or the AI encountered an error processing your transcript. Please try again and provide detailed answers.",
      };
    }

    const feedback = {
      interviewId,
      userId,
      totalScore: parsed?.totalScore ?? 0,
      categoryScores: parsed?.categoryScores ?? {},
      strengths: parsed?.strengths ?? [],
      areasForImprovement: parsed?.areasForImprovement ?? [],
      finalAssessment: parsed?.finalAssessment ?? "",
      createdAt: new Date().toISOString(),
    };

    let feedbackRef;

    if (feedbackId) {
      feedbackRef = db.collection("feedback").doc(feedbackId);
    } else {
      feedbackRef = db.collection("feedback").doc();
    }

    await feedbackRef.set(feedback);

    revalidatePath("/");
    revalidatePath(`/interview/${interviewId}/feedback`);

    return { success: true, feedbackId: feedbackRef.id };
  } catch (error) {
    console.error("Error saving feedback:", error);
    return { success: false };
  }
}

/* -----------------------------
   GET INTERVIEW BY ID
------------------------------*/
export async function getInterviewById(
  id: string
): Promise<Interview | null> {
  const interview = await db.collection("interviews").doc(id).get();

  if (!interview.exists) return null;

  return {
    id: interview.id,
    ...interview.data(),
  } as Interview;
}

/* -----------------------------
   GET FEEDBACK BY INTERVIEW (FIXED)
------------------------------*/
export async function getFeedbackByInterviewId(
  params: GetFeedbackByInterviewIdParams
): Promise<Feedback | null> {
  const { interviewId, userId } = params;

  // 🔥 guard
  if (!interviewId || !userId) return null;

  const querySnapshot = await db
    .collection("feedback")
    .where("interviewId", "==", interviewId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (querySnapshot.empty) return null;

  const feedbackDoc = querySnapshot.docs[0];

  return {
    id: feedbackDoc.id,
    ...feedbackDoc.data(),
  } as Feedback;
}

/* -----------------------------
   GET LATEST INTERVIEWS
------------------------------*/
export async function getLatestInterviews(
  params: GetLatestInterviewsParams
): Promise<Interview[] | null> {
  const { userId, limit = 20 } = params;

  let query: any = db.collection("interviews").where("finalized", "==", true);
  if (userId) {
    query = query.where("userId", "!=", userId).orderBy("userId");
  }

  const interviews = await query
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return interviews.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}

/* -----------------------------
   GET USER INTERVIEWS (FIXED)
------------------------------*/
export async function getInterviewsByUserId(
  userId: string
): Promise<Interview[] | null> {
  // 🔥 guard (fix your crash)
  if (!userId) return [];

  const interviews = await db
    .collection("interviews")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return interviews.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  })) as Interview[];
}