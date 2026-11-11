/**
 * session.ts
 * Estado global con Zustand.
 * Cumple con la restricción de que la API key vive solo en memoria,
 * NUNCA en localStorage, sessionStorage, IndexedDB, cookies, logs ni en la URL.
 */

import { create } from 'zustand';
import {
  VoiceGender,
  DetectionStatus,
  FaceLandmarkPoint,
  ConversationState,
  AvatarMood,
  TranscriptMessage,
} from '@/lib/types';
import { DEFAULT_LIVE_MODEL } from '@/lib/constants';
import { getDefaultVoice } from '@/core/live/voices';
import { syncUrlWithStage, updateUrlParams } from '@/app/routes';

export type RigVersion = 'v1' | 'v2' | 'v3' | 'v4';

interface SessionState {
  // Configuración de usuario
  characterName: string;
  apiKey: string;
  voiceGender: VoiceGender;
  voiceName: string;
  modelName: string;
  hasPermission: boolean;
  hasVisitedAvatar: boolean;

  // Imagen y Malla Facial
  imageFile: File | null;
  imageUrl: string | null;
  imageDimensions: { width: number; height: number } | null;
  detectionStatus: DetectionStatus;
  detectionError: string | null;
  faceLandmarks: FaceLandmarkPoint[] | null;
  facialTransformationMatrix: number[] | null;

  // Estado de navegación y conversación
  stage: 'setup' | 'avatar';
  conversationState: ConversationState;
  avatarMood: AvatarMood;
  isMicMuted: boolean;
  isDebugOverlay: boolean;
  rigVersion: RigVersion;
  errorMessage: string | null;

  // AnalyserNode para lip-sync en tiempo real
  analyserNode: AnalyserNode | null;

  // Transcripción de la conversación
  transcripts: TranscriptMessage[];

  // Acciones
  setCharacterName: (name: string) => void;
  setApiKey: (key: string) => void;
  setVoiceGender: (gender: VoiceGender) => void;
  setVoiceName: (voice: string) => void;
  setModelName: (model: string) => void;
  setHasPermission: (has: boolean) => void;
  setHasVisitedAvatar: (visited: boolean) => void;
  setImage: (file: File | null, url: string | null, dimensions?: { width: number; height: number }) => void;
  setDetectionStatus: (status: DetectionStatus, error?: string | null) => void;
  setFaceLandmarks: (landmarks: FaceLandmarkPoint[] | null) => void;
  setFacialTransformationMatrix: (matrix: number[] | null) => void;
  setStage: (stage: 'setup' | 'avatar') => void;
  setConversationState: (state: ConversationState) => void;
  setAvatarMood: (mood: AvatarMood) => void;
  setIsMicMuted: (muted: boolean) => void;
  setIsDebugOverlay: (enabled: boolean) => void;
  setRigVersion: (version: RigVersion) => void;
  setErrorMessage: (msg: string | null) => void;
  setAnalyserNode: (node: AnalyserNode | null) => void;
  addTranscript: (msg: TranscriptMessage) => void;
  updateLastStreamingTranscript: (text: string) => void;
  clearAll: () => void;
}

const getInitialRigVersion = (): RigVersion => {
  try {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const param = searchParams.get('rig');
      if (param === 'v1') return 'v1';
      if (param === 'v2') return 'v2';
      if (param === 'v3') return 'v3';
      if (param === 'v4' || searchParams.has('v4')) return 'v4';
    }
  } catch {
    // ignorar entornos sin window
  }
  return 'v4';
};

const initialVoiceGender: VoiceGender = 'mujer';
const initialVoiceName = getDefaultVoice(initialVoiceGender);

