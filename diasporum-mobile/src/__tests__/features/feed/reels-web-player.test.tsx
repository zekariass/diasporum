import React, { act } from "react";
import { JSDOM } from "jsdom";
import { ReelPlayer } from "@/features/feed/components/reel-player.web";
import {
  createReelPlayback,
  type ReelPlayerProps,
} from "@/features/feed/utils/reel-playback";

jest.mock("react-native", () => {
  const React = jest.requireActual("react");
  return {
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
      disabled?: boolean;
    }) =>
      React.createElement(
        "button",
        { onClick: onPress, "aria-label": accessibilityLabel, disabled },
        children,
      ),
    ActivityIndicator: () => null,
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: React.ReactNode }) => children,
}));

type Root = { render: (node: React.ReactNode) => void; unmount: () => void };
let createRoot: (container: Element) => Root;
let root: Root;
let container: HTMLDivElement;
// RN's preset defines window during setup, which conflicts with Jest's jsdom environment.
// Install a scoped DOM after that setup without changing the application's test preset.
let dom: JSDOM;
const globals = [
  "window",
  "document",
  "HTMLMediaElement",
  "Event",
  "DOMException",
] as const;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const name of globals) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: dom.window[name],
    });
  }
  createRoot = jest.requireActual<{ createRoot: (container: Element) => Root }>(
    "react-dom/client",
  ).createRoot;
});
afterAll(() => {
  dom.window.close();
  for (const name of globals) {
    const original = originals.get(name);
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  }
});
let props: ReelPlayerProps;
let play: jest.SpyInstance;
let pause: jest.SpyInstance;
let load: jest.SpyInstance;
async function show(patch: Partial<ReelPlayerProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<ReelPlayer {...props} />));
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  play = jest
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  pause = jest
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  load = jest
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => {});
  const playback = createReelPlayback();
  playback.allow("one");
  props = {
    id: "one",
    uri: "https://media.test/one.mp4",
    active: true,
    muted: false,
    paused: false,
    initialTime: 0,
    playback,
    onTap: jest.fn(),
    onError: jest.fn(),
    onViewed: jest.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

it("requests audible inline autoplay and exposes a user-gesture fallback for policy rejection", async () => {
  play.mockRejectedValueOnce(
    new DOMException("Gesture required", "NotAllowedError"),
  );
  await show();
  expect(play).toHaveBeenCalled();
  const video = container.querySelector("video")!;
  expect(video.muted).toBe(false);
  expect(video.playsInline).toBe(true);
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Play reel with sound"]',
  )!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(play).toHaveBeenCalledTimes(2);
  expect(props.onTap).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Tap to play");
  expect(props.onError).not.toHaveBeenCalled();
});

it("preloads inactive media without playing and rejects late offscreen playback", async () => {
  await show({ active: false });
  expect(play).not.toHaveBeenCalled();
  const video = container.querySelector("video")!;
  expect(video.preload).toBe("auto");
  await act(async () => video.dispatchEvent(new Event("playing")));
  expect(pause).toHaveBeenCalled();
  await show({ active: true });
  expect(play).toHaveBeenCalled();
  props.playback.allow(null);
  const calls = play.mock.calls.length;
  await act(async () => video.dispatchEvent(new Event("canplay")));
  expect(play).toHaveBeenCalledTimes(calls);
});

it("preserves position across pause and mute changes and releases its source on unmount", async () => {
  await show({ initialTime: 4 });
  const video = container.querySelector("video")!;
  await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
  expect(video.currentTime).toBe(4);
  await show({ paused: true, muted: true });
  expect(pause).toHaveBeenCalled();
  expect(video.muted).toBe(true);
  await show({ paused: false });
  expect(container.querySelector("video")).toBe(video);
  expect(video.currentTime).toBe(4);
  await act(async () => root.render(null));
  expect(video.getAttribute("src")).toBeNull();
  expect(load).toHaveBeenCalled();
});

it("ignores a delayed play rejection after the reel is deactivated", async () => {
  let reject!: (error: Error) => void;
  play.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await show();
  await show({ active: false });
  await act(async () => reject(new Error("late network failure")));
  expect(props.onError).not.toHaveBeenCalled();
});

it("routes playback failures to retry but ignores normal interrupted play promises", async () => {
  play.mockRejectedValueOnce(new DOMException("Interrupted", "AbortError"));
  await show();
  expect(props.onError).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector("video")!.dispatchEvent(new Event("error")),
  );
  expect(props.onError).toHaveBeenCalledWith(0);
});
