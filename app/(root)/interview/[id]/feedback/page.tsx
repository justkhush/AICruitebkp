import dayjs from "dayjs";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import {
  getFeedbackByInterviewId,
  getInterviewById,
} from "@/lib/actions/general.action";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/actions/auth.action";

const Feedback = async ({ params }: RouteParams) => {
  const { id } = await params;
  const user = await getCurrentUser();

  const interview = await getInterviewById(id);
  if (!interview) redirect("/");

  const feedback = await getFeedbackByInterviewId({
    interviewId: id,
    userId: user?.id!,
  });

  if (!feedback) redirect("/");

  // Normalize categoryScores: Groq returns a plain object { communication: 80 }
  // but the old schema typed it as an array. Handle both safely.
  const rawScores = feedback?.categoryScores ?? {};
  const categoryEntries: [string, number][] = Array.isArray(rawScores)
    ? rawScores.map((item: any) => [item.name, item.score])
    : Object.entries(rawScores as Record<string, number>);

  const scoreColor = (score: number) => {
    if (score >= 80) return "#22c55e"; // green
    if (score >= 60) return "#f59e0b"; // amber
    return "#ef4444"; // red
  };

  return (
    <section className="section-feedback">
      {/* Header */}
      <div className="flex flex-col gap-2 items-center text-center">
        <h1 className="text-4xl font-semibold">
          Interview Feedback —{" "}
          <span className="capitalize text-primary-200">{interview.role}</span>
        </h1>
        <div className="flex flex-row gap-5 mt-2 flex-wrap justify-center">
          {/* Overall Score */}
          <div className="flex flex-row gap-2 items-center">
            <Image src="/star.svg" width={22} height={22} alt="star" />
            <p>
              Overall Score:{" "}
              <span
                className="font-bold text-lg"
                style={{ color: scoreColor(feedback.totalScore) }}
              >
                {feedback.totalScore}
              </span>
              <span className="text-gray-400">/100</span>
            </p>
          </div>
          {/* Date */}
          <div className="flex flex-row gap-2 items-center">
            <Image
              src="/calendar.svg"
              width={22}
              height={22}
              alt="calendar"
            />
            <p className="text-gray-400">
              {feedback?.createdAt
                ? dayjs(feedback.createdAt).format("MMM D, YYYY h:mm A")
                : "N/A"}
            </p>
          </div>
        </div>
      </div>

      <hr className="border-dark-300 my-2" />

      {/* Final Assessment */}
      <div className="bg-dark-200 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-2">📋 Final Assessment</h2>
        <p className="text-gray-300 leading-relaxed">{feedback.finalAssessment}</p>
      </div>

      {/* Score Breakdown */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">📊 Score Breakdown</h2>
        <div className="grid grid-cols-1 gap-3">
          {categoryEntries.map(([name, score], index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span className="capitalize font-medium">{name}</span>
                <span
                  className="font-bold"
                  style={{ color: scoreColor(score) }}
                >
                  {score}/100
                </span>
              </div>
              <div className="w-full bg-dark-300 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${score}%`,
                    backgroundColor: scoreColor(score),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strengths & Areas for Improvement */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Strengths */}
        <div className="bg-dark-200 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-semibold text-green-400">✅ Strengths</h3>
          <ul className="flex flex-col gap-2">
            {feedback?.strengths?.map((strength, index) => (
              <li key={index} className="flex gap-2 items-start text-sm text-gray-300">
                <span className="text-green-400 mt-0.5">•</span>
                {strength}
              </li>
            ))}
          </ul>
        </div>

        {/* Areas for Improvement */}
        <div className="bg-dark-200 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-semibold text-amber-400">📈 Areas to Improve</h3>
          <ul className="flex flex-col gap-2">
            {feedback?.areasForImprovement?.map((area, index) => (
              <li key={index} className="flex gap-2 items-start text-sm text-gray-300">
                <span className="text-amber-400 mt-0.5">•</span>
                {area}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="buttons">
        <Button className="btn-secondary flex-1">
          <Link href="/" className="flex w-full justify-center">
            <p className="text-sm font-semibold text-primary-200 text-center">
              Back to Dashboard
            </p>
          </Link>
        </Button>

        <Button className="btn-primary flex-1">
          <Link
            href={`/interview/${id}`}
            className="flex w-full justify-center"
          >
            <p className="text-sm font-semibold text-black text-center">
              Retake Interview
            </p>
          </Link>
        </Button>
      </div>
    </section>
  );
};

export default Feedback;