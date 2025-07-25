'use server';

/**
 * @fileOverview Detects anomalies in sensor data and alerts the user to potential problems.
 *
 * - detectAnomalies - A function that handles the anomaly detection process.
 * - DetectAnomaliesInput - The input type for the detectAnomalies function.
 * - DetectAnomaliesOutput - The return type for the detectAnomalies function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DetectAnomaliesInputSchema = z.object({
  ph: z.number().nullable().describe('The pH value of the water.'),
  do_conc: z.number().nullable().describe('The dissolved oxygen concentration in mg/L.'),
  do_sat: z.number().nullable().describe('The dissolved oxygen saturation in percentage.'),
  temp: z.number().nullable().describe('The temperature of the water in degrees Celsius.'),
  timestamp: z.string().describe('The timestamp of the sensor reading.'),
  simulation_cycle: z.number().describe('The simulation cycle count.'),
});
export type DetectAnomaliesInput = z.infer<typeof DetectAnomaliesInputSchema>;

const DetectAnomaliesOutputSchema = z.object({
  isAnomaly: z.boolean().describe('Whether an anomaly is detected in the sensor data.'),
  anomalyDescription: z
    .string()
    .describe('A description of the anomaly detected, if any, along with suggested actions.'),
});
export type DetectAnomaliesOutput = z.infer<typeof DetectAnomaliesOutputSchema>;

export async function detectAnomalies(input: DetectAnomaliesInput): Promise<DetectAnomaliesOutput> {
  return detectAnomaliesFlow(input);
}

const detectAnomaliesPrompt = ai.definePrompt({
  name: 'detectAnomaliesPrompt',
  input: {schema: DetectAnomaliesInputSchema},
  output: {schema: DetectAnomaliesOutputSchema},
  prompt: `You are an expert water quality analyst. You will receive sensor data from a water quality monitoring system and determine if there are any anomalies.

  Respond with whether an anomaly is present, and if so, describe the anomaly and suggest actions to take.

  Sensor Data:
  - pH: {{ph}}
  - Dissolved Oxygen Concentration: {{do_conc}} mg/L
  - Dissolved Oxygen Saturation: {{do_sat}}%
  - Temperature: {{temp}} °C
  - Timestamp: {{timestamp}}
  - Simulation Cycle: {{simulation_cycle}}

  Consider these factors when determining anomalies:
  - Expected ranges for pH (6.5 - 8.5), dissolved oxygen concentration (4-12 mg/L), and dissolved oxygen saturation (80-110%).
  - Sudden changes or unusual patterns in the data.

  Respond concisely, but completely.
  {
    "isAnomaly": true|false,
    "anomalyDescription": "Description of the anomaly and suggested actions."
  }`,
});

const detectAnomaliesFlow = ai.defineFlow(
  {
    name: 'detectAnomaliesFlow',
    inputSchema: DetectAnomaliesInputSchema,
    outputSchema: DetectAnomaliesOutputSchema,
  },
  async input => {
    const {output} = await detectAnomaliesPrompt(input);
    return output!;
  }
);
