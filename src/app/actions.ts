'use server';

import { detectAnomalies, type DetectAnomaliesInput, type DetectAnomaliesOutput } from '@/ai/flows/detect-anomalies';

export async function runAnomalyDetection(input: DetectAnomaliesInput): Promise<DetectAnomaliesOutput> {
  try {
    const result = await detectAnomalies(input);
    return result;
  } catch (error) {
    console.error("Error in anomaly detection flow:", error);
    // Return a default error-like response if the flow fails
    return {
      isAnomaly: true,
      anomalyDescription: "Could not perform AI analysis due to an internal error. Please check the system logs.",
    };
  }
}
