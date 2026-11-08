/**
 * Jest mock for expo-audio (native module unavailable under jest-expo).
 * Mapped via moduleNameMapper "^expo-audio$" in package.json.
 */

export const RecordingPresets = {
  HIGH_QUALITY: {
    extension: ".m4a",
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  LOW_QUALITY: {},
};

export const AudioModule = {
  requestRecordingPermissionsAsync: jest.fn(async () => ({
    granted: true,
    status: "granted",
    canAskAgain: true,
  })),
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
};

export const setAudioModeAsync = jest.fn(async () => undefined);
export const setIsAudioActiveAsync = jest.fn(async () => undefined);
export const getRecordingPermissionsAsync = AudioModule.getRecordingPermissionsAsync;
export const requestRecordingPermissionsAsync =
  AudioModule.requestRecordingPermissionsAsync;

function makePlayer() {
  return {
    playing: false,
    currentTime: 0,
    duration: 0,
    bufferedPosition: 0,
    isLoaded: true,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    replace: jest.fn(),
    remove: jest.fn(),
    release: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    setPlaybackRate: jest.fn(),
  };
}

export function useAudioPlayer() {
  return makePlayer();
}

export function useAudioPlayerStatus() {
  return {
    currentTime: 0,
    duration: 0,
    playbackPosition: 0,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
    isBuffering: false,
    playbackState: "idle",
    timeControlStatus: "paused",
    reasonForWaitingToPlay: "none",
    mute: false,
    playbackRate: 1,
  };
}

function makeRecorder() {
  return {
    uri: null as string | null,
    isRecording: false,
    record: jest.fn(async () => undefined),
    prepareToRecordAsync: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({
      canRecord: true,
      isRecording: false,
      durationMillis: 0,
      mediaServicesDidReset: false,
      metering: null,
      url: null,
    })),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    setAudioSamplingEnabled: jest.fn(),
  };
}

export function useAudioRecorder() {
  return makeRecorder();
}

export function useAudioRecorderState() {
  return {
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
    metering: null,
    url: null,
  };
}
