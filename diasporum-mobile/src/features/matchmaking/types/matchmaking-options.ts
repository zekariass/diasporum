import type { FieldVisibility } from './matchmaking-types';

export interface Choice<T extends string = string> {
  value: T;
  label: string;
}

export const VISIBILITIES: Choice<FieldVisibility>[] = [
  { value: 'VISIBLE', label: 'Visible' },
  { value: 'BLURRED', label: 'Blurred' },
  { value: 'HIDDEN', label: 'Hidden' },
];

export const EDUCATION: Choice[] = [
  ['SECONDARY', 'Secondary'], ['VOCATIONAL', 'Vocational'],
  ['UNDERGRADUATE', 'Undergraduate'], ['POSTGRADUATE', 'Postgraduate'],
  ['DOCTORATE', 'Doctorate'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
].map(([value, label]) => ({ value, label }));

export const INTENTIONS: Choice[] = [
  ['MARRIAGE', 'Marriage'], ['SERIOUS_RELATIONSHIP', 'Serious relationship'],
  ['LONG_TERM_DATING', 'Long-term dating'], ['NOT_SURE_YET', 'Not sure yet'],
].map(([value, label]) => ({ value, label }));

export const MARITAL_STATUSES: Choice[] = [
  ['NEVER_MARRIED', 'Never married'], ['MARRIED', 'Married'], ['SEPARATED', 'Separated'],
  ['DIVORCED', 'Divorced'], ['WIDOWED', 'Widowed'], ['OTHER', 'Other'],
  ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
].map(([value, label]) => ({ value, label }));

export const WANTS_CHILDREN: Choice[] = [
  ['YES', 'Yes'], ['NO', 'No'], ['UNSURE', 'Unsure'], ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
].map(([value, label]) => ({ value, label }));

export const HABITS: Choice[] = [
  ['NO', 'No'], ['OCCASIONALLY', 'Occasionally'], ['YES', 'Yes'],
  ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
].map(([value, label]) => ({ value, label }));

export const ACTIVITY_LEVELS: Choice[] = [
  ['LOW', 'Low'], ['MODERATE', 'Moderate'], ['HIGH', 'High'], ['VERY_HIGH', 'Very high'],
  ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
].map(([value, label]) => ({ value, label }));

export const MARRIAGE_TIMELINES: Choice[] = [
  ['ASAP', 'As soon as possible'], ['WITHIN_1_YEAR', 'Within 1 year'],
  ['1_2_YEARS', '1–2 years'], ['2_PLUS_YEARS', '2+ years'], ['UNSURE', 'Unsure'],
  ['NOT_APPLICABLE', 'Not applicable'],
].map(([value, label]) => ({ value, label }));

export const RELIGION_IMPORTANCE: Choice[] = [
  ['DEAL_BREAKER', 'Deal breaker'], ['VERY_IMPORTANT', 'Very important'],
  ['SOMEWHAT_IMPORTANT', 'Somewhat important'], ['NOT_IMPORTANT', 'Not important'],
].map(([value, label]) => ({ value, label }));

export const CHILDREN_PREFERENCES: Choice[] = [
  { value: 'ANY', label: 'Any' }, { value: 'YES', label: 'Has children' },
  { value: 'NO', label: 'No children' },
];

export const WANTS_CHILDREN_PREFERENCES: Choice[] = [
  { value: 'ANY', label: 'Any' }, { value: 'YES', label: 'Wants children' },
  { value: 'NO', label: 'Does not want children' }, { value: 'UNSURE', label: 'Unsure' },
];

export function optionLabel(value: string | null, options: Choice[], fallback = 'Not specified'): string {
  return options.find(option => option.value === value)?.label ?? fallback;
}
