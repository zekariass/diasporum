import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import {
  createPollRequest,
  emptyPollFormValue,
  PollForm,
  pollFormValueFromPoll,
  updatePollRequest,
  validatePollForm,
  type PollFormValue,
} from "@/features/feed/components/poll-form";
import type { CategoryView, Poll } from "@/features/feed/types/feed-types";

let mockPickerDate: Date | null = null;

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-community/datetimepicker", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ onChange }: {
      onChange: (event: { type: string }, date?: Date) => void;
    }) => ReactActual.createElement(Pressable, {
      accessibilityLabel: "Confirm picker",
      onPress: () => onChange({ type: "set" }, mockPickerDate ?? undefined),
    }),
  };
});

const CATEGORIES: CategoryView[] = [
  { id: "category-1", countryId: "country-1", name: "Social", slug: "social", active: true },
];

function validValue(overrides: Partial<PollFormValue> = {}): PollFormValue {
  return {
    ...emptyPollFormValue(),
    question: "  Which venue?  ",
    categoryId: "category-1",
    options: ["  Hall  ", "Park"],
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    postId: "post-1",
    question: "Which venue?",
    status: "ACTIVE",
    closesAt: null,
    closedAt: null,
    allowMultiple: false,
    allowVoteChange: true,
    allowVoteWithdraw: true,
    anonymousVoting: false,
    maxOptions: 10,
    resultsVisibility: "AFTER_VOTING",
    resultsVisible: true,
    totalVoters: 0,
    totalVotes: 0,
    myVotes: [],
    options: [
      { id: "option-1", text: "Hall", sortOrder: 0, voteCount: 0, percentage: 0 },
      { id: "option-2", text: "Park", sortOrder: 1, voteCount: 0, percentage: 0 },
    ],
    ...overrides,
  };
}

