/**
 * Diasporum design-system colour tokens.
 * Primary brand colour: purple (#7C3AED / Violet 600).
 */

export const BrandColors = {
  /** Primary brand purple */
  primary: '#7C3AED',
  primaryLight: '#A78BFA',
  primaryDark: '#5B21B6',
  primarySurface: '#EDE9FE',

  /** Neutrals */
  white: '#FFFFFF',
  black: '#000000',

  /** Semantic */
  success: '#16A34A',
  successSurface: '#DCFCE7',
  warning: '#D97706',
  warningSurface: '#FEF3C7',
  error: '#DC2626',
  errorSurface: '#FEE2E2',
  info: '#2563EB',
  infoSurface: '#DBEAFE',
} as const;

export const LightColors = {
  /* Surfaces */
  background: '#FFFFFF',
  surface: '#F5F3FF', // very light purple tint
  surfaceElement: '#EDE9FE',
  surfaceSelected: '#DDD6FE',
  border: '#E5E7EB',

  /* Text */
  text: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#9CA3AF',
  textOnPrimary: '#FFFFFF',

  /* Brand */
  primary: BrandColors.primary,
  primaryLight: BrandColors.primaryLight,
  primaryDark: BrandColors.primaryDark,
  primarySurface: BrandColors.primarySurface,

  /* Semantic */
  success: BrandColors.success,
  successSurface: BrandColors.successSurface,
  warning: BrandColors.warning,
  warningSurface: BrandColors.warningSurface,
  error: BrandColors.error,
  errorSurface: BrandColors.errorSurface,
} as const;

export const DarkColors = {
  /* Surfaces */
  background: '#0F0E17',
  surface: '#1A1825',
  surfaceElement: '#252136',
  surfaceSelected: '#302B4A',
  border: '#374151',

  /* Text */
  text: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textDisabled: '#6B7280',
  textOnPrimary: '#FFFFFF',

  /* Brand */
  primary: BrandColors.primaryLight,
  primaryLight: '#C4B5FD',
  primaryDark: BrandColors.primary,
  primarySurface: '#2E1B6E',

  /* Semantic */
  success: '#4ADE80',
  successSurface: '#14532D',
  warning: '#FCD34D',
  warningSurface: '#78350F',
  error: '#F87171',
  errorSurface: '#7F1D1D',
} as const;

export type ColorTokens = typeof LightColors;
export type ColorToken = keyof ColorTokens;