export const useSessionStore = create<SessionState>((set, get) => ({
  characterName: '',
  apiKey: '',
  voiceGender: initialVoiceGender,
  voiceName: initialVoiceName,
  modelName: DEFAULT_LIVE_MODEL,
  hasPermission: true,
  hasVisitedAvatar: false,

  imageFile: null,
  imageUrl: null,
  imageDimensions: null,
  detectionStatus: 'idle',
  detectionError: null,
  faceLandmarks: null,
  facialTransformationMatrix: null,

  stage: 'setup',
  conversationState: 'setup',
  avatarMood: 'idle',
  isMicMuted: false,
  isDebugOverlay: typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1',
  rigVersion: getInitialRigVersion(),
  errorMessage: null,
  analyserNode: null,
  transcripts: [],

  setCharacterName: (characterName) => set({ characterName }),

  setApiKey: (apiKey) => set({ apiKey }),

  setVoiceGender: (voiceGender) => {
    const defaultVoice = getDefaultVoice(voiceGender);
    set({ voiceGender, voiceName: defaultVoice });
  },

  setVoiceName: (voiceName) => set({ voiceName }),
  setModelName: (modelName) => set({ modelName }),
  setHasPermission: (hasPermission) => set({ hasPermission }),
  setHasVisitedAvatar: (hasVisitedAvatar) => set({ hasVisitedAvatar }),

  setImage: (imageFile, imageUrl, imageDimensions) => {
    const prevUrl = get().imageUrl;
    if (prevUrl && prevUrl.startsWith('blob:') && prevUrl !== imageUrl) {
      URL.revokeObjectURL(prevUrl);
    }
    set({
      imageFile,
      imageUrl,
      imageDimensions: imageDimensions ?? null,
      faceLandmarks: null,
      facialTransformationMatrix: null,
      detectionStatus: 'idle',
      detectionError: null,
      hasVisitedAvatar: false,
    });
  },

  setDetectionStatus: (detectionStatus, detectionError = null) =>
    set({ detectionStatus, detectionError }),

  setFaceLandmarks: (faceLandmarks) =>
    set({ faceLandmarks, detectionStatus: faceLandmarks ? 'success' : 'idle' }),

  setFacialTransformationMatrix: (facialTransformationMatrix) =>
    set({ facialTransformationMatrix }),

  setStage: (stage) => {
    syncUrlWithStage(stage);
    if (stage === 'avatar') {
      const currentRig = get().rigVersion || 'v4';
      if (currentRig === 'v4') {
        updateUrlParams({ rig: 'v4', v4: '' });
      } else {
        updateUrlParams({ rig: currentRig, v4: null });
      }
      set({ stage, hasVisitedAvatar: true });
    } else {
      set({ stage });
    }
  },
  setConversationState: (conversationState) => set({ conversationState }),
  setAvatarMood: (avatarMood) => set({ avatarMood }),
  setIsMicMuted: (isMicMuted) => set({ isMicMuted }),
  setIsDebugOverlay: (isDebugOverlay) => {
    updateUrlParams({ debug: isDebugOverlay ? '1' : null });
    set({ isDebugOverlay });
  },
  setRigVersion: (rigVersion) => {
    if (rigVersion === 'v4') {
      updateUrlParams({ rig: 'v4', v4: '' });
    } else {
      updateUrlParams({ rig: rigVersion, v4: null });
    }
    set({ rigVersion });
  },
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setAnalyserNode: (analyserNode) => set({ analyserNode }),

  addTranscript: (msg) =>
    set((state) => ({ transcripts: [...state.transcripts, msg] })),

  updateLastStreamingTranscript: (text) =>
    set((state) => {
      const list = [...state.transcripts];
      const lastIndex = list.length - 1;
      if (lastIndex >= 0 && list[lastIndex]?.isStreaming) {
        const updated = { ...list[lastIndex], text };
        list[lastIndex] = updated as TranscriptMessage;
        return { transcripts: list };
      }
      return state;
    }),

  clearAll: () => {
    const currentUrl = get().imageUrl;
    if (currentUrl && currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }
    syncUrlWithStage('setup');
    set({
      characterName: '',
      apiKey: '',
      voiceGender: initialVoiceGender,
      voiceName: initialVoiceName,
      modelName: DEFAULT_LIVE_MODEL,
      hasPermission: true,
      hasVisitedAvatar: false,
      rigVersion: 'v4',
      imageFile: null,
      imageUrl: null,
      imageDimensions: null,
      detectionStatus: 'idle',
      detectionError: null,
      faceLandmarks: null,
  facialTransformationMatrix: null,
      stage: 'setup',
      conversationState: 'setup',
      avatarMood: 'idle',
      isMicMuted: false,
      errorMessage: null,
      analyserNode: null,
      transcripts: [],
    });
  },
}));