function Harness({
  initial,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof PollForm>, "value" | "onChange"> & {
  initial: PollFormValue;
  onChange?: (value: PollFormValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <PollForm
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

beforeEach(() => {
  mockPickerDate = null;
});

describe("PollForm validation and request mapping", () => {
  it("accepts a valid Poll and trims request values", () => {
    const value = validValue({ allowMultiple: true, anonymousVoting: true });
    expect(validatePollForm(value)).toBeNull();
    expect(createPollRequest(value, "community-1")).toEqual({
      communityId: "community-1",
      categoryId: "category-1",
      question: "Which venue?",
      options: ["Hall", "Park"],
      maxOptions: 20,
      closesAt: value.closesAt,
      allowMultiple: true,
      allowVoteChange: false,
      allowVoteWithdraw: false,
      anonymousVoting: true,
      resultsVisibility: "AFTER_VOTING",
    });
  });

  it.each([
    ["missing category", validValue({ categoryId: "" }), true, "Choose a FEED category."],
    ["blank question", validValue({ question: "   " }), true, "Enter a poll question."],
    ["overlong question", validValue({ question: "x".repeat(20_001) }), true, "20,000 characters"],
    ["fractional maximum", validValue({ maxOptions: 2.5 }), true, "Maximum options"],
    ["too-small maximum", validValue({ maxOptions: 1 }), true, "Maximum options"],
    ["too-large maximum", validValue({ maxOptions: 21 }), true, "Maximum options"],
    ["too few options", validValue({ options: ["Only one"] }), true, "Provide between"],
    ["too many options", validValue({ maxOptions: 2, options: ["A", "B", "C"] }), true, "Provide between"],
    ["blank option", validValue({ options: ["A", " "] }), true, "must be filled"],
    ["overlong option", validValue({ options: ["A", "x".repeat(251)] }), true, "250 characters"],
    ["duplicate option", validValue({ options: [" Hall ", "hall"] }), true, "must be unique"],
    ["invalid deadline", validValue({ closesAt: "not-a-date" }), true, "future"],
    ["past deadline", validValue({ closesAt: new Date(Date.now() - 1000).toISOString() }), true, "future"],
  ])("rejects %s", (_name, value, requireCategory, message) => {
    expect(validatePollForm(value, requireCategory)).toContain(message);
  });

  it("does not require a category while editing and can omit locked configuration", () => {
    const value = validValue({ categoryId: "" });
    expect(validatePollForm(value, false)).toBeNull();
    const request = updatePollRequest(value, false);
    expect(request).toEqual({ question: "Which venue?", closesAt: value.closesAt });
    expect(request).not.toHaveProperty("options");
    expect(request).not.toHaveProperty("allowMultiple");
  });

  it("maps an existing Poll into editable form state", () => {
    const poll = makePoll({ allowMultiple: true, resultsVisibility: "IMMEDIATE" });
    expect(pollFormValueFromPoll(poll)).toEqual(validValue({
      question: "Which venue?",
      categoryId: "",
      maxOptions: 10, // comes from the poll, not the 20-option create default
      options: ["Hall", "Park"],
      closesAt: null,
      allowMultiple: true,
      allowVoteChange: true,
      allowVoteWithdraw: true,
      resultsVisibility: "IMMEDIATE",
    }));
  });
});

describe("PollForm interactions", () => {
  it("edits categories, questions, options, policies, visibility and preview", async () => {
    const onChange = jest.fn();
    await render(<Harness initial={emptyPollFormValue()} categories={CATEGORIES} showCategory onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("Category Social"));
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "Best venue?");
    await fireEvent.changeText(screen.getByLabelText("Option 1 (required)"), "Hall");
    await fireEvent.changeText(screen.getByLabelText("Option 2 (required)"), "Park");
    await fireEvent.press(screen.getByLabelText("Add poll option"));
    await fireEvent.changeText(screen.getByLabelText("Option 3 (required)"), "Library");
    await fireEvent.press(screen.getByLabelText("Remove option 3"));
    await fireEvent(screen.getByLabelText("Allow multiple selections"), "valueChange", true);
    await fireEvent(screen.getByLabelText("Allow vote changes"), "valueChange", true);
    await fireEvent(screen.getByLabelText("Allow vote withdrawal"), "valueChange", true);
    await fireEvent(screen.getByLabelText("Anonymous voting"), "valueChange", true);
    await fireEvent.press(screen.getByLabelText("Results immediately"));
    await fireEvent.press(screen.getByLabelText("Show poll preview"));

    expect(screen.queryByLabelText("Option 3 (required)")).toBeNull();
    expect(screen.getByTestId("poll-preview")).toBeTruthy();
    expect(screen.getByText("Best venue?")).toBeTruthy();
    expect(screen.getByText("Hall")).toBeTruthy();
    expect(screen.getByText(/0 voters · 0 votes/)).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      categoryId: "category-1",
      options: ["Hall", "Park"],
      allowMultiple: true,
      allowVoteChange: true,
      allowVoteWithdraw: true,
      anonymousVoting: true,
      resultsVisibility: "IMMEDIATE",
    }));
  });

  it("enforces the configured option maximum", async () => {
    const atCap = await render(
      <Harness initial={validValue({ maxOptions: 2, closesAt: null })} />
    );
    expect(screen.queryByLabelText("Add poll option")).toBeNull();
    await atCap.unmount();

    await render(<Harness initial={validValue({ maxOptions: 3, closesAt: null })} />);
    await fireEvent.press(screen.getByLabelText("Add poll option"));
    expect(screen.getByLabelText("Option 3 (required)")).toBeTruthy();
    expect(screen.queryByLabelText("Add poll option")).toBeNull();
  });

  it("selects a deadline through the native picker and supports clearing it", async () => {
    const onChange = jest.fn();
    mockPickerDate = new Date(Date.now() + 172_800_000);
    await render(<Harness initial={validValue({ closesAt: null })} onChange={onChange} />);

    await fireEvent(screen.getByLabelText("Add closing date and time"), "valueChange", true);
    await fireEvent.press(screen.getByLabelText("Choose closing date"));
    await fireEvent.press(screen.getByLabelText("Confirm picker"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ closesAt: expect.any(String) }));

    await fireEvent(screen.getByLabelText("Add closing date and time"), "valueChange", false);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ closesAt: null }));
  });

  it("locks configuration after votes while leaving the question and deadline editable", async () => {
    await render(<Harness initial={validValue()} configurationLocked allowDeadlineClear={false} />);

    expect(screen.getByText(/locked after the first vote/)).toBeTruthy();
    expect(screen.getByLabelText("Question (required)")).toBeEnabled();
    expect(screen.getByLabelText("Option 1 (required)")).not.toBeEnabled();
    expect(screen.queryByLabelText("Maximum options")).toBeNull();
    expect(screen.getByLabelText("Allow multiple selections").props.disabled).toBe(true);
    expect(screen.getByLabelText("Add closing date and time").props.disabled).toBe(true);
    expect(screen.queryByLabelText("Add poll option")).toBeNull();
    expect(screen.getByText(/can be changed but not removed/)).toBeTruthy();
  });

  it("makes closed and expired Polls read-only", async () => {
    await render(<Harness initial={validValue()} readOnly />);

    expect(screen.getByText("Closed or expired polls are read-only.")).toBeTruthy();
    expect(screen.getByLabelText("Question (required)")).not.toBeEnabled();
    expect(screen.getByLabelText("Choose closing date")).not.toBeEnabled();
    expect(screen.getByLabelText("Results immediately")).not.toBeEnabled();
  });
});
