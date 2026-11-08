export type EsimUsageCategory =
  | "calls-and-texts"
  | "internet-only"
  | "calls-only"
  | "texts-only"
  | "not-specified";

/**
 * Classify only explicit supplier-listed voice/SMS booleans. Missing features
 * stay unclassified rather than being marketed as data-only or voice-capable.
 */
export function classifyEsimUsage(
  supportsVoice: boolean | null | undefined,
  supportsSms: boolean | null | undefined,
): EsimUsageCategory {
  if (supportsVoice === true && supportsSms === true) return "calls-and-texts";
  if (supportsVoice === false && supportsSms === false) return "internet-only";
  if (supportsVoice === true && supportsSms === false) return "calls-only";
  if (supportsVoice === false && supportsSms === true) return "texts-only";
  return "not-specified";
}

export const ESIM_USAGE_LABELS: Record<EsimUsageCategory, string> = {
  "calls-and-texts": "Calls & texts",
  "internet-only": "Internet only",
  "calls-only": "Calls only",
  "texts-only": "Texts only",
  "not-specified": "Not fully specified",
};
