/** Versioned standalone School contract. Matrix is an optional integration, not a prerequisite. */
export const API_VERSION = 1 as const;
export type LessonStage = 'explain' | 'example' | 'guided_practice' | 'socratic_check' | 'recap' | 'ended';
export type TurnKind = 'question' | 'answer' | 'advance';
export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ProviderMode = 'demo' | 'codex-cli';
export interface Mentor {
  id: string; name: string; title: string; description: string; timeframe: string;
  expertise: string[]; portraitUrl?: string; initials: string; promptVersion: string; disclosure: string;
}
export interface LessonSource { id: string; title: string; description: string; url?: string; kind: 'authored' | 'reference'; }
export interface LessonStageContent { stage: LessonStage; title: string; explanation: string; prompt: string; suggestedQuestions: string[]; }
export interface Lesson {
  id: string; version: string; title: string; description: string; objective: string; duration: string;
  mentorId: string; stages: LessonStageContent[]; sources: LessonSource[];
  requiredCapabilities: string[]; optionalCapabilities: string[];
}
export interface ScaleArtifact {
  type: 'scale'; dimensions: [number, number, number]; baseline: [number, number, number];
  volume: number; volumeRatio: number; units: 'units'; observedAt: string; source: 'browser-deterministic';
}
export interface LessonMessage {
  id: string; role: 'learner' | 'mentor' | 'system'; text: string; stage: LessonStage;
  createdAt: string; turnId?: string; providerMode?: ProviderMode;
}
export interface LessonEvent { id: string; type: 'session_started' | 'stage_changed' | 'experiment_applied' | 'turn_cancelled' | 'turn_failed' | 'turn_interrupted'; createdAt: string; stage: LessonStage; details: string; }
export interface SchoolSession {
  id: string; revision: number; mentorId: string; lessonId: string; lessonVersion: string;
  mentor: Mentor; lesson: Lesson; stage: LessonStage; stageContent: LessonStageContent;
  status: 'active' | 'completed'; messages: LessonMessage[]; events: LessonEvent[];
  artifact: ScaleArtifact; activeTurnId?: string; createdAt: string; updatedAt: string; savedAt: string;
  completionLabel: string;
}
export interface ProviderStatus {
  mode: ProviderMode; label: string; configured: boolean; available: boolean; checked: boolean;
  reason: string; requestedModel?: string; lastSucceededAt?: string;
  lastOutcome?: 'not-run' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}
export interface ProviderReceipt { mode: ProviderMode; requestedModel?: string; actualModel?: string; completedTurn: boolean; toolCallCount: number; }
export interface MentorTurn {
  id: string; sessionId: string; requestId: string; kind: TurnKind; status: TurnStatus; input: string;
  stage: LessonStage; createdAt: string; completedAt?: string; output?: string; error?: string; receipt?: ProviderReceipt;
}
export interface CatalogResponse { apiVersion: 1; mentors: Mentor[]; lessons: Lesson[]; provider: ProviderStatus; }
export interface SessionResponse { apiVersion: 1; session: SchoolSession; }
export interface SessionsResponse { apiVersion: 1; sessions: SchoolSession[]; }
export interface TurnResponse extends SessionResponse { turn: MentorTurn; }
export interface StartSessionRequest { requestId: string; mentorId: string; lessonId: string; }
export interface CreateTurnRequest { requestId: string; expectedRevision: number; kind: TurnKind; text?: string; }
export interface ExperimentRequest { requestId: string; expectedRevision: number; dimensions: [number, number, number]; }
export interface ErrorResponse { apiVersion: 1; error: string; code: string; }
