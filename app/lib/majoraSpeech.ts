import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { API_BASE } from "./api";

const SPEECH_KEY = "majora_speech_enabled_v1";

let activePlayer: any = null;

export async function getMajoraSpeechEnabled() {
  const saved = await AsyncStorage.getItem(SPEECH_KEY);
  return saved !== "false";
}

export async function setMajoraSpeechEnabled(enabled: boolean) {
  await AsyncStorage.setItem(SPEECH_KEY, enabled ? "true" : "false");

  if (!enabled) {
    stopMajoraSpeech();
  }
}

function cleanForSpeech(text: string) {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^\w\s.,!?'"-]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/#/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function shortSpeech(text: string) {
  const cleaned = cleanForSpeech(text);
  return cleaned.split(".").slice(0, 4).join(".").trim();
}

async function speakFallback(agentName: string, text: string) {
  const spokenText = shortSpeech(text);

  let pitch = 1;
  let rate = 0.92;

  switch (agentName.toLowerCase()) {
    case "nova":
      pitch = 1.02;
      rate = 0.9;
      break;
    case "zion":
      pitch = 0.62;
      rate = 0.84;
      break;
    case "luna":
      pitch = 1.22;
      rate = 0.94;
      break;
    case "kai":
      pitch = 0.72;
      rate = 0.95;
      break;
    case "aria":
      pitch = 1.12;
      rate = 0.92;
      break;
    case "ethan":
      pitch = 0.66;
      rate = 0.86;
      break;
  }

  Speech.stop();
  Speech.speak(spokenText, {
    pitch,
    rate,
    language: "en-US",
  });
}

async function playBase64Mp3(base64: string) {
  const uri = `${FileSystem.cacheDirectory}majora-voice-${Date.now()}.mp3`;

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    shouldPlayInBackground: false,
  });

  if (activePlayer) {
    try {
      activePlayer.pause?.();
      activePlayer.remove?.();
    } catch {}
  }

  activePlayer = createAudioPlayer({ uri });
  activePlayer.play();
}

export async function speakAsMajora(agentName: string, text: string) {
  const enabled = await getMajoraSpeechEnabled();

  if (!enabled) {
    return;
  }

  const spokenText = shortSpeech(text);

  if (!spokenText) {
    return;
  }

  try {
    Speech.stop();

    const res = await fetch(`${API_BASE}/api/ai/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, text: spokenText }),
    });

    const data = await res.json();

    if (data?.audioBase64) {
      await playBase64Mp3(data.audioBase64);
      return;
    }

    await speakFallback(agentName, spokenText);
  } catch {
    await speakFallback(agentName, spokenText);
  }
}

export function stopMajoraSpeech() {
  try {
    activePlayer?.pause?.();
    activePlayer?.remove?.();
    activePlayer = null;
  } catch {}

  Speech.stop();
}
