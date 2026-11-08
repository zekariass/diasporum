import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import { ApiError } from "@/core/api/api-error";
import { PollCard } from "@/features/feed/components/poll-card";
import type { Poll } from "@/features/feed/types/feed-types";

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    postId: "post-1",
    question: "Which venue?",
    status: "ACTIVE",
    closesAt: null,
    closedAt: null,
    allowMultiple: false,
    allowVoteChange: false,
    allowVoteWithdraw: false,
    anonymousVoting: false,
    maxOptions: 10,
    resultsVisibility: "IMMEDIATE",
    resultsVisible: true,
    totalVoters: 2,
    totalVotes: 2,
    myVotes: [],
    options: [
      {
        id: "option-1",
        text: "Hall",
        sortOrder: 0,
        voteCount: 1,
        percentage: 50,
      },
      {
        id: "option-2",
        text: "Park",
        sortOrder: 1,
        voteCount: 1,
        percentage: 50,
      },
      {
        id: "option-3",
        text: "Library",
        sortOrder: 2,
        voteCount: 0,
        percentage: 0,
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PollCard single-choice voting", () => {
  it("submits a new selection and publishes the authoritative Poll", async () => {
    const updated = makePoll({
      myVotes: ["option-2"],
      totalVoters: 3,
      totalVotes: 3,
    });
    const onVote = jest.fn().mockResolvedValue(updated);
    const onChange = jest.fn();
    await render(
      <PollCard poll={makePoll()} onVote={onVote} onChange={onChange} />,
    );

    expect(screen.getByLabelText("Submit vote")).not.toBeEnabled();
    await fireEvent.press(screen.getByLabelText("Park"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));

    await waitFor(() => expect(onVote).toHaveBeenCalledWith("option-2", false));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(updated);
  });

  it("prevents duplicate submissions while a vote is in flight", async () => {
    const request = deferred<Poll>();
    const onVote = jest.fn(() => request.promise);
    await render(<PollCard poll={makePoll()} onVote={onVote} />);

    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Submit vote — loading")).toBeTruthy();

    await act(async () => request.resolve(makePoll({ myVotes: ["option-1"] })));
    await waitFor(() =>
      expect(screen.queryByLabelText("Submit vote — loading")).toBeNull(),
    );
  });

  it("changes a single-choice vote atomically without requiring withdrawal", async () => {
    const poll = makePoll({ myVotes: ["option-1"], allowVoteChange: true });
    const onVote = jest
      .fn()
      .mockResolvedValue(makePoll({ myVotes: ["option-2"] }));
    await render(<PollCard poll={poll} onVote={onVote} />);

    expect(screen.getByLabelText("Hall")).not.toBeEnabled();
    await fireEvent.press(screen.getByLabelText("Park"));
    await fireEvent.press(screen.getByLabelText("Update vote"));

    await waitFor(() => expect(onVote).toHaveBeenCalledWith("option-2", false));
    expect(onVote).toHaveBeenCalledTimes(1);
  });

  it("blocks changing an existing vote when vote changes are disabled", async () => {
    const onVote = jest.fn();
    await render(
      <PollCard poll={makePoll({ myVotes: ["option-1"] })} onVote={onVote} />,
    );

    expect(screen.getByLabelText("Hall")).not.toBeEnabled();
    expect(screen.getByLabelText("Park")).not.toBeEnabled();
    expect(screen.getByLabelText("Update vote")).not.toBeEnabled();
    expect(onVote).not.toHaveBeenCalled();
  });

  it("withdraws only the current single-choice selection", async () => {
    const onVote = jest.fn().mockResolvedValue(makePoll({ myVotes: [] }));
    await render(
      <PollCard
        poll={makePoll({ myVotes: ["option-1"], allowVoteWithdraw: true })}
        onVote={onVote}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Update vote"));

    await waitFor(() => expect(onVote).toHaveBeenCalledWith("option-1", true));
  });
});

describe("PollCard multiple-choice voting", () => {
  it("applies removals before additions in sequence", async () => {
    const poll = makePoll({
      allowMultiple: true,
      allowVoteWithdraw: true,
      myVotes: ["option-1"],
      totalVotes: 1,
    });
    const responses = [
      makePoll({ allowMultiple: true, allowVoteWithdraw: true, myVotes: [] }),
      makePoll({
        allowMultiple: true,
        allowVoteWithdraw: true,
        myVotes: ["option-2"],
      }),
      makePoll({
        allowMultiple: true,
        allowVoteWithdraw: true,
        myVotes: ["option-2", "option-3"],
      }),
    ];
    const onVote = jest
      .fn()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(responses[2]);
    const onChange = jest.fn();
    await render(<PollCard poll={poll} onVote={onVote} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Park"));
    await fireEvent.press(screen.getByLabelText("Library"));
    await fireEvent.press(screen.getByLabelText("Update vote"));

    await waitFor(() => expect(onVote).toHaveBeenCalledTimes(3));
    expect(onVote.mock.calls).toEqual([
      ["option-1", true],
      ["option-2", false],
      ["option-3", false],
    ]);
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(responses);
  });

  it("keeps successful earlier mutations and reports a later failure", async () => {
    const poll = makePoll({ allowMultiple: true, myVotes: [] });
    const first = makePoll({ allowMultiple: true, myVotes: ["option-1"] });
    const onVote = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(
        new ApiError({
          code: "VALIDATION_ERROR",
          httpStatus: 409,
          userMessage: "Voting has closed.",
        }),
      );
    const onChange = jest.fn();
    await render(<PollCard poll={poll} onVote={onVote} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Park"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));

    expect(await screen.findByText("Voting has closed.")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(first);
  });
});

describe("PollCard results and lifecycle", () => {
  it("shows exact totals, percentages and the zero-vote state", async () => {
    const { rerender } = await render(
      <PollCard
        poll={makePoll({
          totalVoters: 0,
          totalVotes: 0,
          options: makePoll().options.map((option) => ({
            ...option,
            voteCount: 0,
            percentage: 0,
          })),
        })}
      />,
    );

    expect(screen.getByText("0 voters · 0 votes")).toBeTruthy();
    expect(screen.getByText("No votes yet.")).toBeTruthy();
    expect(screen.getAllByText("0 · 0.0%")).toHaveLength(3);

    await rerender(
      <PollCard poll={makePoll({ totalVoters: 2, totalVotes: 4 })} />,
    );
    expect(screen.getByText("2 voters · 4 votes")).toBeTruthy();
    expect(screen.getAllByText("1 · 50.0%")).toHaveLength(2);
    expect(screen.getAllByLabelText("50.0 percent")).toHaveLength(2);
  });

  it("hides aggregates but retains the viewer's own selections", async () => {
    await render(
      <PollCard
        poll={makePoll({
          resultsVisibility: "AFTER_VOTING",
          resultsVisible: false,
          totalVoters: null,
          totalVotes: null,
          myVotes: ["option-1"],
          options: makePoll().options.map((option) => ({
            ...option,
            voteCount: null,
            percentage: null,
          })),
        })}
      />,
    );

    expect(
      screen.getByText("Results are visible after you vote."),
    ).toBeTruthy();
    expect(screen.queryByText(/voters ·/)).toBeNull();
    expect(screen.queryByText(/50\.0%/)).toBeNull();
    expect(screen.getByLabelText("Hall").props.accessibilityState.checked).toBe(
      true,
    );
  });

  it("explains results hidden until closure", async () => {
    await render(
      <PollCard
        poll={makePoll({
          status: "CLOSED",
          resultsVisibility: "AFTER_CLOSE",
          resultsVisible: false,
          totalVoters: null,
          totalVotes: null,
        })}
      />,
    );
    expect(
      screen.getByText("Results are visible after the poll closes."),
    ).toBeTruthy();
  });

  it.each(["CLOSED", "EXPIRED"] as const)(
    "disables voting for %s Polls",
    async (status) => {
      const onVote = jest.fn();
      await render(<PollCard poll={makePoll({ status })} onVote={onVote} />);

      expect(screen.queryByLabelText("Submit vote")).toBeNull();
      expect(screen.getByLabelText("Hall")).not.toBeEnabled();
      expect(
        screen.getByText(
          status === "EXPIRED"
            ? "This poll has expired. Voting is closed."
            : "This poll is closed. Voting is closed.",
        ),
      ).toBeTruthy();
    },
  );

  it("shows a safe generic error for non-API failures", async () => {
    const onVote = jest.fn().mockRejectedValue(new Error("socket details"));
    await render(<PollCard poll={makePoll()} onVote={onVote} />);

    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));

    expect(
      await screen.findByText("Failed to update your vote. Please try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/socket details/)).toBeNull();
  });
});
