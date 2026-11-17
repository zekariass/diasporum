export const PROOF_REFERENCE_MAX = 200;
export const PROOF_NOTES_MAX = 1000;

export interface ProofFormValues {
  proofReference: string;
  mediaObjectId?: string | null;
  notes: string;
}

export interface ProofFormErrors {
  proofReference?: string;
  notes?: string;
  form?: string;
}

export function validateProof(v: ProofFormValues): ProofFormErrors {
  const errors: ProofFormErrors = {};
  const ref = v.proofReference.trim();
  if (!ref && !v.mediaObjectId) {
    errors.form = "Enter your transfer reference or attach a receipt photo.";
  }
  if (ref.length > PROOF_REFERENCE_MAX) {
    errors.proofReference = `Reference must be ${PROOF_REFERENCE_MAX} characters or fewer.`;
  }
  if (v.notes.trim().length > PROOF_NOTES_MAX) {
    errors.notes = `Notes must be ${PROOF_NOTES_MAX} characters or fewer.`;
  }
  return errors;
}

export function hasProofErrors(e: ProofFormErrors): boolean {
  return Object.keys(e).length > 0;
}
