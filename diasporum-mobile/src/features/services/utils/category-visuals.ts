/**
 * Category artwork for the service catalogue. The API does not carry
 * category imagery, so tiles resolve a curated photo by `categoryKey`
 * (children inherit their parent's photo when unmapped) and always keep
 * an icon + tint fallback for offline/error states.
 */
import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

import type { ServiceCategory } from "../types/service-marketplace-types";

export type ServiceIcon = ComponentProps<typeof Ionicons>["name"];

export interface CategoryVisual {
  image?: string;
  icon: ServiceIcon;
  tint: string;
}

const img = (photoId: string) =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=900&q=80`;

const VISUALS: Record<string, CategoryVisual> = {
  // ------------------------------------------------------ parent categories
  HOME_MAINTENANCE: {
    image: img("1581578731548-c64695cc6952"),
    icon: "home-outline",
    tint: "#E8F2EC",
  },
  HOME_IMPROVEMENT: {
    image: img("1562259949-e8e7689d7828"),
    icon: "construct-outline",
    tint: "#E9EEF8",
  },
  AUTOMOTIVE: {
    image: img("1486262715619-67b85e0b08d3"),
    icon: "car-outline",
    tint: "#F3E8F8",
  },
  WELLNESS_BEAUTY: {
    image: img("1560066984-138dadb4c035"),
    icon: "sparkles-outline",
    tint: "#F8E8EF",
  },
  EDUCATION_TUTORING: {
    image: img("1503676260728-1c00da094a0b"),
    icon: "school-outline",
    tint: "#E8F1F8",
  },
  EVENTS_CREATIVE: {
    image: img("1492684223066-81342ee5ff30"),
    icon: "calendar-outline",
    tint: "#F8F0E3",
  },
  BUSINESS_DIGITAL: {
    image: img("1497366216548-37526070297c"),
    icon: "briefcase-outline",
    tint: "#E8F0F8",
  },
  CARE_SUPPORT: {
    image: img("1516307365426-bea591f05011"),
    icon: "heart-outline",
    tint: "#F8EAE4",
  },
  MOVING_TRANSPORT: {
    image: img("1600518464441-9154a4dea21b"),
    icon: "cube-outline",
    tint: "#E9F4F0",
  },

  // ------------------------------------------------------ child services
  GARDENING: {
    image: img("1416879595882-3373a0480b5b"),
    icon: "leaf-outline",
    tint: "#E8F2EC",
  },
  PEST_CONTROL: { icon: "bug-outline", tint: "#E8F2EC" },
  HOUSE_CLEANING: {
    image: img("1581578731548-c64695cc6952"),
    icon: "sparkles-outline",
    tint: "#E8F2EC",
  },
  HANDYMAN: {
    image: img("1621905251189-08b45d6a269e"),
    icon: "hammer-outline",
    tint: "#E8F2EC",
  },
  PLUMBING: {
    image: img("1607472586893-edb57bdc0e39"),
    icon: "water-outline",
    tint: "#E8F2EC",
  },
  ELECTRICAL_WORK: {
    image: img("1621905252507-b35492cc74b4"),
    icon: "flash-outline",
    tint: "#E8F2EC",
  },
  HEATING_COOLING: { icon: "thermometer-outline", tint: "#E8F2EC" },
  WINDOW_CLEANING: { icon: "browsers-outline", tint: "#E8F2EC" },
  PAINTING_DECORATION_INTERIOR: {
    image: img("1562259949-e8e7689d7828"),
    icon: "color-palette-outline",
    tint: "#E9EEF8",
  },
  CCTV_INSTALLATION_DOMESTIC: {
    image: img("1557324232-b8917d3c3dcb"),
    icon: "videocam-outline",
    tint: "#E9EEF8",
  },
  CARPENTRY_JOINERY: {
    image: img("1504148455328-c376907d081c"),
    icon: "hand-left-outline",
    tint: "#E9EEF8",
  },
  FLOORING_TILING: { icon: "grid-outline", tint: "#E9EEF8" },
  ROOFING_GUTTERING: { icon: "umbrella-outline", tint: "#E9EEF8" },
  KITCHEN_BATHROOM_FITTING: {
    image: img("1556911220-bff31c812dba"),
    icon: "restaurant-outline",
    tint: "#E9EEF8",
  },
  PLASTERING_RENDERING: { icon: "layers-outline", tint: "#E9EEF8" },
  MOBILE_MECHANIC: { icon: "build-outline", tint: "#F3E8F8" },
  CAR_WASH_DETAILING: {
    image: img("1520340356584-f9917d1eea6f"),
    icon: "car-sport-outline",
    tint: "#F3E8F8",
  },
  TYRES_BATTERIES: { icon: "disc-outline", tint: "#F3E8F8" },
  AUTO_ELECTRICAL: { icon: "battery-charging-outline", tint: "#F3E8F8" },
  HAIRDRESSING: {
    image: img("1560066984-138dadb4c035"),
    icon: "cut-outline",
    tint: "#F8E8EF",
  },
  BARBERING: {
    image: img("1503951914875-452162b0f3f1"),
    icon: "man-outline",
    tint: "#F8E8EF",
  },
  MASSAGE_THERAPY: {
    image: img("1544161515-4ab6ce6db874"),
    icon: "body-outline",
    tint: "#F8E8EF",
  },
  NAILS_BEAUTY: { icon: "hand-left-outline", tint: "#F8E8EF" },
  PERSONAL_TRAINING: {
    image: img("1571019613454-1cb2f99b2d8b"),
    icon: "barbell-outline",
    tint: "#F8E8EF",
  },
  PHYSIOTHERAPY: { icon: "medkit-outline", tint: "#F8E8EF" },
  LANGUAGE_TUTORING: { icon: "language-outline", tint: "#E8F1F8" },
  ACADEMIC_TUTORING: { icon: "book-outline", tint: "#E8F1F8" },
  MUSIC_LESSONS: { icon: "musical-notes-outline", tint: "#E8F1F8" },
  DRIVING_LESSONS: {
    image: img("1449965408869-eaa3f722e40d"),
    icon: "speedometer-outline",
    tint: "#E8F1F8",
  },
  EXAM_PREPARATION: { icon: "document-text-outline", tint: "#E8F1F8" },
  PHOTOGRAPHY: {
    image: img("1452587925148-ce544e77e70d"),
    icon: "camera-outline",
    tint: "#F8F0E3",
  },
  VIDEOGRAPHY: { icon: "film-outline", tint: "#F8F0E3" },
  EVENT_CATERING: { icon: "fast-food-outline", tint: "#F8F0E3" },
  DJ_LIVE_MUSIC: {
    image: img("1470225620780-dba8ba36b745"),
    icon: "headset-outline",
    tint: "#F8F0E3",
  },
  EVENT_PLANNING: { icon: "clipboard-outline", tint: "#F8F0E3" },
  WEB_APP_DEVELOPMENT: {
    image: img("1498050108023-c5249f4df085"),
    icon: "code-slash-outline",
    tint: "#E8F0F8",
  },
  GRAPHIC_DESIGN: { icon: "brush-outline", tint: "#E8F0F8" },
  DIGITAL_MARKETING: { icon: "megaphone-outline", tint: "#E8F0F8" },
  ACCOUNTING_BOOKKEEPING: { icon: "calculator-outline", tint: "#E8F0F8" },
  LEGAL_SERVICES: { icon: "scale-outline", tint: "#E8F0F8" },
  TRANSLATION_INTERPRETING: { icon: "globe-outline", tint: "#E8F0F8" },
  CHILDCARE_BABYSITTING: {
    image: img("1503454537195-1dcabb73ffb9"),
    icon: "happy-outline",
    tint: "#F8EAE4",
  },
  ELDERLY_CARE: { icon: "people-outline", tint: "#F8EAE4" },
  PET_CARE_DOG_WALKING: {
    image: img("1450778869180-41d0601e046e"),
    icon: "paw-outline",
    tint: "#F8EAE4",
  },
  HOUSE_SITTING: { icon: "key-outline", tint: "#F8EAE4" },
  REMOVALS_MOVING: { icon: "archive-outline", tint: "#E9F4F0" },
  DELIVERY_COURIER: { icon: "bicycle-outline", tint: "#E9F4F0" },
  VAN_MAN_HIRE: { icon: "bus-outline", tint: "#E9F4F0" },
};

const FALLBACK: CategoryVisual = { icon: "briefcase-outline", tint: "#EDE9FE" };

/**
 * Artwork for one category: its own photo/icon when mapped, otherwise the
 * parent category's photo with the child icon, otherwise a neutral tile.
 */
export function categoryVisual(
  category: ServiceCategory,
  categories: ServiceCategory[],
): CategoryVisual {
  const own = VISUALS[category.categoryKey];
  let inherited: CategoryVisual | undefined;
  let current = category;
  let guard = 0;
  while (!inherited && current.parentId && guard++ < 10) {
    const parent = categories.find((item) => item.id === current.parentId);
    if (!parent) break;
    inherited = VISUALS[parent.categoryKey];
    current = parent;
  }
  return {
    image: own?.image ?? inherited?.image,
    icon: own?.icon ?? inherited?.icon ?? FALLBACK.icon,
    tint: own?.tint ?? inherited?.tint ?? FALLBACK.tint,
  };
}
