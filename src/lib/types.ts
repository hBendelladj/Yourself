/**
 * types.ts
 * Core domain types for YourSelf application
 */

export type VoiceGender = 'mujer' | 'hombre';

export interface VoiceOption {
  name: string;
  gender: VoiceGender;
  description: string;
  isDefault?: boolean;
}

export interface FaceLandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export type DetectionStatus = 'idle' | 'loading_model' | 'processing' | 'success' | 'error';

export interface DetectionResult {
  landmarks: FaceLandmarkPoint[];
  imageWidth: number;
  imageHeight: number;
  error?: string;
  facialTransformationMatrix?: number[];
  faceBlendshapes?: Array<{ categoryName: string; score: number }>;
}

export type ConversationState =
  | 'setup'
  | 'connecting'
  | 'active'
  | 'paused'
  | 'disconnected'
  | 'error';

export type AvatarMood = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface SetupValidation {
  isNameValid: boolean;
  isApiKeyValid: boolean;
  isImageValid: boolean;
  isPermissionGranted: boolean;
  canProceed: boolean;
  errors: {
    characterName?: string;
    apiKey?: string;
    image?: string;
    permission?: string;
  };
}
